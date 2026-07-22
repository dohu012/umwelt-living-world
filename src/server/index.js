import http from 'node:http';
import { createApp } from './app.js';
import { attachWebSocketServer } from './ws.js';
import { WorldWorker } from '../simulation/WorldWorker.js';

export function startServer({ projectRoot, dataDir, nimConfig, summarizeEveryNTurns = 0, port = 4001, host = '0.0.0.0' }) {
  const { app, worldRegistry, providerSettingsStore, roomManager } = createApp({
    projectRoot,
    dataDir,
    nimConfig,
    summarizeEveryNTurns,
  });
  const server = http.createServer(app);
  attachWebSocketServer(server, { worldRegistry, roomManager });
  const worldWorker = new WorldWorker(worldRegistry);
  worldWorker.start();

  server.listen(port, host, () => {
    console.log(`umwelt server listening on http://${host}:${port} (ws at /ws)`);
  });

  server.on('close', () => {
    worldWorker.stop();
    worldRegistry.closeAll();
  });

  return { server, app, worldRegistry, providerSettingsStore, roomManager, worldWorker };
}
