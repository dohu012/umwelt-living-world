import path from 'node:path';
import express from 'express';
import { WorldRegistry } from './WorldRegistry.js';
import { RoomManager } from './RoomManager.js';
import { ProviderSettingsStore } from '../settings/ProviderSettingsStore.js';
import { PersonaStore } from '../settings/PersonaStore.js';
import { worldsRouter } from './routes/worlds.js';
import { charactersRouter } from './routes/characters.js';
import { messagesRouter } from './routes/messages.js';
import { timelineRouter } from './routes/timeline.js';
import { settingsRouter } from './routes/settings.js';
import { personasRouter } from './routes/personas.js';
import { simulationRouter } from './routes/simulation.js';

export function createApp({ projectRoot, dataDir, nimConfig, summarizeEveryNTurns = 0 }) {
  const providerSettingsStore = new ProviderSettingsStore(
    path.join(projectRoot, 'data/settings/providers.json'),
  );
  providerSettingsStore.seedFromEnv(nimConfig);

  const worldRegistry = new WorldRegistry({ projectRoot, dataDir, providerSettingsStore });

  const personasDir = path.join(projectRoot, 'data/settings/personas');
  const personaStore = new PersonaStore(path.join(projectRoot, 'data/settings/personas.json'));

  const roomManager = new RoomManager({ worldRegistry, providerSettingsStore, personaStore, summarizeEveryNTurns });

  const app = express();
  app.use(express.json());

  app.use('/api/worlds', worldsRouter(worldRegistry, { personaStore }));
  app.use('/api/worlds/:worldId/characters', charactersRouter(worldRegistry, { providerSettingsStore }));
  app.use('/api/worlds/:worldId/locations/:location', messagesRouter(worldRegistry));
  app.use('/api/worlds/:worldId/personas/:personaId', timelineRouter(worldRegistry));
  app.use('/api/worlds/:worldId/simulation', simulationRouter(worldRegistry));
  app.use('/api/settings', settingsRouter(providerSettingsStore));
  app.use('/api/personas', personasRouter(personaStore, { personasDir }));

  // Avatar/background static assets: /media/<worldId>/agents/<agentId>/<avatar> and
  // /media/personas/<personaId>/<avatar>.
  app.use('/media', express.static(worldRegistry.worldsRoot));
  app.use('/media/personas', express.static(personasDir));

  app.use((req, res) => {
    res.status(404).json({ error: `no route for ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

  return { app, worldRegistry, providerSettingsStore, personaStore, roomManager };
}
