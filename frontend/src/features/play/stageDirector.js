import { useEffect, useMemo, useRef } from 'react';
import { buildStageActors, createStageSlotMap } from './stageLayout.js';

const PENDING_TEXT = '正在回应...';

export function useStageDirector({
  location,
  characters,
  messages,
  typingAgentIds = [],
  busy,
}) {
  const dialogueState = useMemo(
    () => deriveDialogueState({ messages, typingAgentIds, busy }),
    [messages, typingAgentIds, busy],
  );
  const previousSpeakerId = usePreviousSpeaker(dialogueState.speakerId);
  const rosterSignature = characters.map((character) => character.id).join('|');
  const stageLockRef = useRef(null);

  const stageState = useMemo(() => {
    const generating = dialogueState.generationPhase !== 'idle';
    const lockSignature = `${location}|${rosterSignature}`;
    let effectiveSpeakerId = dialogueState.speakerId;
    let effectiveDialogueMessage = dialogueState.dialogueMessage;

    if (stageLockRef.current?.signature !== lockSignature) {
      stageLockRef.current = null;
    }

    if (generating) {
      if (!stageLockRef.current || !stageLockRef.current.frozen || (dialogueState.speakerId && !stageLockRef.current.speakerId)) {
        stageLockRef.current = {
          signature: lockSignature,
          frozen: true,
          speakerId: dialogueState.speakerId,
          slotMap: createStageSlotMap({ characters, speakerId: dialogueState.speakerId }),
        };
      } else if (
        dialogueState.generationPhase !== 'thinking' &&
        dialogueState.speakerId &&
        stageLockRef.current.speakerId !== dialogueState.speakerId
      ) {
        stageLockRef.current = {
          signature: lockSignature,
          frozen: true,
          speakerId: dialogueState.speakerId,
          slotMap: createStageSlotMap({ characters, speakerId: dialogueState.speakerId }),
        };
      } else if (dialogueState.generationPhase === 'thinking' && stageLockRef.current.speakerId) {
        effectiveSpeakerId = stageLockRef.current.speakerId;
        if (effectiveDialogueMessage?.kind === 'agent-pending') {
          effectiveDialogueMessage = {
            ...effectiveDialogueMessage,
            id: `pending-${effectiveSpeakerId}`,
            agentId: effectiveSpeakerId,
          };
        }
      }
    } else {
      stageLockRef.current = {
        signature: lockSignature,
        frozen: false,
        speakerId: dialogueState.speakerId,
        slotMap: createStageSlotMap({ characters, speakerId: dialogueState.speakerId }),
      };
    }

    const stageActors = buildStageActors({
      characters,
      speakerId: effectiveSpeakerId,
      previousSpeakerId,
      typingAgentIds,
      slotMap: stageLockRef.current?.slotMap,
      location,
    });

    return {
      speakerId: effectiveSpeakerId,
      dialogueMessage: effectiveDialogueMessage,
      stageActors,
    };
  }, [
    characters,
    dialogueState.dialogueMessage,
    dialogueState.generationPhase,
    dialogueState.speakerId,
    location,
    previousSpeakerId,
    rosterSignature,
    typingAgentIds,
  ]);

  return {
    ...dialogueState,
    speakerId: stageState.speakerId,
    dialogueMessage: stageState.dialogueMessage,
    previousSpeakerId,
    stageActors: stageState.stageActors,
    hasFocus: Boolean(stageState.speakerId || typingAgentIds.length),
  };
}

function deriveDialogueState({ messages, typingAgentIds, busy }) {
  const latestTextMessage = findLatestMessage(
    messages,
    (message) => (message.kind === 'player' || message.kind === 'agent' || message.kind === 'agent-streaming') && message.text,
  );

  if (latestTextMessage?.kind === 'agent-streaming' && latestTextMessage.agentId) {
    return {
      speakerId: latestTextMessage.agentId,
      dialogueMessage: latestTextMessage,
      generationPhase: 'streaming',
    };
  }

  if (latestTextMessage?.kind === 'agent' && latestTextMessage.agentId) {
    return {
      speakerId: latestTextMessage.agentId,
      dialogueMessage: latestTextMessage,
      generationPhase: busy ? 'settling' : 'idle',
    };
  }

  const pendingAgentId = typingAgentIds[0];
  if (pendingAgentId && (busy || typingAgentIds.length > 0)) {
    return {
      speakerId: pendingAgentId,
      dialogueMessage: {
        id: `pending-${pendingAgentId}`,
        kind: 'agent-pending',
        agentId: pendingAgentId,
        text: PENDING_TEXT,
      },
      generationPhase: 'thinking',
    };
  }

  return {
    speakerId: null,
    dialogueMessage: latestTextMessage,
    generationPhase: busy ? 'settling' : 'idle',
  };
}

function findLatestMessage(messages, predicate) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (predicate(message)) return message;
  }
  return null;
}

function usePreviousSpeaker(speakerId) {
  const previousRef = useRef(null);
  const previousSpeakerId = previousRef.current && previousRef.current !== speakerId ? previousRef.current : null;

  useEffect(() => {
    if (speakerId) previousRef.current = speakerId;
  }, [speakerId]);

  return previousSpeakerId;
}
