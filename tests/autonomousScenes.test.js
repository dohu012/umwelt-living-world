import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import { JobQueue } from '../src/simulation/JobQueue.js';
import { AutonomousSceneScheduler } from '../src/simulation/AutonomousSceneScheduler.js';
import { AutonomousSceneRunner } from '../src/simulation/AutonomousSceneRunner.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-scenes-'));
  const db = openDb(path.join(dir, 'events.db'));
  const store = new EventStore(db);
  const queue = new JobQueue(db);
  return { db, store, queue, dir, close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('co-located active agents schedule one cooldown-bounded autonomous scene', () => {
  const f = fixture();
  try {
    const scheduler = new AutonomousSceneScheduler({ db: f.db, queue: f.queue, cooldownHours: 6 });
    const lifeAt = (at) => ({ actions: [
      { agentId: 'alice', at, action: { type: 'work', location: 'bridge' } },
      { agentId: 'bob', at, action: { type: 'socialize', location: 'bridge' } },
    ] });
    assert.equal(scheduler.scheduleFromLife(lifeAt('2026-07-22T01:00:00.000Z'), '2026-07-22T01:00:00.000Z').length, 1);
    assert.equal(scheduler.scheduleFromLife(lifeAt('2026-07-22T02:00:00.000Z'), '2026-07-22T02:00:00.000Z').length, 0);
    assert.equal(scheduler.scheduleFromLife(lifeAt('2026-07-22T07:00:00.000Z'), '2026-07-22T07:00:00.000Z').length, 1);
    assert.equal(f.queue.listDue('2026-07-22T07:00:00.000Z').length, 2);
  } finally { f.close(); }
});

test('world engine executes a newly scheduled autonomous scene in the same synchronization', async () => {
  const queue = [];
  const fakeQueue = {
    listDue: () => queue.filter((job) => job.status === 'pending'),
    markRunning: (id) => { const job = queue.find((item) => item.id === id); job.status = 'running'; return true; },
    complete: (id) => { queue.find((item) => item.id === id).status = 'completed'; },
    fail: () => {},
  };
  const { WorldEngine } = await import('../src/simulation/WorldEngine.js');
  const calls = [];
  const engine = new WorldEngine({
    clock: { synchronize: () => ({ worldTime: '2026-07-22T02:00:00.000Z' }) },
    queue: fakeQueue,
    worldEvents: {},
    lifeSimulator: { advanceTo: () => ({ actions: [{ agentId: 'alice' }] }) },
    sceneScheduler: { scheduleFromLife: () => {
      queue.push({ id: 1, type: 'autonomous_scene', status: 'pending', payload: { location: 'bridge' } });
      return [queue[0]];
    } },
    autonomousScenes: { run: async (payload) => { calls.push(payload); return { status: 'completed' }; } },
  });
  const result = await engine.tick();
  assert.equal(result.scheduledScenes, 1);
  assert.equal(result.processed, 1);
  assert.equal(calls.length, 1);
});

test('a meaningful earlier catch-up step is not hidden by a later idle step', () => {
  const f = fixture();
  try {
    const scheduler = new AutonomousSceneScheduler({ db: f.db, queue: f.queue });
    const actions = [
      { agentId: 'alice', at: '2026-07-22T01:00:00.000Z', action: { type: 'work', location: 'bridge' } },
      { agentId: 'bob', at: '2026-07-22T01:00:00.000Z', action: { type: 'work', location: 'bridge' } },
      { agentId: 'alice', at: '2026-07-22T02:00:00.000Z', action: { type: 'idle', location: 'bridge' } },
      { agentId: 'bob', at: '2026-07-22T02:00:00.000Z', action: { type: 'idle', location: 'bridge' } },
    ];
    const [job] = scheduler.scheduleFromLife({ actions }, '2026-07-22T02:00:00.000Z');
    assert.equal(job.payload.triggeredAt, '2026-07-22T01:00:00.000Z');
  } finally { f.close(); }
});

test('two awake idle agents may naturally talk, while sleeping agents do not join', () => {
  const f = fixture();
  try {
    const scheduler = new AutonomousSceneScheduler({ db: f.db, queue: f.queue });
    const actions = [
      { agentId: 'alice', at: '2026-07-22T01:00:00.000Z', action: { type: 'idle', location: 'bridge' } },
      { agentId: 'bob', at: '2026-07-22T01:00:00.000Z', action: { type: 'idle', location: 'bridge' } },
      { agentId: 'carol', at: '2026-07-22T01:00:00.000Z', action: { type: 'sleep', location: 'bridge' } },
    ];
    const [job] = scheduler.scheduleFromLife({ actions }, '2026-07-22T01:00:00.000Z');
    assert.deepEqual(job.payload.participants.map((item) => item.agentId), ['alice', 'bob']);
  } finally { f.close(); }
});

test('autonomous scene lets each present agent speak and persists a replayable transcript', async () => {
  const f = fixture();
  try {
    for (const id of ['alice', 'bob']) {
      f.store.append({ type: 'state', actor: 'system', subject: id, key: 'location', content: 'bridge' }, [`private:${id}`, 'local:bridge']);
    }
    const calls = [];
    const runner = new AutonomousSceneRunner({
      store: f.store,
      agentRegistry: { loadProfile: (id) => ({ name: id === 'alice' ? '爱丽丝' : '鲍勃' }) },
      locationRegistry: { get: () => ({ name: '舰桥' }) },
      worldDir: f.dir,
      providerSettingsStore: { getActiveForKind: () => ({ model: 'fake' }) },
      createClient: () => ({}),
      turnRunner: {
        async runTurn(agentId, options) {
          calls.push({ agentId, options });
          f.store.append({
            type: 'dialogue', actor: agentId, subject: agentId, content: `${agentId}自主发言`, data: options.eventData,
          }, [`local:bridge`, ...options.extraTags]);
          return { dialogueText: `${agentId}自主发言`, silent: false };
        },
      },
    });
    const result = await runner.run({
      location: 'bridge', triggeredAt: '2026-07-22T01:00:00.000Z',
      participants: [{ agentId: 'alice', action: 'work' }, { agentId: 'bob', action: 'socialize' }],
    }, '2026-07-22T01:00:00.000Z');
    assert.equal(result.status, 'completed');
    assert.deepEqual(calls.map((item) => item.agentId), ['alice', 'bob']);
    assert.ok(calls.every((item) => item.options.extraTags.includes('system:autonomous')));
    const events = f.store.getEventsWithTags();
    assert.equal(events.filter((event) => event.type === 'dialogue').length, 2);
    assert.equal(events.at(-1).type, 'autonomous_scene');
  } finally { f.close(); }
});

test('autonomous scene safely skips when no dialogue provider is enabled', async () => {
  const f = fixture();
  try {
    for (const id of ['alice', 'bob']) {
      f.store.append({ type: 'state', actor: 'system', subject: id, key: 'location', content: 'bridge' });
    }
    const runner = new AutonomousSceneRunner({
      store: f.store,
      agentRegistry: { loadProfile: (id) => ({ name: id }) },
      locationRegistry: { get: () => ({ name: '舰桥' }) },
      worldDir: f.dir,
      providerSettingsStore: { getActiveForKind: () => null, getActive: () => null },
      turnRunner: { runTurn: () => { throw new Error('must not run'); } },
    });
    const result = await runner.run({ location: 'bridge', participants: [{ agentId: 'alice' }, { agentId: 'bob' }] }, '2026-07-22T01:00:00.000Z');
    assert.deepEqual(result, { status: 'skipped', reason: 'no_dialogue_provider' });
  } finally { f.close(); }
});
