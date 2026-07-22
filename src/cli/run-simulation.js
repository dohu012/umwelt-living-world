import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { openDb } from '../store/db.js';
import { EventStore } from '../store/EventStore.js';
import { createLLMClient } from '../llm/LLMClient.js';
import { loadEnv } from '../config/loadEnv.js';
import { AgentRegistry } from '../agents/AgentRegistry.js';
import { TurnRunner } from '../orchestrator/TurnRunner.js';
import { TurnScheduler } from '../orchestrator/TurnScheduler.js';
import { SimulationLoop } from '../orchestrator/SimulationLoop.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const args = { agent: null, agents: null, rounds: 3, directorEvery: null, summarizeEvery: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agent') args.agent = argv[++i];
    else if (argv[i] === '--agents') args.agents = argv[++i].split(',').map((s) => s.trim());
    else if (argv[i] === '--rounds') args.rounds = Number(argv[++i]);
    else if (argv[i] === '--director-every') args.directorEvery = Number(argv[++i]);
    else if (argv[i] === '--summarize-every') args.summarizeEvery = Number(argv[++i]);
  }
  const agentOrder = args.agents ?? (args.agent ? [args.agent] : null);
  if (!agentOrder || agentOrder.length === 0) {
    console.error(
      'Usage: run-simulation.js --agent <agentId> | --agents <id1,id2,...> [--rounds N] [--director-every N] [--summarize-every N]',
    );
    process.exit(1);
  }
  return { agentOrder, rounds: args.rounds, directorEvery: args.directorEvery, summarizeEvery: args.summarizeEvery };
}

async function main() {
  const { agentOrder, rounds, directorEvery, summarizeEvery } = parseArgs(process.argv.slice(2));

  loadEnv(path.join(projectRoot, '.env'));

  const config = yaml.load(fs.readFileSync(path.join(projectRoot, 'config/default.yaml'), 'utf8'));

  // StepFun is OpenAI-compatible, so it slots straight into the NIM client's chat/completions call.
  if (process.env.STEPFUN_API_KEY) {
    config.nim = {
      ...config.nim,
      baseUrl: process.env.STEPFUN_BASE_URL || 'https://api.stepfun.com/step_plan',
      model: process.env.STEPFUN_MODEL || 'step-3.7-flash',
      apiKey: process.env.STEPFUN_API_KEY,
      reasoningEffort: process.env.STEPFUN_REASONING_EFFORT || 'low',
      // step-3.7-flash spends real completion tokens on hidden reasoning before it
      // writes the reply, even at low effort, and that length varies run to run —
      // needs generous headroom beyond the 300 default or replies truncate to empty.
      maxTokens: config.nim.maxTokens && config.nim.maxTokens > 300 ? config.nim.maxTokens : 1500,
    };
  }

  const worldDir = path.join(projectRoot, config.world.dataDir, config.world.id);
  const dbPath = path.join(worldDir, 'events.db');

  const db = openDb(dbPath);
  const store = new EventStore(db);
  const llmClient = createLLMClient(config);
  const agentRegistry = new AgentRegistry(worldDir);
  const summarizeEveryNTurns = summarizeEvery ?? config.turn.summarizeEveryNTurns ?? 0;
  const turnRunner = new TurnRunner({ store, llmClient, agentRegistry, worldDir, summarizeEveryNTurns });

  for (const agentId of agentOrder) {
    agentRegistry.loadProfile(agentId); // fails loudly if profile.json is missing/invalid
    if (!store.getFact(agentId, 'location')) {
      console.error(`Agent "${agentId}" has no state.location fact — run seed-world.js first.`);
      process.exit(1);
    }
  }

  const directorEveryNRounds = directorEvery ?? config.turn.directorEveryNRounds ?? 0;
  const scheduler = new TurnScheduler(agentOrder, { directorEveryNRounds });
  const loop = new SimulationLoop({ store, scheduler, turnRunner });

  console.log(
    `Running ${rounds} round(s) for agents [${agentOrder.join(', ')}] against ${config.nim.baseUrl} ` +
      `(director every ${directorEveryNRounds || 'never'} round(s), summarize every ${summarizeEveryNTurns || 'never'} turn(s))\n`,
  );

  let lastRound = 0;
  await loop.run(rounds, {
    onSlot: (slot, result) => {
      if (slot.round !== lastRound) {
        process.stdout.write(`--- round ${slot.round} ---\n`);
        lastRound = slot.round;
      }
      if (slot.kind === 'director') {
        console.log(`[director] ${result.content}`);
        return;
      }
      console.log(`${slot.agentId}: ${result.dialogueText}`);
      if (result.updates.length > 0) {
        console.log(`  [updates] ${JSON.stringify(result.updates)}`);
      }
      if (result.parseError) {
        console.log(`  [parse warning] ${result.parseError}`);
      }
      if (result.summarized) {
        console.log(`  [memory] summary updated for ${slot.agentId}`);
      }
    },
  });

  db.close();
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
