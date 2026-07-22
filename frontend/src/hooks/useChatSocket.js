import { useEffect, useReducer, useRef, useCallback } from 'react';

function initialState() {
  return {
    connected: false,
    participants: [],
    messages: [],
    typingAgentIds: [],
    error: null,
    lastIntent: null,
    imageStatus: null,
    background: null,
    busy: false,
    worldIntro: null,
    worldIntroDismissed: false,
  };
}

function withoutTyping(ids, agentId) {
  return ids.filter((id) => id !== agentId);
}

function reducer(state, action) {
  switch (action.type) {
    case 'reset_scene':
      return initialState();
    case 'connected':
      return { ...state, connected: true, error: null };
    case 'disconnected':
      return { ...state, connected: false };
    case 'seed_history':
      return { ...state, messages: action.messages };
    case 'joined':
      return { ...state, participants: action.participants };
    case 'player_message_ack': {
      const { event } = action;
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: `evt-${event.id}`, kind: 'player', actor: event.actor, text: event.content, locationId: action.location },
        ],
      };
    }
    case 'intent_dispatch':
      return {
        ...state,
        lastIntent: {
          intent: action.intent,
          responderIds: action.responderIds,
          flags: action.flags,
          notes: action.notes,
        },
      };
    case 'agent_typing':
      return { ...state, typingAgentIds: [...new Set([...state.typingAgentIds, action.agentId])] };
    case 'agent_token': {
      const { agentId, delta } = action;
      const idx = state.messages.findLastIndex((m) => m.kind === 'agent-streaming' && m.agentId === agentId);
      if (idx === -1) {
        return {
          ...state,
          messages: [
            ...state.messages,
            { id: `stream-${agentId}-${Date.now()}`, kind: 'agent-streaming', agentId, text: delta, locationId: action.location },
          ],
        };
      }
      const messages = state.messages.slice();
      messages[idx] = { ...messages[idx], text: messages[idx].text + delta };
      return { ...state, messages };
    }
    case 'agent_message': {
      const { agentId, dialogueText, updates, parseError, state: agentState } = action;
      const idx = state.messages.findLastIndex((m) => m.kind === 'agent-streaming' && m.agentId === agentId);
      const finalMsg = {
        id: action.eventId ? `evt-${action.eventId}` : `msg-${Date.now()}-${agentId}`,
        kind: 'agent',
        agentId,
        text: dialogueText,
        updates,
        parseError,
        agentState,
        locationId: action.location,
      };
      const messages =
        idx === -1 ? [...state.messages, finalMsg] : state.messages.map((m, i) => (i === idx ? finalMsg : m));
      return { ...state, messages, typingAgentIds: withoutTyping(state.typingAgentIds, agentId) };
    }
    case 'agent_turn_error':
      return {
        ...state,
        typingAgentIds: withoutTyping(state.typingAgentIds, action.agentId),
        error: `${action.agentId}: ${action.error}`,
      };
    // The agent chose not to speak this turn (see promptBuilder.js's SILENT_MARKER convention) —
    // just clear its typing indicator, same as a real reply would, but produce no message bubble.
    case 'agent_silent':
      return { ...state, typingAgentIds: withoutTyping(state.typingAgentIds, action.agentId) };
    case 'narration_message':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.eventId ? `evt-${action.eventId}` : `narration-${Date.now()}`,
            kind: 'narration',
            text: action.text,
            locationId: action.location,
          },
        ],
      };
    case 'world_intro':
      return {
        ...state,
        worldIntro: {
          name: action.name,
          subtitle: action.subtitle,
          playerRole: action.playerRole,
          summary: action.summary,
          environment: action.environment,
          openingNarration: action.openingNarration,
          openingAgentId: action.openingAgentId,
          openingAgentName: action.openingAgentName,
          openingLine: action.openingLine,
          location: action.location,
        },
        worldIntroDismissed: false,
      };
    case 'dismiss_world_intro':
      return { ...state, worldIntroDismissed: true };
    case 'scene_image_pending':
      return {
        ...state,
        imageStatus: {
          pending: true,
          requestImage: action.requestImage,
          reason: action.reason,
          location: action.location,
          locationName: action.locationName,
        },
      };
    case 'scene_image': {
      if (action.skipped) {
        return { ...state, imageStatus: { pending: false, skipped: true, reason: action.reason } };
      }
      if (action.error) {
        return { ...state, imageStatus: { pending: false, error: action.error } };
      }
      const nextMessages = [...state.messages];
      for (const img of action.images || []) {
        const src = img.mediaUrl || img.url;
        if (!src) continue;
        nextMessages.push({
          id: `img-${Date.now()}-${img.image_type}`,
          kind: 'image',
          imageType: img.image_type,
          src,
          actor: img.actor,
          subject: img.subject,
          agentId: img.agentId || img.agent_id || img.subject,
          prompt: img.prompt,
          locationId: action.location,
          location: action.location || img.location || null,
          locationName: action.locationName || img.locationName || null,
          reason: action.reason || img.reason || null,
        });
      }
      return {
        ...state,
        messages: nextMessages,
        imageStatus: {
          pending: false,
          images: action.images,
          detect: action.detect,
          reason: action.reason,
          location: action.location,
          locationName: action.locationName,
        },
      };
    }
    // Visual asset library frames. These are independent of the turn lifecycle — a portrait or
    // backdrop can land mid-scene or long after scene_done — so none of them touch `busy`.
    case 'portrait_ready':
      return {
        ...state,
        participants: state.participants.map((p) =>
          p.agentId === action.agentId ? { ...p, avatar: action.avatar } : p,
        ),
      };
    case 'background_ready':
      return { ...state, background: { url: action.url, variantKey: action.variantKey } };
    case 'scene_pending':
      return { ...state, busy: true, error: null };
    case 'scene_done':
      return {
        ...state,
        busy: false,
        imageStatus: state.imageStatus?.pending ? { ...state.imageStatus, pending: false } : state.imageStatus,
      };
    case 'error':
      return { ...state, busy: false, error: action.message };
    default:
      return state;
  }
}

/**
 * Live WS chat state for one worldId+location room. Seeds from `history` once, then applies live
 * frames. `onLocationChanged` (fired when the player's own location fact moves them to a new
 * room) is a routing concern, not chat state, so it's invoked directly rather than reduced into
 * `state` — kept in a ref so passing a fresh arrow function each render doesn't reconnect the socket.
 */
export function useChatSocket({ worldId, location, personaId, history, enabled, onLocationChanged, onSceneDone }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const wsRef = useRef(null);
  const seededRef = useRef(false);
  const onLocationChangedRef = useRef(onLocationChanged);
  onLocationChangedRef.current = onLocationChanged;
  const onSceneDoneRef = useRef(onSceneDone);
  onSceneDoneRef.current = onSceneDone;

  // Only a genuinely different world or player identity should clear the chat view — switching
  // rooms within the same world/persona must NOT wipe `state.messages` anymore. The player's
  // history is now a cross-location timeline (see `history`'s source query), so it already covers
  // every room they've been in; wiping it on every move would just be re-losing the same context
  // this was built to stop losing (see the plan doc's "在场即留痕" section).
  useEffect(() => {
    seededRef.current = false;
    dispatch({ type: 'reset_scene' });
  }, [worldId, personaId]);

  useEffect(() => {
    if (history && !seededRef.current) {
      dispatch({ type: 'seed_history', messages: history });
      seededRef.current = true;
    }
  }, [history]);

  useEffect(() => {
    if (!enabled || !worldId || !location || !personaId) return undefined;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      dispatch({ type: 'connected' });
      ws.send(JSON.stringify({ type: 'join', worldId, location, personaId }));
    };
    ws.onclose = () => dispatch({ type: 'disconnected' });
    ws.onerror = () => dispatch({ type: 'error', message: 'WebSocket 连接失败' });
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'location_changed') {
        onLocationChangedRef.current?.(msg.location);
        return;
      }
      if (msg.type === 'scene_done') {
        onSceneDoneRef.current?.();
      }
      // `location` is this effect's own closed-over room — correct even for messages that arrive
      // just before a move, since a location change tears down this effect (see the dependency
      // array below) and reconnects with a fresh closure over the new room.
      dispatch({ ...msg, type: msg.type, location });
    };

    return () => ws.close();
  }, [worldId, location, personaId, enabled]);

  const sendMessage = useCallback((content) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      dispatch({ type: 'scene_pending' }); // lock the turn until scene_done / error
      wsRef.current.send(JSON.stringify({ type: 'player_message', content }));
    }
  }, []);

  const dismissWorldIntro = useCallback(() => {
    dispatch({ type: 'dismiss_world_intro' });
  }, []);

  return { state, sendMessage, dismissWorldIntro };
}
