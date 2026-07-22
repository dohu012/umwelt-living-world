import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Panel from '../../components/ui/Panel.jsx';
import BackgroundLayer from './BackgroundLayer.jsx';
import ChatTimeline from './ChatTimeline.jsx';
import DialogueLayer from './DialogueLayer.jsx';
import PortraitLayer from './PortraitLayer.jsx';
import SceneStatusPanel from './SceneStatusPanel.jsx';
import SkillRunPanel from './SkillRunPanel.jsx';
import { useStageDirector } from './stageDirector.js';

function imageProgressText(imageStatus) {
  if (!imageStatus?.pending) return null;
  if (imageStatus.reason === 'location_change') {
    return `正在生成 ${imageStatus.locationName || imageStatus.location || '新地点'} 环境图`;
  }
  if (imageStatus.requestEdit) return '正在编辑当前图片';
  if (imageStatus.requestImage) return '正在生成场景图或角色立绘';
  return '正在检查是否需要出图';
}

export default function ImmersivePlayMode({
  worldId,
  location,
  currentLocation,
  roster,
  persona,
  personaState,
  state,
  sendMessage,
  promptSuggestions,
  focusAgentIds,
  idToName,
  modeActions,
  locationNameById,
}) {
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [hudAwake, setHudAwake] = useState(true);
  const hereCharacters = [...roster.values()].filter((character) => character.state?.location === location);
  const hereNames = hereCharacters.map((character) => character.name).slice(0, 4);
  const progressText = imageProgressText(state.imageStatus);
  const parseIssues = state.messages.filter((message) => message.parseError);
  const debugIssueCount = parseIssues.length + (state.error ? 1 : 0) + (state.imageStatus?.error ? 1 : 0);
  const stageSnapshot = useStageDirector({
    location,
    characters: hereCharacters,
    messages: state.messages,
    typingAgentIds: state.typingAgentIds,
    busy: state.busy,
  });

  useEffect(() => {
    if (debugOpen || backlogOpen) {
      setHudAwake(true);
      return undefined;
    }

    const timer = window.setTimeout(() => setHudAwake(false), 2200);
    return () => window.clearTimeout(timer);
  }, [debugOpen, backlogOpen, state.messages.length, state.busy]);

  const wakeHud = () => setHudAwake(true);

  return (
    <section
      className={`immersive-play ${debugOpen ? 'debug-open' : ''} ${backlogOpen ? 'backlog-open' : ''} ${hudAwake ? 'hud-awake' : 'hud-idle'}`}
      aria-label="沉浸式游玩模式"
      onMouseMove={wakeHud}
      onFocus={wakeHud}
    >
      <BackgroundLayer worldId={worldId} location={location} messages={state.messages} />
      <div className="immersive-backdrop" />

      <header className="immersive-hud">
        <div className="immersive-hud-left">
          <div className="immersive-location">
            <div className="ui-eyebrow">当前地点</div>
            <h1>{currentLocation?.name ?? location}</h1>
            <div className="immersive-meta">
              <Badge tone="info">在场 {hereCharacters.length} 人</Badge>
              <Badge tone={state.connected ? 'success' : 'warning'}>{state.connected ? '实时连接' : '连接中'}</Badge>
              {state.busy && <Badge tone="warning">场景结算中</Badge>}
              {personaState?.locationName && <Badge tone="neutral">你在：{personaState.locationName}</Badge>}
            </div>
          </div>
          {currentLocation?.description && <p className="immersive-location-desc">{currentLocation.description}</p>}
        </div>
        <div className="immersive-actions">
          {modeActions}
          <Link to={`/worlds/${worldId}/inspector?location=${encodeURIComponent(location)}`}>
            <Button size="sm">调试</Button>
          </Link>
        </div>
      </header>

      <div className="immersive-cast">
        <PortraitLayer
          worldId={worldId}
          location={location}
          characters={hereCharacters}
          messages={state.messages}
          typingAgentIds={state.typingAgentIds}
          focusAgentIds={focusAgentIds}
          stageSnapshot={stageSnapshot}
          variant="immersive"
        />
      </div>

      {progressText && (
        <div className="scene-transition-toast">
          <span className="connection-dot" />
          <strong>{progressText}</strong>
        </div>
      )}

      <aside className="immersive-status-dock" aria-hidden={!debugOpen}>
        <div className="immersive-dock-head">
          <strong>调试状态</strong>
          <div>
            <Link to={`/worlds/${worldId}/inspector?location=${encodeURIComponent(location)}`}>
              <Button size="sm">完整调试台</Button>
            </Link>
            <Button size="sm" onClick={() => setDebugOpen(false)}>
              收起
            </Button>
          </div>
        </div>
        {(debugIssueCount > 0 || state.imageStatus?.error) && (
          <Panel title="运行问题" eyebrow="调试">
            <div className="debug-issue-list">
              {state.error && <div className="debug-issue-item">{state.error}</div>}
              {state.imageStatus?.error && <div className="debug-issue-item">{state.imageStatus.error}</div>}
              {parseIssues.map((message) => (
                <div className="debug-issue-item" key={message.id}>
                  <strong>{roster.get(message.agentId)?.name ?? message.agentId ?? '未知角色'}</strong>
                  <span>{message.parseError}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
        <SceneStatusPanel
          location={location}
          currentLocation={currentLocation}
          roster={roster}
          persona={persona}
          personaState={personaState}
          idToName={idToName}
        />
        <SkillRunPanel
          intent={state.lastIntent}
          imageStatus={state.imageStatus}
          busy={state.busy}
          typingAgentIds={state.typingAgentIds}
          roster={roster}
        />
      </aside>

      <aside className="immersive-backlog-drawer" aria-hidden={!backlogOpen}>
        <div className="immersive-chat-head">
          <div>
            <span>聊天历史</span>
            <strong>{hereNames.length ? hereNames.join('、') : '当前地点暂无角色'}</strong>
          </div>
          <div className="immersive-chat-state">
            <span className={`connection-dot ${state.connected ? 'online' : 'offline'}`} />
            <span>{state.busy ? '结算中' : state.connected ? '可输入' : '连接中'}</span>
            <Button size="sm" onClick={() => setBacklogOpen(false)}>
              收起
            </Button>
          </div>
        </div>
        <ChatTimeline
          variant="immersive"
          worldId={worldId}
          messages={state.messages}
          roster={roster}
          persona={persona}
          typingAgentIds={state.typingAgentIds}
          intent={state.lastIntent}
          busy={state.busy}
          locationNameById={locationNameById}
        />
      </aside>

      <DialogueLayer
        worldId={worldId}
        messages={state.messages}
        roster={roster}
        persona={persona}
        personaState={personaState}
        idToName={idToName}
        stageSnapshot={stageSnapshot}
        connected={state.connected}
        busy={state.busy}
        typingAgentIds={state.typingAgentIds}
        suggestions={promptSuggestions}
        onSend={sendMessage}
        onToggleBacklog={() => setBacklogOpen((value) => !value)}
        backlogOpen={backlogOpen}
        onToggleDebug={() => setDebugOpen((value) => !value)}
        debugOpen={debugOpen}
        debugIssueCount={debugIssueCount}
      />
    </section>
  );
}
