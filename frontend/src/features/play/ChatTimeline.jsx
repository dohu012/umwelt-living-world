import { useEffect, useRef } from 'react';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ChatMessage from './ChatMessage.jsx';
import {
  characterAvatarCandidates,
  firstMediaSrc,
  personaAvatarCandidates,
  shouldUseHeadshotCrop,
} from '../assets/characterMedia.js';

function groupMessages(messages) {
  const groups = [];
  let current = null;

  for (const message of messages) {
    if (message.kind === 'player' || !current) {
      current = {
        id: message.kind === 'player' ? message.id : `history-${message.id}`,
        player: message.kind === 'player' ? message : null,
        responses: message.kind === 'player' ? [] : [message],
      };
      groups.push(current);
      continue;
    }
    current.responses.push(message);
  }

  return groups;
}

function responseAgentIds(group) {
  return [
    ...new Set(
      group.responses
        .filter((message) => message.kind === 'agent' || message.kind === 'agent-streaming')
        .map((message) => message.agentId)
        .filter(Boolean),
    ),
  ];
}

/** message id -> location display name, for every message where the location actually changed
 * from the immediately preceding one (never the very first message — that's just where history
 * starts, not a "change"). History can now span multiple locations since an agent's/player's own
 * memory follows them across moves (see the plan doc's "在场即留痕" tagging) — this is what lets
 * the timeline mark those transitions instead of silently blending rooms together. */
function computeSceneMarkers(messages, locationNameById) {
  const markers = new Map();
  let last;
  for (const message of messages) {
    if (message.locationId == null) continue;
    if (message.locationId !== last) {
      if (last !== undefined) {
        markers.set(message.id, locationNameById?.get(message.locationId) ?? message.locationId);
      }
      last = message.locationId;
    }
  }
  return markers;
}

/** The group's own first message (player line if this group has one, else its first response) —
 * what a scene-change marker should be checked against and rendered above. */
function firstMessageOf(group) {
  return group.player ?? group.responses[0] ?? null;
}

export default function ChatTimeline({
  worldId,
  messages,
  roster,
  persona,
  typingAgentIds,
  intent,
  busy,
  locationNameById,
  variant = 'console',
}) {
  const scrollRef = useRef(null);
  const immersive = variant === 'immersive';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, typingAgentIds]);

  const nameFor = (agentId) => roster.get(agentId)?.name ?? agentId;
  const groups = groupMessages(messages);
  const latestGroupId = groups.at(-1)?.id;
  const sceneMarkers = computeSceneMarkers(messages, locationNameById);

  return (
    <div className={`chat-timeline ${immersive ? 'immersive' : ''}`.trim()} ref={scrollRef}>
      {messages.length === 0 && (
        <EmptyState
          title="当前场景还没有消息"
          body="发送一句话，开始这个地点中的本地事件流。"
        />
      )}

      {groups.map((group, index) => {
        const isLatest = group.id === latestGroupId;
        const scheduledIds = isLatest && intent?.responderIds?.length ? intent.responderIds : responseAgentIds(group);
        const scheduledNames = scheduledIds.map((id) => nameFor(id));
        const waitingNames = typingAgentIds.map((id) => nameFor(id));
        const sceneMarkerName = sceneMarkers.get(firstMessageOf(group)?.id);
        return (
          <div key={group.id}>
            {sceneMarkerName && <div className="scene-change-divider">场景切换到 {sceneMarkerName}</div>}
            <section className={`turn-group ${immersive ? 'immersive' : ''}`.trim()}>
              <header className={`turn-header ${immersive ? 'compact' : ''}`.trim()}>
                <div>
                  {!immersive && <span>第 {index + 1} 回合</span>}
                  {group.player ? <strong>{persona?.name ?? '你'} 发起</strong> : <strong>{immersive ? '场景记录' : '历史事件'}</strong>}
                </div>
                <div className="turn-meta">
                  {!immersive &&
                    (scheduledNames.length > 0 ? (
                      <Badge tone="info">响应角色：{scheduledNames.join('、')}</Badge>
                    ) : (
                      <Badge tone="neutral">暂无响应角色</Badge>
                    ))}
                  {isLatest && busy && <Badge tone="warning">结算中</Badge>}
                  {isLatest && waitingNames.length > 0 && <Badge tone="success">正在回复：{waitingNames.join('、')}</Badge>}
                </div>
              </header>

              {group.player && (
                <ChatMessage
                  message={group.player}
                  mine
                  label={persona?.name ?? '你'}
                  avatarCandidates={personaAvatarCandidates(persona)}
                  variant={variant}
                />
              )}

              {group.responses.length > 0 ? (
                group.responses.map((message) => {
                  const mine = message.kind === 'player';
                  const character = roster.get(message.agentId);
                  const label = mine ? persona?.name ?? '你' : nameFor(message.agentId);
                  const avatarCandidates = mine
                    ? personaAvatarCandidates(persona)
                    : characterAvatarCandidates({ worldId, character, messages });
                  return (
                    <ChatMessage
                      key={message.id}
                      message={message}
                      mine={mine}
                      label={label}
                      avatarSrc={firstMediaSrc(avatarCandidates)}
                      avatarCandidates={avatarCandidates}
                      avatarClassName={shouldUseHeadshotCrop(avatarCandidates) ? 'headshot' : ''}
                      state={character?.state}
                      variant={variant}
                    />
                  );
                })
              ) : (
                <div className="turn-empty-response">
                  {isLatest && busy ? '正在等待角色回应...' : '本回合没有角色回复。'}
                </div>
              )}
            </section>
          </div>
        );
      })}
    </div>
  );
}
