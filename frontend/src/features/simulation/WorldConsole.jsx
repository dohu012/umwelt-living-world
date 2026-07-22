import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { api } from '../../api/client.js';
import PageHeader from '../../components/layout/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Panel from '../../components/ui/Panel.jsx';
import StatusBanner from '../../components/ui/StatusBanner.jsx';

const NEED_LABELS = {
  energy: '精力',
  satiety: '饱腹',
  social: '社交',
  safety: '安全',
};

const ACTION_LABELS = {
  idle: '空闲',
  work: '工作',
  inspect: '调查',
  eat: '进食',
  sleep: '休息',
  socialize: '交流',
  shelter: '避难',
  deliberate: '思考重要选择',
  confront: '质问',
  report: '报告',
};

const EVENT_PRESETS = {
  typhoon: { title: '台风登陆', effects: ['heavy_rain', 'power_outage_risk', 'road_closure'] },
  storm: { title: '强风暴来袭', effects: ['heavy_rain', 'power_outage_risk'] },
  blackout: { title: '大范围停电', effects: ['power_outage'] },
  arrival: { title: '陌生访客抵达', effects: ['new_arrival'] },
  accident: { title: '突发事故', effects: ['danger'] },
};

function formatWorldTime(value) {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'UTC',
  }).format(new Date(value));
}

function worldInputValue(value, plusHours = 0) {
  const date = new Date(value ?? Date.now());
  date.setUTCHours(date.getUTCHours() + plusHours);
  return date.toISOString().slice(0, 16);
}

function toWorldIso(value) {
  return new Date(`${value}:00.000Z`).toISOString();
}

function NeedMeter({ name, value }) {
  const tone = value < 25 ? 'danger' : value < 50 ? 'warning' : 'healthy';
  return (
    <div className="need-meter">
      <div><span>{NEED_LABELS[name] ?? name}</span><strong>{Math.round(value)}</strong></div>
      <div className="need-track"><i className={tone} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    </div>
  );
}

function AgentCard({ agent }) {
  const location = agent.actionData?.location ?? agent.config?.shelterLocation ?? '未知地点';
  return (
    <article className="will-agent-card">
      <div className="will-agent-head">
        <div><strong>{agent.agentId}</strong><small>{location}</small></div>
        <Badge tone={agent.currentAction === 'deliberate' ? 'warning' : 'neutral'}>
          {ACTION_LABELS[agent.currentAction] ?? agent.currentAction}
        </Badge>
      </div>
      <div className="need-grid">
        {Object.entries(agent.needs ?? {}).map(([name, value]) => <NeedMeter key={name} name={name} value={value} />)}
      </div>
      {agent.config?.goals?.length > 0 && (
        <div className="agent-goals">{agent.config.goals.map((goal) => <span key={goal}>{goal}</span>)}</div>
      )}
    </article>
  );
}

function DecisionCard({ decision, onSuggest, pending }) {
  const [optionId, setOptionId] = useState(decision.options[0]?.id ?? '');
  const [content, setContent] = useState('');
  const due = decision.dueAt ? formatWorldTime(decision.dueAt) : '等待自主决定';
  return (
    <article className="decision-card">
      <div className="decision-meta">
        <Badge tone="warning">{decision.agentId}</Badge>
        <span>决定截止：{due}</span>
      </div>
      <h3>{decision.prompt}</h3>
      <div className="decision-options">
        {decision.options.map((option) => (
          <button
            type="button"
            className={optionId === option.id ? 'selected' : ''}
            onClick={() => setOptionId(option.id)}
            key={option.id}
          >
            <span>{option.label}</span>
            <small>自身倾向 {Math.round((option.weight ?? 0.5) * 100)}</small>
          </button>
        ))}
      </div>
      <div className="suggestion-composer">
        <input value={content} onChange={(event) => setContent(event.target.value)} placeholder="向他低语，但无法强迫他……" />
        <Button
          variant="primary"
          disabled={pending || !content.trim() || !optionId}
          onClick={() => onSuggest(decision.id, { content: content.trim(), optionId, strength: 0.7 }, () => setContent(''))}
        >
          提出建议
        </Button>
      </div>
      {decision.suggestions?.length > 0 && (
        <div className="suggestion-list">
          {decision.suggestions.map((item) => <span key={item.id}>已建议：{item.content}</span>)}
        </div>
      )}
    </article>
  );
}

function historyText(event) {
  if (event.type === 'world_event') {
    return `${event.data?.title ?? event.subject}：${event.key}`;
  }
  if (event.type === 'decision_resolved') {
    return `${event.actor} 决定「${event.content}」· ${event.data?.adviceOutcome ?? 'no_advice'}`;
  }
  if (event.type === 'dialogue' && event.data?.autonomous) {
    return `${event.actor}：${event.content}`;
  }
  if (event.type === 'narration' && event.data?.autonomous) {
    return event.content;
  }
  if (event.type === 'autonomous_scene') {
    return event.content;
  }
  const location = event.data?.location ? ` · ${event.data.location}` : '';
  return `${event.actor}：${ACTION_LABELS[event.content] ?? event.content}${location}`;
}

export default function WorldConsole() {
  const { worldId } = useParams();
  const queryClient = useQueryClient();
  const queryRoot = ['simulation', worldId];
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryRoot });
  const queryOptions = { refetchInterval: 5_000 };
  const clockQuery = useQuery({ queryKey: [...queryRoot, 'clock'], queryFn: () => api.get(`/api/worlds/${worldId}/simulation/clock`), ...queryOptions });
  const agentsQuery = useQuery({ queryKey: [...queryRoot, 'agents'], queryFn: () => api.get(`/api/worlds/${worldId}/simulation/agents`), ...queryOptions });
  const environmentQuery = useQuery({ queryKey: [...queryRoot, 'environment'], queryFn: () => api.get(`/api/worlds/${worldId}/simulation/environment`), ...queryOptions });
  const eventsQuery = useQuery({ queryKey: [...queryRoot, 'events'], queryFn: () => api.get(`/api/worlds/${worldId}/simulation/events`), ...queryOptions });
  const decisionsQuery = useQuery({ queryKey: [...queryRoot, 'decisions'], queryFn: () => api.get(`/api/worlds/${worldId}/simulation/decisions?status=open`), ...queryOptions });
  const historyQuery = useQuery({ queryKey: [...queryRoot, 'history'], queryFn: () => api.get(`/api/worlds/${worldId}/simulation/history?limit=80`), ...queryOptions });
  const providersQuery = useQuery({ queryKey: ['providers', 'world-console'], queryFn: () => api.get('/api/settings/providers') });
  const [eventForm, setEventForm] = useState({ kind: 'typhoon', title: '台风登陆', scheduledAt: '', intensity: 0.8, scope: 'world' });

  const controlMutation = useMutation({
    mutationFn: async (body) => {
      await api.post(`/api/worlds/${worldId}/simulation/clock`, body);
      return api.post(`/api/worlds/${worldId}/simulation/tick`, {});
    },
    onSuccess: refresh,
  });
  const tickMutation = useMutation({ mutationFn: () => api.post(`/api/worlds/${worldId}/simulation/tick`, {}), onSuccess: refresh });
  const eventMutation = useMutation({
    mutationFn: (body) => api.post(`/api/worlds/${worldId}/simulation/events`, body),
    onSuccess: () => { refresh(); setEventForm((current) => ({ ...current, scheduledAt: '' })); },
  });
  const suggestionMutation = useMutation({
    mutationFn: ({ id, body }) => api.post(`/api/worlds/${worldId}/simulation/decisions/${id}/suggestions`, body),
    onSuccess: (_, variables) => { refresh(); variables.after?.(); },
  });

  const errors = [clockQuery.error, agentsQuery.error, environmentQuery.error, eventsQuery.error, decisionsQuery.error, historyQuery.error, providersQuery.error]
    .filter(Boolean);
  const clock = clockQuery.data;
  const eventDate = eventForm.scheduledAt || worldInputValue(clock?.worldTime, 24);
  const environment = environmentQuery.data?.environment ?? [];
  const weather = useMemo(() => Object.fromEntries(environment.map((item) => [item.key, item.value])), [environment]);

  const submitEvent = (event) => {
    event.preventDefault();
    const preset = EVENT_PRESETS[eventForm.kind] ?? {};
    eventMutation.mutate({
      kind: eventForm.kind,
      title: eventForm.title || preset.title || eventForm.kind,
      scheduledAt: toWorldIso(eventDate),
      intensity: Number(eventForm.intensity),
      scope: eventForm.scope || 'world',
      data: { leadTimeMs: 6 * 60 * 60 * 1000, durationMs: 6 * 60 * 60 * 1000, effects: preset.effects ?? [] },
    });
  };

  return (
    <div className="workspace world-console">
      <PageHeader
        title="世界意志"
        subtitle={`${worldId} 不会等待你的注视。观察它、向其中的人低语，或改变他们共同面对的命运。`}
        actions={<Button onClick={() => tickMutation.mutate()} disabled={tickMutation.isPending}>立即同步</Button>}
      />
      {errors.length > 0 && <StatusBanner tone="error">{errors[0].message}</StatusBanner>}

      <section className="world-clock-hero">
        <div>
          <div className="ui-eyebrow">世界时间</div>
          <strong>{formatWorldTime(clock?.worldTime)}</strong>
          <span>{clock?.status === 'paused' ? '世界已暂停' : `${clock?.timeScale ?? 1}× 流速运行中`}</span>
        </div>
        <div className="clock-controls">
          <Button variant={clock?.status === 'paused' ? 'primary' : 'default'} onClick={() => controlMutation.mutate({ action: clock?.status === 'paused' ? 'resume' : 'pause' })}>
            {clock?.status === 'paused' ? '继续世界' : '暂停世界'}
          </Button>
          <select value={clock?.timeScale ?? 1} onChange={(event) => controlMutation.mutate({ action: 'set_scale', timeScale: Number(event.target.value) })}>
            {[1, 4, 12, 24, 60].map((value) => <option key={value} value={value}>{value}×</option>)}
          </select>
          {[1, 6, 24].map((hours) => <Button size="sm" key={hours} onClick={() => controlMutation.mutate({ action: 'advance', hours })}>+{hours}小时</Button>)}
        </div>
      </section>

      <div className="will-dashboard-grid">
        <div className="will-main-column">
          <Panel title="等待启示的选择" eyebrow="低语">
            {(decisionsQuery.data?.decisions ?? []).length === 0 ? (
              <EmptyState title="此刻无人向命运发问" body="世界继续运行；重要选择出现时会显示在这里。" />
            ) : (decisionsQuery.data.decisions.map((decision) => (
              <DecisionCard
                key={decision.id}
                decision={decision}
                pending={suggestionMutation.isPending}
                onSuggest={(id, body, after) => suggestionMutation.mutate({ id, body, after })}
              />
            )))}
          </Panel>

          <Panel title="居民状态" eyebrow="生命">
            <div className="will-agent-grid">
              {(agentsQuery.data?.agents ?? []).map((agent) => <AgentCard key={agent.agentId} agent={agent} />)}
            </div>
          </Panel>

          <Panel title="世界流动" eyebrow="历史">
            <div className="will-timeline">
              {(historyQuery.data?.events ?? []).map((event) => (
                <article key={event.id}>
                  <time>{formatWorldTime(event.ts)}</time>
                  <i className={`event-dot ${event.type}`} />
                  <div><strong>{historyText(event)}</strong><small>{event.type}</small></div>
                </article>
              ))}
              {(historyQuery.data?.events ?? []).length === 0 && <EmptyState title="世界刚刚醒来" body="生活行动、选择和大型事件会在这里形成历史。" />}
            </div>
          </Panel>
        </div>

        <aside className="will-side-column">
          <Panel title="Agent 自主交流" eyebrow="后台剧情">
            <div className="environment-list">
              <div>
                <span>运行状态</span>
                <Badge tone={providersQuery.data?.activeByKind?.dialogue ? 'success' : 'warning'}>
                  {providersQuery.data?.activeByKind?.dialogue ? '已启用' : '等待对话模型'}
                </Badge>
              </div>
              <p>角色在同一地点相遇后会自主开启场景。每个地点有 6 个世界小时冷却，对话会永久写入下方“世界流动”。</p>
            </div>
          </Panel>

          <Panel title="投放世界事件" eyebrow="命运">
            <form className="world-event-form" onSubmit={submitEvent}>
              <label>事件类型
                <select value={eventForm.kind} onChange={(event) => {
                  const kind = event.target.value;
                  setEventForm((current) => ({ ...current, kind, title: EVENT_PRESETS[kind]?.title ?? current.title }));
                }}>
                  {Object.keys(EVENT_PRESETS).map((kind) => <option key={kind} value={kind}>{EVENT_PRESETS[kind].title}</option>)}
                </select>
              </label>
              <label>事件名称<input value={eventForm.title} onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))} /></label>
              <label>发生时间<input type="datetime-local" value={eventDate} onChange={(event) => setEventForm((current) => ({ ...current, scheduledAt: event.target.value }))} /></label>
              <label>影响范围<input value={eventForm.scope} onChange={(event) => setEventForm((current) => ({ ...current, scope: event.target.value }))} /></label>
              <label>强度：{Math.round(eventForm.intensity * 100)}
                <input type="range" min="0.1" max="1" step="0.1" value={eventForm.intensity} onChange={(event) => setEventForm((current) => ({ ...current, intensity: Number(event.target.value) }))} />
              </label>
              <Button type="submit" variant="primary" disabled={eventMutation.isPending}>{eventMutation.isPending ? '写入命运...' : '发布事件'}</Button>
            </form>
          </Panel>

          <Panel title="环境状态" eyebrow="此刻">
            <div className="environment-list">
              <div><span>天气</span><strong>{String(weather['weather.current'] ?? 'clear')}</strong></div>
              <div><span>天气强度</span><strong>{String(weather['weather.intensity'] ?? 0)}</strong></div>
              {environment.filter((item) => item.key.startsWith('event.')).map((item) => (
                <div key={`${item.scope}:${item.key}`}><span>{item.key.replace('event.', '')}</span><strong>{item.value?.phase ?? String(item.value)}</strong></div>
              ))}
            </div>
          </Panel>

          <Panel title="已安排事件" eyebrow="未来">
            <div className="scheduled-event-list">
              {(eventsQuery.data?.events ?? []).map((event) => (
                <article key={event.id}>
                  <div><strong>{event.title}</strong><small>{event.scope} · 强度 {Math.round(event.intensity * 100)}</small></div>
                  <Badge tone={event.status === 'active' ? 'warning' : event.status === 'completed' ? 'neutral' : 'success'}>{event.status}</Badge>
                  <time>{formatWorldTime(event.scheduledAt)}</time>
                </article>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
