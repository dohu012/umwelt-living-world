import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client.js';
import { useActivePersona } from '../../hooks/useActivePersona.js';
import { useWorlds } from '../../hooks/useWorlds.js';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Panel from '../../components/ui/Panel.jsx';
import PageHeader from '../../components/layout/PageHeader.jsx';
import StatusBanner from '../../components/ui/StatusBanner.jsx';

function readinessTone(ready) {
  return ready ? 'success' : 'warning';
}

function LaunchChecklist({ worlds, activePersonaId, providerState, providerLoading }) {
  const providerReady = Boolean(
    providerState?.activeId
      || Object.keys(providerState?.activeByKind || {}).length
      || providerState?.providers?.length,
  );
  const items = [
    {
      label: '玩家身份',
      ready: Boolean(activePersonaId),
      detail: activePersonaId ? '已选择当前使用身份' : '进入场景前需要一个玩家身份',
      to: '/persona',
      action: activePersonaId ? '查看' : '去设置',
    },
    {
      label: '世界',
      ready: worlds.length > 0,
      detail: worlds.length > 0 ? `已发现 ${worlds.length} 个世界` : '先创建一个可游玩的世界',
      action: '创建世界',
    },
    {
      label: '模型服务',
      ready: providerReady,
      detail: providerLoading ? '正在检查模型服务配置' : providerReady ? '已有模型服务配置' : '未配置时角色无法稳定回复',
      to: '/settings/providers',
      action: providerLoading ? '检查中' : providerReady ? '查看' : '去配置',
    },
  ];

  return (
    <section className="launch-console">
      <div>
        <div className="ui-eyebrow">启动检查</div>
        <h2>进入多智能体世界前，先确认关键条件</h2>
        <p>完成身份、世界和模型服务后，可以直接从世界卡片进入当前地点开始游玩。</p>
      </div>
      <div className="launch-checklist">
        {items.map((item) => {
          const content = (
            <>
              <span className={`readiness-dot ${readinessTone(item.ready)}`} />
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
              <em>{item.ready ? '就绪' : item.action}</em>
            </>
          );
          return item.to ? (
            <Link className="launch-check-item" to={item.to} key={item.label}>
              {content}
            </Link>
          ) : (
            <div className="launch-check-item" key={item.label}>
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WorldCard({
  worldId,
  activePersonaId,
  onNeedPersona,
  copyState,
  deleteState,
  onOpenCopy,
  onOpenDelete,
  onCancelCopy,
  onCancelDelete,
  onCopy,
  onDelete,
}) {
  const navigate = useNavigate();
  const [playError, setPlayError] = useState(null);
  const isCopyOpen = copyState.worldId === worldId;
  const isDeleteOpen = deleteState.worldId === worldId;
  const locationsQuery = useQuery({
    queryKey: ['locations', worldId],
    queryFn: () => api.get(`/api/worlds/${worldId}/locations`),
  });
  const charactersQuery = useQuery({
    queryKey: ['characters', worldId],
    queryFn: () => api.get(`/api/worlds/${worldId}/characters`),
  });
  const enterMutation = useMutation({
    mutationFn: () => api.post(`/api/worlds/${worldId}/personas/${activePersonaId}/enter`, {}),
    onSuccess: ({ location }) => navigate(`/worlds/${worldId}/play/${encodeURIComponent(location)}`),
    onError: (err) => setPlayError(err.message),
  });

  const handlePlay = () => {
    setPlayError(null);
    if (!activePersonaId) {
      onNeedPersona();
      return;
    }
    enterMutation.mutate();
  };

  const characters = charactersQuery.data?.characters ?? [];
  const locations = locationsQuery.data?.locations ?? [];
  const readyForPlay = Boolean(activePersonaId && characters.length > 0 && locations.length > 0);
  const activeCharacters = characters.filter((character) => character.state?.location);

  return (
    <Panel title={worldId} eyebrow="世界" className="world-card-panel">
      {playError && <StatusBanner tone="error">{playError}</StatusBanner>}
      <div className="world-card-topline">
        <div>
          <strong>{readyForPlay ? '可以进入游玩' : '需要补齐配置'}</strong>
          <p>
            {readyForPlay
              ? '当前身份可进入该世界，并从所在地点继续体验。'
              : '请确认已选择身份，并且世界中存在地点和角色。'}
          </p>
        </div>
        <span className={`readiness-pill ${readyForPlay ? 'success' : 'warning'}`}>
          {readyForPlay ? '已就绪' : '待配置'}
        </span>
      </div>
      <div className="world-stats">
        <span>{characters.length} 个角色</span>
        <span>{locations.length} 个地点</span>
        <span>{activeCharacters.length} 个已放置角色</span>
      </div>
      <div className="world-card-actions">
        <Button variant="primary" onClick={handlePlay} disabled={enterMutation.isPending}>
          {enterMutation.isPending ? '进入中...' : '进入游玩'}
        </Button>
        <Link to={`/worlds/${worldId}/characters`}>
          <Button>编辑角色</Button>
        </Link>
        <Link to={`/worlds/${worldId}/inspector`}>
          <Button>打开调试台</Button>
        </Link>
        <Button onClick={() => onOpenCopy(worldId)}>复制</Button>
        <Button variant="danger" onClick={() => onOpenDelete(worldId)}>
          删除
        </Button>
      </div>
      {isCopyOpen && (
        <div className="copy-panel">
          <input
            value={copyState.name}
            onChange={(event) => copyState.setName(event.target.value)}
            placeholder={`新世界名（默认 ${worldId}-copy）`}
            aria-label="新世界名"
          />
          <p className="copy-hint">角色卡原样复制。选择对上下文的处理：</p>
          <div className="world-card-actions">
            <Button variant="primary" disabled={copyState.isPending} onClick={() => onCopy(worldId, true)}>
              保留上下文
            </Button>
            <Button disabled={copyState.isPending} onClick={() => onCopy(worldId, false)}>
              清空上下文
            </Button>
            <Button disabled={copyState.isPending} onClick={onCancelCopy}>
              取消
            </Button>
          </div>
          {copyState.error && <StatusBanner tone="error">{copyState.error}</StatusBanner>}
        </div>
      )}
      {isDeleteOpen && (
        <div className="copy-panel">
          <p className="copy-hint">
            删除世界 <strong>{worldId}</strong>？将永久移除它的角色卡、对话历史、关系与地点，不可恢复。
          </p>
          <div className="world-card-actions">
            <Button variant="danger" disabled={deleteState.isPending} onClick={() => onDelete(worldId)}>
              确认删除
            </Button>
            <Button disabled={deleteState.isPending} onClick={onCancelDelete}>
              取消
            </Button>
          </div>
          {deleteState.error && <StatusBanner tone="error">{deleteState.error}</StatusBanner>}
        </div>
      )}
    </Panel>
  );
}

export default function WorldDashboard() {
  const { data, isLoading, error } = useWorlds();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [activePersonaId] = useActivePersona();
  const [name, setName] = useState('');
  const [copyFor, setCopyFor] = useState(null);
  const [copyName, setCopyName] = useState('');
  const [deleteFor, setDeleteFor] = useState(null);
  const providersQuery = useQuery({
    queryKey: ['providers', 'dashboard'],
    queryFn: () => api.get('/api/settings/providers'),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: ({ name: worldName } = {}) => api.post('/api/worlds', { name: worldName }),
    onSuccess: (created) => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['worlds'] });
      navigate(`/worlds/${created.id}/characters`);
    },
  });
  // Stays on the dashboard: the new world card appears with its own「进入」button,
  // and first enter fires the authored world intro.
  const createDefaultMutation = useMutation({
    mutationFn: () => api.post('/api/worlds', { template: '纠缠号', name: '纠缠号' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worlds'] });
    },
  });
  const copyMutation = useMutation({
    mutationFn: ({ worldId, keepContext }) =>
      api.post(`/api/worlds/${worldId}/copy`, { keepContext, name: copyName.trim() || undefined }),
    onSuccess: () => {
      setCopyFor(null);
      setCopyName('');
      queryClient.invalidateQueries({ queryKey: ['worlds'] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (worldId) => api.del(`/api/worlds/${worldId}`),
    onSuccess: () => {
      setDeleteFor(null);
      queryClient.invalidateQueries({ queryKey: ['worlds'] });
    },
  });

  if (isLoading) return <div className="skeleton-page">正在加载世界...</div>;
  if (error) return <StatusBanner tone="error">{error.message}</StatusBanner>;

  const worlds = data?.worlds ?? [];

  return (
    <div className="workspace world-dashboard">
      <PageHeader
        title="世界总览"
        subtitle="从这里完成启动检查、选择世界、进入当前身份所在地点，或打开调试台观察模拟状态。"
        actions={
          <Link to="/persona">
            <Button>{activePersonaId ? '身份已就绪' : '选择身份'}</Button>
          </Link>
        }
      />

      <LaunchChecklist
        worlds={worlds}
        activePersonaId={activePersonaId}
        providerState={providersQuery.data}
        providerLoading={providersQuery.isLoading}
      />

      {worlds.length === 0 ? (
        <EmptyState title="没有找到世界" body="创建一个世界后，就可以开始管理地点、角色和游玩入口。" />
      ) : (
        <div className="world-grid">
          {worlds.map((worldId) => (
            <WorldCard
              key={worldId}
              worldId={worldId}
              activePersonaId={activePersonaId}
              onNeedPersona={() => navigate('/persona')}
              copyState={{
                worldId: copyFor,
                name: copyName,
                setName: setCopyName,
                isPending: copyMutation.isPending,
                error: copyMutation.isError ? copyMutation.error.message : null,
              }}
              deleteState={{
                worldId: deleteFor,
                isPending: deleteMutation.isPending,
                error: deleteMutation.isError ? deleteMutation.error.message : null,
              }}
              onOpenCopy={(selectedWorldId) => {
                setCopyFor(copyFor === selectedWorldId ? null : selectedWorldId);
                setCopyName('');
                setDeleteFor(null);
              }}
              onOpenDelete={(selectedWorldId) => {
                setDeleteFor(deleteFor === selectedWorldId ? null : selectedWorldId);
                setCopyFor(null);
                setCopyName('');
              }}
              onCancelCopy={() => {
                setCopyFor(null);
                setCopyName('');
              }}
              onCancelDelete={() => setDeleteFor(null)}
              onCopy={(selectedWorldId, keepContext) => copyMutation.mutate({ worldId: selectedWorldId, keepContext })}
              onDelete={(selectedWorldId) => deleteMutation.mutate(selectedWorldId)}
            />
          ))}
        </div>
      )}

      <Panel title="创建世界" eyebrow="构建">
        {(createMutation.isError || createDefaultMutation.isError) && (
          <StatusBanner tone="error">
            {(createMutation.error || createDefaultMutation.error)?.message}
          </StatusBanner>
        )}

        <div className="world-create-presets">
          <div className="world-preset-card">
            <div>
              <strong>纠缠号：退相干之夜</strong>
              <p>默认故事世界：四名船员、量子链路事故、完整开场介绍与自动首句。创建后可直接进入游玩。</p>
            </div>
            <Button
              variant="primary"
              disabled={createDefaultMutation.isPending}
              onClick={() => createDefaultMutation.mutate()}
            >
              {createDefaultMutation.isPending ? '创建中…' : '创建此默认世界'}
            </Button>
          </div>
        </div>

        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) createMutation.mutate({ name: name.trim() });
          }}
        >
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="或自建空白世界，例如：锈锚酒馆" />
          <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
            创建空白世界
          </Button>
        </form>
      </Panel>
    </div>
  );
}
