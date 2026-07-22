import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import Button from '../../components/ui/Button.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import StatusBanner from '../../components/ui/StatusBanner.jsx';
import PageHeader from '../../components/layout/PageHeader.jsx';
import AppearanceTab from './tabs/AppearanceTab.jsx';
import MemoryTab from './tabs/MemoryTab.jsx';
import ProfileTab from './tabs/ProfileTab.jsx';
import RawTab from './tabs/RawTab.jsx';
import SkillsTab from './tabs/SkillsTab.jsx';
import StateTab from './tabs/StateTab.jsx';
import VisibilityTab from './tabs/VisibilityTab.jsx';

const BLANK_PROFILE = {
  name: '',
  description: '',
  personality: '',
  scenario: '',
  first_mes: '',
  mes_example: '',
  system_prompt: '',
  post_history_instructions: '',
  creator_notes: '',
  creator: '',
  character_version: '',
  avatar: '',
  location: '',
  tags: [],
  alternate_greetings: [],
  extensions: {
    visibility: {
      allow: ['global', 'private:{self}', 'local:{state.location}'],
      deny: ['private:*'],
      conditionalAllow: [],
    },
    skills: {},
  },
};

const TABS = [
  { id: 'profile', label: '角色卡' },
  { id: 'appearance', label: '外观' },
  { id: 'visibility', label: '可见性' },
  { id: 'skills', label: '技能' },
  { id: 'state', label: '状态' },
  { id: 'memory', label: '记忆' },
  { id: 'raw', label: '原始数据' },
];

function joinLines(value) {
  return (value ?? []).join('\n');
}

function splitLines(value) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toFields(profile) {
  const visibility = profile?.extensions?.visibility ?? BLANK_PROFILE.extensions.visibility;
  return {
    ...BLANK_PROFILE,
    ...profile,
    tags: (profile?.tags ?? []).join(', '),
    alternate_greetings: (profile?.alternate_greetings ?? []).join('\n'),
    visibilityAllow: joinLines(visibility.allow),
    visibilityDeny: joinLines(visibility.deny),
    conditionalAllowJson: JSON.stringify(visibility.conditionalAllow ?? [], null, 2),
    skillsJson: JSON.stringify(profile?.extensions?.skills ?? {}, null, 2),
    extensionsBase: profile?.extensions ?? {},
  };
}

function toPayload(fields) {
  const tags = fields.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  let conditionalAllow = [];
  let skills = {};
  try {
    conditionalAllow = fields.conditionalAllowJson.trim() ? JSON.parse(fields.conditionalAllowJson) : [];
  } catch (err) {
    throw new Error(`conditionalAllow JSON 无效：${err.message}`);
  }
  try {
    skills = fields.skillsJson.trim() ? JSON.parse(fields.skillsJson) : {};
  } catch (err) {
    throw new Error(`skills JSON 无效：${err.message}`);
  }

  return {
    name: fields.name,
    description: fields.description,
    personality: fields.personality,
    scenario: fields.scenario,
    first_mes: fields.first_mes,
    mes_example: fields.mes_example,
    system_prompt: fields.system_prompt,
    post_history_instructions: fields.post_history_instructions,
    creator_notes: fields.creator_notes,
    creator: fields.creator,
    character_version: fields.character_version,
    avatar: fields.avatar || undefined,
    location: fields.location || undefined,
    tags,
    alternate_greetings: splitLines(fields.alternate_greetings),
    extensions: {
      ...(fields.extensionsBase ?? {}),
      visibility: {
        allow: splitLines(fields.visibilityAllow),
        deny: splitLines(fields.visibilityDeny),
        conditionalAllow,
      },
      skills,
    },
  };
}

export default function CharacterDetail({ mode = 'edit' }) {
  const { worldId, agentId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('profile');
  const [fields, setFields] = useState(() => toFields(BLANK_PROFILE));
  const [rawJson, setRawJson] = useState(JSON.stringify(BLANK_PROFILE, null, 2));
  const [avatarFile, setAvatarFile] = useState(null);
  const [error, setError] = useState(null);

  const isEdit = mode === 'edit';
  const existingQuery = useQuery({
    queryKey: ['character', worldId, agentId],
    queryFn: () => api.get(`/api/worlds/${worldId}/characters/${agentId}`),
    enabled: isEdit,
  });
  const rosterQuery = useQuery({
    queryKey: ['characters', worldId],
    queryFn: () => api.get(`/api/worlds/${worldId}/characters`),
  });
  const locationsQuery = useQuery({
    queryKey: ['locations', worldId, 'character-detail'],
    queryFn: () => api.get(`/api/worlds/${worldId}/locations`),
  });
  const inspectQuery = useQuery({
    queryKey: ['inspect', worldId, agentId, 'detail'],
    queryFn: () => api.get(`/api/worlds/${worldId}/characters/${agentId}/inspect?showDenied=false&limit=80`),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!existingQuery.data) return;
    const nextFields = toFields(existingQuery.data);
    setFields(nextFields);
    setRawJson(JSON.stringify(existingQuery.data, null, 2));
  }, [existingQuery.data]);

  const currentCharacter = (rosterQuery.data?.characters ?? []).find((character) => character.id === agentId);
  const idToName = useMemo(() => {
    const map = new Map();
    for (const character of rosterQuery.data?.characters ?? []) map.set(character.id, character.name);
    return map;
  }, [rosterQuery.data]);

  const setField = (key) => (event) => {
    const value = event.target.value;
    setFields((current) => ({ ...current, [key]: value }));
  };

  const invalidate = (targetAgentId = agentId) => {
    queryClient.invalidateQueries({ queryKey: ['characters', worldId] });
    queryClient.invalidateQueries({ queryKey: ['character', worldId, targetAgentId] });
    queryClient.invalidateQueries({ queryKey: ['inspect', worldId, targetAgentId] });
  };

  const uploadAvatar = async (targetAgentId) => {
    if (!avatarFile) return;
    const form = new FormData();
    form.append('avatar', avatarFile);
    await api.postForm(`/api/worlds/${worldId}/characters/${targetAgentId}/avatar`, form);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const created = await api.post(`/api/worlds/${worldId}/characters`, toPayload(fields));
      await uploadAvatar(created.id);
      return created;
    },
    onSuccess: (created) => {
      setError(null);
      invalidate(created.id);
      navigate(`/worlds/${worldId}/characters/${created.id}`);
    },
    onError: (err) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      await api.put(`/api/worlds/${worldId}/characters/${agentId}`, toPayload(fields));
      await uploadAvatar(agentId);
    },
    onSuccess: () => {
      setError(null);
      setAvatarFile(null);
      invalidate(agentId);
    },
    onError: (err) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.del(`/api/worlds/${worldId}/characters/${agentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['characters', worldId] });
      navigate(`/worlds/${worldId}/characters`);
    },
    onError: (err) => setError(err.message),
  });

  const save = (event) => {
    event.preventDefault();
    setError(null);
    try {
      toPayload(fields);
    } catch (err) {
      setError(err.message);
      return;
    }
    if (isEdit) updateMutation.mutate();
    else createMutation.mutate();
  };

  const applyRaw = () => {
    try {
      const parsed = JSON.parse(rawJson);
      setFields(toFields(parsed));
      setError(null);
    } catch (err) {
      setError(`原始 JSON 无效：${err.message}`);
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const existingAvatar = isEdit && existingQuery.data?.avatar ? `/media/${worldId}/agents/${agentId}/${existingQuery.data.avatar}` : null;
  const resolveName = (id) => idToName.get(id) ?? id;

  if (existingQuery.isLoading) return <div className="skeleton-page">正在加载角色...</div>;
  if (existingQuery.error) return <StatusBanner tone="error">{existingQuery.error.message}</StatusBanner>;

  return (
    <form className="workspace character-detail" onSubmit={save}>
      <PageHeader
        title={isEdit ? fields.name || agentId : '新建角色'}
        subtitle="结构化管理角色卡文本、外观资产、标签可见性、技能、状态和原始数据。"
        actions={
          <>
            <Link to={`/worlds/${worldId}/characters`}>
              <Button>返回</Button>
            </Link>
            {isEdit && (
              <Button variant="danger" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
                删除
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? '保存中...' : isEdit ? '保存修改' : '创建角色'}
            </Button>
          </>
        }
      />

      {error && <StatusBanner tone="error">{error}</StatusBanner>}
      <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

      <div className="tab-surface">
        {activeTab === 'profile' && (
          <ProfileTab fields={fields} setField={setField} locations={locationsQuery.data?.locations ?? []} />
        )}
        {activeTab === 'appearance' && (
          <AppearanceTab
            worldId={worldId}
            agentId={agentId}
            fields={fields}
            avatarFile={avatarFile}
            setAvatarFile={setAvatarFile}
            existingAvatar={existingAvatar}
          />
        )}
        {activeTab === 'visibility' && (
          <VisibilityTab fields={fields} setField={setField} inspect={inspectQuery.data} />
        )}
        {activeTab === 'skills' && <SkillsTab fields={fields} setField={setField} />}
        {activeTab === 'state' && <StateTab state={currentCharacter?.state} resolveName={resolveName} />}
        {activeTab === 'memory' && <MemoryTab inspect={inspectQuery.data} />}
        {activeTab === 'raw' && <RawTab rawJson={rawJson} setRawJson={setRawJson} applyRaw={applyRaw} />}
      </div>
    </form>
  );
}
