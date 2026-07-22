import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import PageHeader from '../../components/layout/PageHeader.jsx';
import StatusBanner from '../../components/ui/StatusBanner.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { useActivePersona } from '../../hooks/useActivePersona.js';
import { useChatSocket } from '../../hooks/useChatSocket.js';
import ChatTimeline from './ChatTimeline.jsx';
import Composer from './Composer.jsx';
import ImmersivePlayMode from './ImmersivePlayMode.jsx';
import ParticipantsPanel from './ParticipantsPanel.jsx';
import SceneStage from './SceneStage.jsx';
import SceneStatusPanel from './SceneStatusPanel.jsx';
import SkillRunPanel from './SkillRunPanel.jsx';
import GraphPlaceholder from '../graph/GraphPlaceholder.jsx';
import WorldIntroOverlay from './WorldIntroOverlay.jsx';
import { buildIdNameMap, historyToMessages } from './playUtils.js';

const PLAY_VIEW_MODE_KEY = 'umwelt.playViewMode';

export default function PlayShell() {
  const { worldId, location } = useParams();
  const [activePersonaId] = useActivePersona();
  const [mobileTab, setMobileTab] = useState('chat');
  const [graphActive, setGraphActive] = useState(false);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(PLAY_VIEW_MODE_KEY) || 'immersive');
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const locationsQuery = useQuery({
    queryKey: ['locations', worldId],
    queryFn: () => api.get(`/api/worlds/${worldId}/locations`),
  });
  const worldQuery = useQuery({
    queryKey: ['world', worldId],
    queryFn: () => api.get(`/api/worlds/${worldId}`),
  });
  const rosterQuery = useQuery({
    queryKey: ['characters', worldId],
    queryFn: () => api.get(`/api/worlds/${worldId}/characters`),
    refetchInterval: graphActive ? 2500 : false,
    refetchOnWindowFocus: true,
  });
  const personasQuery = useQuery({ queryKey: ['personas'], queryFn: () => api.get('/api/personas') });
  const personaStateQuery = useQuery({
    queryKey: ['personaState', worldId, activePersonaId],
    queryFn: () => api.get(`/api/worlds/${worldId}/personas/${activePersonaId}/state`),
    enabled: Boolean(activePersonaId),
  });
  // Keyed on personaId, not location: this is the player's own cross-location timeline (everywhere
  // they've actually been present), so a room switch must not re-key/refetch or reset it — see
  // useChatSocket.js, which stopped wiping `state.messages` on location change to match.
  const historyQuery = useQuery({
    queryKey: ['timeline', worldId, activePersonaId],
    queryFn: () => api.get(`/api/worlds/${worldId}/personas/${activePersonaId}/timeline`),
    enabled: Boolean(activePersonaId),
    retry: false,
  });

  const roster = useMemo(() => {
    const map = new Map();
    for (const character of rosterQuery.data?.characters ?? []) map.set(character.id, character);
    return map;
  }, [rosterQuery.data]);

  const personas = personasQuery.data?.personas ?? [];
  const persona = personas.find((item) => item.id === activePersonaId);
  const locations = locationsQuery.data?.locations ?? [];
  const currentLocation = locations.find((item) => item.id === location);
  const locationNameById = useMemo(() => {
    const map = new Map();
    for (const item of locations) map.set(item.id, item.name);
    return map;
  }, [locations]);
  const history = useMemo(
    () => (historyQuery.data ? historyToMessages(historyQuery.data.events, activePersonaId) : null),
    [historyQuery.data, activePersonaId],
  );

  const { state, sendMessage, dismissWorldIntro } = useChatSocket({
    worldId,
    location,
    personaId: activePersonaId,
    history,
    enabled: Boolean(activePersonaId) && (historyQuery.isSuccess || historyQuery.isError),
    onLocationChanged: (nextLocation) => {
      navigate(`/worlds/${worldId}/play/${encodeURIComponent(nextLocation)}`);
      queryClient.invalidateQueries({ queryKey: ['characters', worldId] });
      queryClient.invalidateQueries({ queryKey: ['personaState', worldId, activePersonaId] });
      queryClient.invalidateQueries({ queryKey: ['locations', worldId] });
    },
    onSceneDone: () => {
      queryClient.invalidateQueries({ queryKey: ['characters', worldId] });
      queryClient.invalidateQueries({ queryKey: ['personaState', worldId, activePersonaId] });
      queryClient.invalidateQueries({ queryKey: ['locations', worldId] });
    },
  });

  const idToName = useMemo(
    () => buildIdNameMap({ roster, personas, persona }),
    [roster, personas, persona],
  );
  const hereCharacters = useMemo(
    () => [...roster.values()].filter((character) => character.state?.location === location),
    [roster, location],
  );
  const promptSuggestions = useMemo(() => {
    const firstName = hereCharacters[0]?.name;
    return [
      '观察当前地点，描述我能看到的细节',
      firstName ? `询问${firstName}现在正在做什么` : '呼叫一位在场角色回应我',
      '生成当前场景图',
    ];
  }, [hereCharacters]);
  const hereNames = hereCharacters.map((character) => character.name).slice(0, 4);
  const focusAgentIds = state.typingAgentIds.length > 0 ? state.typingAgentIds : state.lastIntent?.responderIds ?? [];

  // The authored intro is re-viewable any time from world metadata — not only on the
  // one-shot first-enter world_intro frame.
  const [introManuallyOpen, setIntroManuallyOpen] = useState(false);
  const worldMeta = worldQuery.data?.metadata;
  const metadataIntro = useMemo(() => {
    if (!worldMeta?.intro) return null;
    return {
      name: worldMeta.name,
      subtitle: worldMeta.subtitle,
      playerRole: worldMeta.intro.playerRole,
      summary: worldMeta.intro.summary,
      environment: worldMeta.intro.environment,
    };
  }, [worldMeta]);
  const showIntroOverlay = Boolean(state.worldIntro && !state.worldIntroDismissed) || introManuallyOpen;
  const introOverlayData = state.worldIntro ?? metadataIntro;
  const closeIntroOverlay = () => {
    dismissWorldIntro();
    setIntroManuallyOpen(false);
  };

  const setPlayViewMode = (nextMode) => {
    setViewMode(nextMode);
    localStorage.setItem(PLAY_VIEW_MODE_KEY, nextMode);
  };

  if (!activePersonaId) {
    return (
      <EmptyState
        title="请先选择玩家身份"
        body="智能体会通过玩家身份来感知你，因此进入游玩场景前需要启用一个身份。"
        action={
          <Link to="/persona">
            <Button variant="primary">打开玩家身份</Button>
          </Link>
        }
      />
    );
  }

  if (rosterQuery.isLoading || locationsQuery.isLoading || personasQuery.isLoading) {
    return <div className="skeleton-page">正在加载场景...</div>;
  }
  if (rosterQuery.error) return <StatusBanner tone="error">{rosterQuery.error.message}</StatusBanner>;
  if (locationsQuery.error) return <StatusBanner tone="error">{locationsQuery.error.message}</StatusBanner>;
  if (personasQuery.error) return <StatusBanner tone="error">{personasQuery.error.message}</StatusBanner>;

  const modeActions = (
    <>
      <div className="play-mode-switch" role="group" aria-label="游玩模式">
        <button
          type="button"
          className={viewMode === 'immersive' ? 'active' : ''}
          onClick={() => setPlayViewMode('immersive')}
        >
          沉浸
        </button>
        <button
          type="button"
          className={viewMode === 'console' ? 'active' : ''}
          onClick={() => setPlayViewMode('console')}
        >
          控制台
        </button>
      </div>
      {metadataIntro && (
        <Button size="sm" onClick={() => setIntroManuallyOpen(true)}>
          介绍
        </Button>
      )}
      <Button size="sm" onClick={toggleFullscreen}>
        {isFullscreen ? '退出全屏' : '全屏'}
      </Button>
      {locations.length > 1 && (
        <div className="location-switcher">
          <Button size="sm" disabled={state.busy} onClick={() => setLocationMenuOpen((value) => !value)}>
            切换地点
          </Button>
          {locationMenuOpen && (
            <div className="location-switcher-menu" role="menu">
              {locations.map((item) => {
                const count = [...roster.values()].filter(
                  (character) => character.state?.location === item.id,
                ).length;
                return (
                  <button
                    type="button"
                    role="menuitem"
                    key={item.id}
                    className={item.id === location ? 'active' : ''}
                    onClick={() => {
                      setLocationMenuOpen(false);
                      if (item.id !== location) {
                        navigate(`/worlds/${worldId}/play/${encodeURIComponent(item.id)}`);
                      }
                    }}
                  >
                    <span>{item.name}</span>
                    <small>{item.id === location ? '当前位置' : count > 0 ? `${count} 人在场` : '无人'}</small>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );

  const systemBanners = (
    <>
      {state.error && <StatusBanner tone="error">{state.error}</StatusBanner>}
      {historyQuery.isError && (
        <StatusBanner tone="warning">当前房间历史不可用，WebSocket 仍会继续解析你的实际位置。</StatusBanner>
      )}
    </>
  );

  if (viewMode === 'immersive') {
    return (
      <div className="play-shell immersive-shell">
        {showIntroOverlay && <WorldIntroOverlay intro={introOverlayData} onDismiss={closeIntroOverlay} />}
        {(state.error || historyQuery.isError) && <div className="immersive-banners">{systemBanners}</div>}
        <ImmersivePlayMode
          worldId={worldId}
          location={location}
          currentLocation={currentLocation}
          roster={roster}
          persona={persona}
          personaState={personaStateQuery.data}
          state={state}
          sendMessage={sendMessage}
          promptSuggestions={promptSuggestions}
          focusAgentIds={focusAgentIds}
          idToName={idToName}
          modeActions={modeActions}
          locationNameById={locationNameById}
        />
      </div>
    );
  }

  return (
    <div className={`play-shell mobile-tab-${mobileTab}`}>
      {showIntroOverlay && <WorldIntroOverlay intro={introOverlayData} onDismiss={closeIntroOverlay} />}
      <PageHeader
        title={currentLocation?.name ?? location}
        subtitle="场景游玩工作台：集中呈现本地对话、场景状态、在场角色和技能流水线。"
        actions={
          <div className="play-header-actions">
            {modeActions}
            <Button active={graphActive} onClick={() => setGraphActive(!graphActive)}>
              关系图谱
            </Button>
            <Link to={`/worlds/${worldId}/inspector?location=${encodeURIComponent(location)}`}>
              <Button>打开调试台</Button>
            </Link>
          </div>
        }
      />

      {systemBanners}

      <div className="play-context-bar">
        <div>
          <span className="context-label">当前地点</span>
          <strong>{currentLocation?.name ?? location}</strong>
        </div>
        <div>
          <span className="context-label">在场角色</span>
          <strong>{hereNames.length ? hereNames.join('、') : '暂无'}</strong>
        </div>
        <div>
          <span className="context-label">玩家身份</span>
          <strong>{persona?.name ?? activePersonaId}</strong>
        </div>
        <div className="context-state">
          <span className={`connection-dot ${state.connected ? 'online' : 'offline'}`} />
          <strong>{state.busy ? '场景结算中' : state.connected ? '可输入' : '连接中'}</strong>
        </div>
      </div>

      {graphActive ? (
        <GraphPlaceholder roster={roster} worldId={worldId} location={location} />
      ) : (
      <div className="play-grid">
        <section className="play-main">
          <SceneStage
            worldId={worldId}
            location={location}
            currentLocation={currentLocation}
            roster={roster}
            persona={persona}
            personaState={personaStateQuery.data}
            typingAgentIds={state.typingAgentIds}
            connected={state.connected}
            busy={state.busy}
            messages={state.messages}
            focusAgentIds={focusAgentIds}
            imageStatus={state.imageStatus}
          />
          <div className="conversation-surface">
            <div className="run-status-bar">
              <span className={`connection-dot ${state.connected ? 'online' : 'offline'}`} />
              <strong>{state.connected ? '实时通道已连接' : '正在连接实时通道'}</strong>
              <small>{state.messages.length} 条消息</small>
              <small>{state.busy ? '系统正在结算本轮场景' : '可以输入下一句'}</small>
            </div>
            <ChatTimeline
              worldId={worldId}
              messages={state.messages}
              roster={roster}
              persona={persona}
              typingAgentIds={state.typingAgentIds}
              intent={state.lastIntent}
              busy={state.busy}
              locationNameById={locationNameById}
            />
            {state.typingAgentIds.length > 0 && (
              <div className="typing-strip">
                {state.typingAgentIds.map((id) => roster.get(id)?.name ?? id).join('、')} 正在回复
              </div>
            )}
            {state.busy && state.typingAgentIds.length === 0 && <div className="typing-strip">正在结算场景...</div>}
            <Composer connected={state.connected} busy={state.busy} onSend={sendMessage} suggestions={promptSuggestions} />
          </div>
        </section>

        <aside className="play-side">
          <div className="mobile-panel-group status-mobile-group">
            <ParticipantsPanel worldId={worldId} location={location} roster={roster} typingAgentIds={state.typingAgentIds} />
            <SceneStatusPanel
              location={location}
              currentLocation={currentLocation}
              roster={roster}
              persona={persona}
              personaState={personaStateQuery.data}
              idToName={idToName}
            />
          </div>
          <div className="mobile-panel-group inspect-mobile-group">
            <SkillRunPanel
              intent={state.lastIntent}
              imageStatus={state.imageStatus}
              busy={state.busy}
              typingAgentIds={state.typingAgentIds}
              roster={roster}
            />
          </div>
        </aside>
      </div>
      )}

      <nav className="mobile-play-tabs" aria-label="游玩页移动端标签">
        {[
          ['chat', '对话'],
          ['status', '状态'],
          ['inspect', '调试'],
          ['graph', '关系图谱'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={(id === 'graph' ? graphActive : mobileTab === id) ? 'active' : ''}
            onClick={() => {
              if (id === 'graph') {
                setGraphActive(!graphActive);
              } else {
                setGraphActive(false);
                setMobileTab(id);
              }
            }}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
