import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WorldWorker } from '../src/simulation/WorldWorker.js';

test('a broken world does not prevent later worlds from ticking', async () => {
  const ticked = [];
  const errors = [];
  const registry = {
    listWorldIds: () => ['broken', 'healthy'],
    getWorld: (worldId) => ({
      engine: {
        async tick() {
          ticked.push(worldId);
          if (worldId === 'broken') throw new Error('broken world');
          return { processed: 1 };
        },
      },
    }),
  };
  const worker = new WorldWorker(registry, {
    onError: (error, context) => errors.push({ error: error.message, ...context }),
  });

  const results = await worker.tickOnce();
  assert.deepEqual(ticked, ['broken', 'healthy']);
  assert.deepEqual(results, [
    { worldId: 'broken', ok: false, error: 'broken world' },
    { worldId: 'healthy', ok: true, processed: 1 },
  ]);
  assert.deepEqual(errors, [{ error: 'broken world', worldId: 'broken' }]);
});

test('background ticks use the same per-world exclusivity hook as interactive turns', async () => {
  const calls = [];
  const registry = {
    listWorldIds: () => ['world'],
    getWorld: () => ({ engine: { tick: async () => ({ processed: 0 }) } }),
  };
  const worker = new WorldWorker(registry, {
    runWorld: async (worldId, job) => {
      calls.push(`lock:${worldId}`);
      return job();
    },
  });
  await worker.tickOnce();
  assert.deepEqual(calls, ['lock:world']);
});
