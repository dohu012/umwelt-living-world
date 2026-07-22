import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import PageHeader from '../../components/layout/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Panel from '../../components/ui/Panel.jsx';
import StatusBanner from '../../components/ui/StatusBanner.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import { useActivePersona } from '../../hooks/useActivePersona.js';
import AgentInspector from './AgentInspector.jsx';
import EventTimeline from './EventTimeline.jsx';
import GraphView from './GraphView.jsx';
import SkillTrace from './SkillTrace.jsx';
import VisibilityReport from './VisibilityReport.jsx';

const TABS = [
  { id: 'visibility', label: '可见性' },
  { id: 'timeline', label: '事件时间线' },
  { id: 'skills', label: '技能链路' },
  { id: 'graph', label: '关系图' },
];

function GmTeleport({ worldId, personaId, location, locations }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newLocationName, setNewLocationName] = useState('');

  const moveMutation = useMutation({
    mutationFn: (nextLocation) => api.post(`/api/worlds/${worldId}/personas/${personaId}/location`, { location: nextLocation }),
    onSuccess: ({ location: nextLocation }) => navigate(`/worlds/${worldId}/play/${nextLocation}`),
  });
  const createLocationMutation = useMutation({
    mutationFn: (name) => api.post(`/api/worlds/${worldId}/locations`, { name }),
    onSuccess: async (created) => {
      setNewLocationName('');
      await queryClient.invalidateQueries({ queryKey: ['locations', worldId] });
      moveMutation.mutate(created.id);
    },
  });

  return (
    <Panel title="主持人地点控制" eyebrow="手动覆盖">
      <label className="inline-field">
        <span>移动玩家身份</span>
        <select
          value={location ?? ''}
          disabled={!personaId || moveMutation.isPending || locations.length === 0}
          onChange={(event) => moveMutation.mutate(event.target.value)}
        >
          {locations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (personaId && newLocationName.trim()) createLocationMutation.mutate(newLocationName.trim());
        }}
      >
        <input value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} placeholder="新地点名称" />
        <Button type="submit" disabled={!personaId || !newLocationName.trim() || createLocationMutation.isPending}>
          创建并进入
        </Button>
      </form>
      {moveMutation.isError && <StatusBanner tone="error">{moveMutation.error.message}</StatusBanner>}
      {createLocationMutation.isError && <StatusBanner tone="error">{createLocationMutation.error.message}</StatusBanner>}
    </Panel>
  );
}

export default function InspectorPage() {
  const { worldId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activePersonaId] = useActivePersona();
  const [activeTab, setActiveTab] = useState('visibility');
  const [selectedAgentId, setSelectedAgentId] = useState(null);

  const locationsQuery = useQuery({
    queryKey: ['locations', worldId],
    queryFn: () => api.get(`/api/worlds/${worldId}/locations`),
  });
  const rosterQuery = useQuery({
    queryKey: ['characters', worldId],
    queryFn: () => api.get(`/api/worlds/${worldId}/characters`),
  });

  const locations = locationsQuery.data?.locations ?? [];
  const location = searchParams.get('location') || locations[0]?.id;
  const messagesQuery = useQuery({
    queryKey: ['messages', worldId, location, 'inspector'],
    queryFn: () => api.get(`/api/worlds/${worldId}/locations/${location}/messages?limit=120`),
    enabled: Boolean(location),
  });
  const inspectQuery = useQuery({
    queryKey: ['inspect', worldId, selectedAgentId, 'page'],
    queryFn: () => api.get(`/api/worlds/${worldId}/characters/${selectedAgentId}/inspect?showDenied=true&limit=80`),
    enabled: Boolean(selectedAgentId),
  });

  const agents = rosterQuery.data?.characters ?? [];

  useEffect(() => {
    if (!selectedAgentId && agents[0]?.id) setSelectedAgentId(agents[0].id);
  }, [agents, selectedAgentId]);

  if (rosterQuery.isLoading || locationsQuery.isLoading) return <div className="skeleton-page">正在加载调试台...</div>;

  return (
    <div className="workspace inspector-workspace">
      <PageHeader
        title="调试台"
        subtitle="在不改变后端行为的前提下，观察标签可见性、本地事件、技能链路和轻量关系状态。"
        actions={
          <label className="inline-field">
            <span>地点</span>
            <select
              value={location ?? ''}
              onChange={(event) => setSearchParams(event.target.value ? { location: event.target.value } : {})}
            >
              {locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <div className="inspector-grid">
        <aside className="inspector-sidebar">
          <AgentInspector
            worldId={worldId}
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelect={setSelectedAgentId}
          />
          <GmTeleport worldId={worldId} personaId={activePersonaId} location={location} locations={locations} />
        </aside>
        <section className="inspector-main">
          <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
          {activeTab === 'visibility' && <VisibilityReport report={inspectQuery.data} />}
          {activeTab === 'timeline' && <EventTimeline events={messagesQuery.data?.events ?? []} />}
          {activeTab === 'skills' && <SkillTrace events={messagesQuery.data?.events ?? []} />}
          {activeTab === 'graph' && <GraphView agents={agents} events={messagesQuery.data?.events ?? []} />}
        </section>
      </div>
    </div>
  );
}
