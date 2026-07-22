import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import { WorldClock } from '../src/simulation/WorldClock.js';
import { JobQueue } from '../src/simulation/JobQueue.js';
import { DecisionManager } from '../src/simulation/DecisionManager.js';
import { WorldEventEngine } from '../src/simulation/WorldEventEngine.js';
import { WorldEngine } from '../src/simulation/WorldEngine.js';
import { EnvironmentStore } from '../src/simulation/EnvironmentStore.js';

function fixture(start = '2026-07-22T00:00:00.000Z') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-living-world-'));
  let now = new Date(start);
  const nowFn = () => new Date(now);
  const db = openDb(path.join(dir, 'events.db'));
  const store = new EventStore(db);
  const clock = new WorldClock(db, { now: nowFn, initialWorldTime: start });
  const queue = new JobQueue(db, { now: nowFn });
  const decisions = new DecisionManager(db, { now: nowFn });
  const environment = new EnvironmentStore(db, { now: nowFn });
  const events = new WorldEventEngine({ db, queue, eventStore: store, environment, now: () => new Date(clock.getState().worldTime) });
  const engine = new WorldEngine({ clock, queue, worldEvents: events });
  return {
    db,
    store,
    clock,
    queue,
    decisions,
    environment,
    events,
    engine,
    setNow(value) { now = new Date(value); },
    close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

test('world clock catches up from wall time and respects pause', () => {
  const f = fixture();
  try {
    f.clock.setTimeScale(12);
    f.setNow('2026-07-22T01:00:00.000Z');
    assert.equal(f.clock.getState().worldTime, '2026-07-22T12:00:00.000Z');
    f.clock.setStatus('paused');
    f.setNow('2026-07-23T01:00:00.000Z');
    assert.equal(f.clock.getState().worldTime, '2026-07-22T12:00:00.000Z');
  } finally {
    f.close();
  }
});

test('world-will event unfolds through forecast, impact, and aftermath', async () => {
  const f = fixture();
  try {
    const event = f.events.schedule({
      kind: 'typhoon',
      title: '台风登陆',
      scheduledAt: '2026-07-22T12:00:00.000Z',
      intensity: 0.8,
      data: { leadTimeMs: 6 * 60 * 60 * 1000, durationMs: 3 * 60 * 60 * 1000 },
    });
    f.clock.advanceBy(6 * 60 * 60 * 1000);
    assert.equal((await f.engine.tick()).processed, 1);
    assert.equal(f.events.get(event.id).status, 'forecast');
    assert.equal(f.environment.get('world', 'weather.alert').value.kind, 'typhoon');
    f.clock.advanceBy(6 * 60 * 60 * 1000);
    assert.equal((await f.engine.tick()).processed, 1);
    assert.equal(f.events.get(event.id).status, 'active');
    assert.equal(f.environment.get('world', 'weather.current').value, 'typhoon');
    f.clock.advanceBy(3 * 60 * 60 * 1000);
    assert.equal((await f.engine.tick()).processed, 1);
    assert.equal(f.events.get(event.id).status, 'completed');
    assert.equal(f.environment.get('world', 'weather.current').value, 'aftermath');
    assert.deepEqual(
      f.store.getRecentEvents().filter((item) => item.type === 'world_event').map((item) => item.key),
      ['forecast', 'impact', 'aftermath'],
    );
  } finally {
    f.close();
  }
});

test('world will can advise an agent without resolving their decision', () => {
  const f = fixture();
  try {
    const decision = f.decisions.create({
      agentId: 'chensu',
      prompt: '如何处理刚发现的权限日志？',
      options: [
        { id: 'confront', label: '质问墨白' },
        { id: 'investigate', label: '继续秘密调查' },
      ],
    });
    const advised = f.decisions.suggest(decision.id, {
      content: '先备份记录，不要打草惊蛇。',
      optionId: 'investigate',
      strength: 0.7,
    });
    assert.equal(advised.status, 'open');
    assert.equal(advised.chosenOptionId, null);
    assert.equal(advised.suggestions[0].content, '先备份记录，不要打草惊蛇。');
    assert.equal(advised.suggestions[0].optionId, 'investigate');
    const resolved = f.decisions.resolve(decision.id, 'investigate');
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.chosenOptionId, 'investigate');
  } finally {
    f.close();
  }
});

test('agent may accept a strong directed suggestion while keeping the final decision autonomous', () => {
  const f = fixture();
  try {
    const decision = f.decisions.create({
      agentId: 'alice',
      prompt: '冒险救人还是留在避难所？',
      options: [
        { id: 'stay', label: '留在避难所', weight: 0.8 },
        { id: 'rescue', label: '外出救人', weight: 0.4 },
      ],
    });
    f.decisions.suggest(decision.id, {
      content: '有人需要你。',
      optionId: 'rescue',
      strength: 0.7,
    });
    const resolved = f.decisions.resolveAutonomously(decision.id, { receptiveness: 0.8 });
    assert.equal(resolved.chosenOptionId, 'rescue');
    assert.equal(resolved.adviceOutcome, 'accepted');
    assert.match(resolved.resolutionReason, /selected rescue/);
  } finally {
    f.close();
  }
});

test('agent rejects advice that cannot outweigh their own preference', () => {
  const f = fixture();
  try {
    const decision = f.decisions.create({
      agentId: 'alice',
      prompt: '是否打开危险舱门？',
      options: [
        { id: 'closed', label: '保持关闭', weight: 0.9 },
        { id: 'open', label: '打开舱门', weight: 0.2 },
      ],
    });
    f.decisions.suggest(decision.id, {
      content: '打开它。',
      optionId: 'open',
      strength: 0.2,
    });
    const resolved = f.decisions.resolveAutonomously(decision.id, { receptiveness: 0.2 });
    assert.equal(resolved.chosenOptionId, 'closed');
    assert.equal(resolved.adviceOutcome, 'rejected');
  } finally {
    f.close();
  }
});
