import { useMemo, useState } from 'react';
import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import {
  characterAvatarCandidates,
  firstMediaSrc,
  personaAvatarCandidates,
  shouldUseHeadshotCrop,
} from '../assets/characterMedia.js';
import Composer from './Composer.jsx';
import { resolveIdsInText } from './playUtils.js';

function latestTextMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if ((message.kind === 'agent' || message.kind === 'agent-streaming' || message.kind === 'player') && message.text) {
      return message;
    }
  }
  return null;
}

function speakerFor({ message, roster, persona, personaState }) {
  if (!message) {
    return {
      name: '场景',
      role: '等待输入',
      locationName: personaState?.locationName,
      mood: null,
      action: null,
      streaming: false,
    };
  }

  if (message.kind === 'player') {
    return {
      name: persona?.name ?? '你',
      role: '玩家',
      locationName: personaState?.locationName,
      mood: personaState?.mood,
      action: personaState?.action,
      streaming: false,
    };
  }

  const character = roster.get(message.agentId);
  const state = character?.state ?? message.agentState;
  return {
    name: character?.name ?? message.agentId ?? '未知角色',
    role: '角色',
    locationName: state?.locationName,
    mood: state?.mood,
    action: state?.action,
    streaming: message.kind === 'agent-streaming' || message.kind === 'agent-pending',
  };
}

export default function DialogueLayer({
  worldId,
  messages,
  roster,
  persona,
  personaState,
  idToName,
  stageSnapshot,
  connected,
  busy,
  typingAgentIds,
  suggestions,
  onSend,
  onToggleBacklog,
  backlogOpen,
  onToggleDebug,
  debugOpen,
  debugIssueCount,
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const message = useMemo(() => stageSnapshot?.dialogueMessage ?? latestTextMessage(messages), [messages, stageSnapshot]);
  const speaker = speakerFor({ message, roster, persona, personaState });
  const waitingNames = typingAgentIds.map((id) => roster.get(id)?.name ?? id);
  const text = message
    ? resolveIdsInText(message.text, idToName)
    : '你可以直接观察地点、点名角色，或者推进当前场景。';
  const speakerCharacter = isAgentDialogue(message) ? roster.get(message.agentId) : null;
  const avatarCandidates =
    message?.kind === 'player'
      ? personaAvatarCandidates(persona)
      : speakerCharacter
        ? characterAvatarCandidates({ worldId, character: speakerCharacter, messages })
        : [];

  return (
    <section className="dialogue-layer" aria-label="当前对白">
      <div className="dialogue-main">
        <header className="dialogue-speaker">
          <div className="dialogue-nameplate">
            <Avatar
              src={firstMediaSrc(avatarCandidates)}
              srcCandidates={avatarCandidates}
              name={speaker.name}
              size="lg"
              className={`dialogue-avatar ${shouldUseHeadshotCrop(avatarCandidates) ? 'headshot' : ''}`.trim()}
            />
            <div className="dialogue-speaker-text">
              <strong>{speaker.name}</strong>
              <div className="dialogue-tags">
                <Badge tone={speaker.role === '玩家' ? 'info' : 'neutral'}>{speaker.role}</Badge>
                {speaker.locationName && <Badge tone="neutral">{speaker.locationName}</Badge>}
                {speaker.streaming && <Badge tone="success">生成中</Badge>}
              </div>
            </div>
          </div>
          <div className="dialogue-actions">
            <Button size="sm" onClick={() => setActionsOpen((value) => !value)}>
              {actionsOpen ? '收起操作' : '操作'}
            </Button>
            <Button size="sm" onClick={onToggleBacklog}>
              {backlogOpen ? '收起聊天' : '展开聊天'}
            </Button>
            <Button size="sm" onClick={onToggleDebug}>
              {debugOpen ? '收起调试' : debugIssueCount ? `展开调试 · ${debugIssueCount}` : '展开调试'}
            </Button>
          </div>
        </header>

        <div className={`dialogue-text ${message?.kind === 'player' ? 'player' : 'agent'}`}>
          <p>「{text}」</p>
          {speaker.action && <small>{speaker.action}</small>}
          {!message && <small>沉浸模式只显示最新对白，完整历史可从“历史”打开。</small>}
        </div>

        <footer className="dialogue-footer">
          <div className="dialogue-status">
            <span className={`connection-dot ${connected ? 'online' : 'offline'}`} />
            <span>
              {busy
                ? waitingNames.length
                  ? `${waitingNames.join('、')} 正在回复`
                  : '正在结算场景'
                : connected
                  ? '可输入'
                  : '连接中'}
            </span>
          </div>
          <Composer
            connected={connected}
            busy={busy}
            onSend={onSend}
            suggestions={actionsOpen ? suggestions : []}
            variant="immersive"
          />
        </footer>
      </div>
    </section>
  );
}

function isAgentDialogue(message) {
  return message?.kind === 'agent' || message?.kind === 'agent-streaming' || message?.kind === 'agent-pending';
}
