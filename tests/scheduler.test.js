import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TurnScheduler } from '../src/orchestrator/TurnScheduler.js';

test('round-robin with a periodic director slot', () => {
  const scheduler = new TurnScheduler(['alice', 'bob'], { directorEveryNRounds: 2 });
  const schedule = scheduler.buildSchedule(4);

  assert.deepEqual(schedule, [
    { kind: 'agent', agentId: 'alice', round: 1 },
    { kind: 'agent', agentId: 'bob', round: 1 },
    { kind: 'agent', agentId: 'alice', round: 2 },
    { kind: 'agent', agentId: 'bob', round: 2 },
    { kind: 'director', round: 2 },
    { kind: 'agent', agentId: 'alice', round: 3 },
    { kind: 'agent', agentId: 'bob', round: 3 },
    { kind: 'agent', agentId: 'alice', round: 4 },
    { kind: 'agent', agentId: 'bob', round: 4 },
    { kind: 'director', round: 4 },
  ]);
});

test('directorEveryNRounds = 0 disables the director slot entirely', () => {
  const scheduler = new TurnScheduler(['alice'], { directorEveryNRounds: 0 });
  const schedule = scheduler.buildSchedule(3);
  assert.equal(schedule.every((s) => s.kind === 'agent'), true);
  assert.equal(schedule.length, 3);
});

test('throws on empty agentOrder', () => {
  assert.throws(() => new TurnScheduler([]));
});
