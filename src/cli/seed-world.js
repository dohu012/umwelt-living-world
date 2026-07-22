import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { openDb } from '../store/db.js';
import { EventStore } from '../store/EventStore.js';
import { AgentRegistry } from '../agents/AgentRegistry.js';
import { seedInitialLocation } from '../agents/seedLocation.js';
import { LocationRegistry } from '../settings/LocationRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const args = { world: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--world') args.world = argv[++i];
  }
  return args;
}

function main() {
  const { world } = parseArgs(process.argv.slice(2));

  const config = yaml.load(fs.readFileSync(path.join(projectRoot, 'config/default.yaml'), 'utf8'));
  const worldId = world ?? config.world.id;
  const worldDir = path.join(projectRoot, config.world.dataDir, worldId);
  const dbPath = path.join(worldDir, 'events.db');

  const db = openDb(dbPath);
  const store = new EventStore(db);
  const agentRegistry = new AgentRegistry(worldDir);
  const locationRegistry = new LocationRegistry(path.join(worldDir, 'locations.json'));
  const startId = locationRegistry.getStartId();

  for (const agentId of agentRegistry.listAgentIds()) {
    const before = store.getFact(agentId, 'location');
    const fact = seedInitialLocation(store, agentId, startId);
    if (before) {
      console.log(`${agentId}: location already set to '${before.content}', skipping`);
    } else {
      console.log(`${agentId}: seeded location = '${fact.content}'`);
    }
  }

  db.close();
}

main();
