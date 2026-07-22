import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { openDb } from '../store/db.js';
import { EventStore } from '../store/EventStore.js';
import { AgentRegistry } from '../agents/AgentRegistry.js';
import { buildInspectionReport } from '../visibility/explain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const args = { agent: null, world: null, limit: 30, showDenied: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agent') args.agent = argv[++i];
    else if (argv[i] === '--world') args.world = argv[++i];
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--show-denied') args.showDenied = true;
    else if (argv[i] === '--json') args.json = true;
  }
  if (!args.agent) {
    console.error('Usage: inspect.js --agent <agentId> [--world w1] [--limit N] [--show-denied] [--json]');
    process.exit(1);
  }
  return args;
}

function main() {
  const { agent, world, limit, showDenied, json } = parseArgs(process.argv.slice(2));

  const config = yaml.load(fs.readFileSync(path.join(projectRoot, 'config/default.yaml'), 'utf8'));
  const worldId = world ?? config.world.id;
  const worldDir = path.join(projectRoot, config.world.dataDir, worldId);
  const dbPath = path.join(worldDir, 'events.db');

  const db = openDb(dbPath);
  const store = new EventStore(db);
  const agentRegistry = new AgentRegistry(worldDir);

  const output = buildInspectionReport({ agentId: agent, worldId, store, agentRegistry, limit, showDenied });

  if (json) {
    console.log(JSON.stringify(output, null, 2));
    db.close();
    return;
  }

  console.log(
    `Agent: ${output.agent} (${output.agentName})   World: ${worldId}   Cursor: last_seen_event_id = ${output.cursor}\n`,
  );
  console.log('Resolved policy:');
  console.log(`  allow: [${output.policy.allow.join(', ')}]`);
  console.log(`  deny:  [${output.policy.deny.join(', ')}]`);
  console.log(
    `  conditionalAllow: ${output.policy.conditionalAllow} entr${output.policy.conditionalAllow === 1 ? 'y' : 'ies'} present, not evaluated in v1\n`,
  );
  console.log(`State snapshot: ${JSON.stringify(output.stateSnapshot)}\n`);
  console.log(`Visible events (${output.visibleEvents.length}):`);
  for (const e of output.visibleEvents) {
    console.log(`  [id=${e.id} seq=${e.seq} tags=${e.tags.join(',')}] ${e.type} ${e.actor}: ${e.content}`);
  }

  if (showDenied) {
    console.log(`\nDenied events (${output.denied.length}):`);
    for (const e of output.denied) {
      console.log(`  [id=${e.id} seq=${e.seq} tags=${e.tags.join(',')}] ${e.type} ${e.actor}: ${e.content}`);
      for (const reason of e.reasons) console.log(`    - ${reason}`);
    }
  }

  db.close();
}

main();
