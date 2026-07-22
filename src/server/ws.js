import { WebSocketServer } from 'ws';
import { movePersonaToLocation, resolvePersonaLocation } from '../agents/seedLocation.js';
import { maybeRunWorldIntro } from '../world/worldIntro.js';

function participantsAt({ store, agentRegistry, location }) {
  return agentRegistry
    .listAgentIds()
    .filter((agentId) => store.getFact(agentId, 'location')?.content === location)
    .map((agentId) => {
      const profile = agentRegistry.loadProfile(agentId);
      return { agentId, name: profile.name, avatar: profile.avatar ?? null };
    });
}

export function attachWebSocketServer(server, { worldRegistry, roomManager }) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON frame' }));
        return;
      }

      try {
        if (msg.type === 'join') {
          const { worldId, location, personaId } = msg;
          if (!worldId || !location || !personaId) {
            ws.send(JSON.stringify({ type: 'error', message: 'join requires worldId, location, personaId' }));
            return;
          }
          if (!worldRegistry.worldExists(worldId)) {
            ws.send(JSON.stringify({ type: 'error', message: `world "${worldId}" not found` }));
            return;
          }
          const { store, agentRegistry, locationRegistry, metadata } = worldRegistry.getWorld(worldId);
          const previousLocation = store.getFact(personaId, 'location')?.content ?? null;
          // Ensure the persona has some location fact (first enter → world start).
          resolvePersonaLocation({ store, personaId, locationRegistry });
          const beforeMove = store.getFact(personaId, 'location')?.content ?? previousLocation;

          // If the client asked for a registered room (e.g. clicked「进入后巷」), teleport there.
          // Previously we ignored the requested room and forced the stored fact, then bounced the
          // UI back via location_changed — so UI location links always snapped to start.
          let joinLocation = location;
          if (locationRegistry.get(location)) {
            movePersonaToLocation({ store, personaId, locationId: location });
            joinLocation = location;
          } else {
            joinLocation = resolvePersonaLocation({ store, personaId, locationRegistry });
          }

          roomManager.join(ws, { worldId, location: joinLocation, personaId });
          ws.send(
            JSON.stringify({
              type: 'joined',
              worldId,
              location: joinLocation,
              participants: participantsAt({ store, agentRegistry, location: joinLocation }),
            }),
          );
          if (location !== joinLocation) {
            ws.send(
              JSON.stringify({
                type: 'location_changed',
                location: joinLocation,
                locationName: locationRegistry.get(joinLocation)?.name,
              }),
            );
          }

          // UI / bookmark 换地点：进房后异步现生成目的地环境图（不阻塞 join）。
          if (beforeMove && beforeMove !== joinLocation) {
            roomManager
              .scheduleEnvironmentOnArrival({
                ws,
                worldId,
                locationId: joinLocation,
                personaId,
                fromLocationId: beforeMove,
              })
              .catch((err) => {
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
              });
          }

          maybeRunWorldIntro({
            store,
            agentRegistry,
            metadata,
            personaId,
            locationId: joinLocation,
            sendFrame: (frame) => {
              if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
            },
          });
          return;
        }

        if (msg.type === 'player_message') {
          if (!ws.umweltRoom) {
            ws.send(JSON.stringify({ type: 'error', message: 'join a room before sending messages' }));
            return;
          }
          if (!msg.content || typeof msg.content !== 'string') {
            ws.send(JSON.stringify({ type: 'error', message: 'player_message requires string content' }));
            return;
          }
          roomManager
            .handlePlayerMessage({ ws, content: msg.content })
            .catch((err) => {
              ws.send(JSON.stringify({ type: 'error', message: err.message }));
            });
          return;
        }

        ws.send(JSON.stringify({ type: 'error', message: `unknown message type "${msg.type}"` }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('close', () => roomManager.leave(ws));
  });

  return wss;
}
