import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import { LocationRegistry } from '../src/settings/LocationRegistry.js';
import { EnvironmentStore } from '../src/simulation/EnvironmentStore.js';
import { DecisionManager } from '../src/simulation/DecisionManager.js';
import { LifeSimulator } from '../src/simulation/LifeSimulator.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-life-'));
  fs.writeFileSync(path.join(dir, 'living-world.json'), JSON.stringify({
    tickMinutes: 60,
    agents: {
      alice: {
        needs: { energy: 75, satiety: 70, social: 60, safety: 80 },
        shelterLocation: 'shelter',
        worldWill: { receptiveness: 1 },
        schedule: [
          {
            at: '01:00',
            location: 'bridge',
            decision: {
              id: 'test-choice',
              prompt: '现在应该去哪里？',
              dueMinutes: 60,
              options: [
                { id: 'investigate', label: '继续调查', weight: 0.7, action: 'inspect', location: 'bridge' },
                { id: 'report', label: '前往报告', weight: 0.3, action: 'report', location: 'shelter' }
              ]
            }
          },
          { at: '08:00', action: 'work', location: 'bridge' }
        ],
      },
      bob: { needs: { energy: 80, satiety: 80, social: 80, safety: 80 } },
    },
  }));
  const db = openDb(path.join(dir, 'events.db'));
  const store = new EventStore(db);
  const locationRegistry = new LocationRegistry(path.join(dir, 'locations.json'));
  locationRegistry.ensure('Bridge');
  locationRegistry.ensure('Shelter');
  const agentRegistry = { listAgentIds: () => ['alice', 'bob'] };
  const environment = new EnvironmentStore(db);
  const decisions = new DecisionManager(db);
  for (const agentId of agentRegistry.listAgentIds()) {
    store.append({ type: 'state', actor: 'system', subject: agentId, key: 'location', content: 'start' }, [
      `private:${agentId}`,
      'local:start',
    ]);
  }
  const life = new LifeSimulator({
    db,
    store,
    agentRegistry,
    locationRegistry,
    environment,
    decisions,
    worldDir: dir,
  });
  return {
    db,
    store,
    environment,
    life,
    close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

test('agents follow schedules and needs decay as world hours pass', () => {
  const f = fixture();
  try {
    f.life.advanceTo('2026-07-22T00:00:00.000Z');
    const result = f.life.advanceTo('2026-07-22T08:00:00.000Z');
    const alice = f.life.getAgent('alice');
    assert.equal(result.steps, 8);
    assert.equal(alice.currentAction, 'work');
    assert.equal(alice.actionData.location, 'bridge');
    assert.equal(f.store.getFact('alice', 'location').content, 'bridge');
    assert.ok(alice.needs.energy < 75);
    assert.ok(f.store.getRecentEvents().some((event) => event.type === 'life_action' && event.content === 'work'));
  } finally {
    f.close();
  }
});

test('dangerous weather causes autonomous sheltering without player control', () => {
  const f = fixture();
  try {
    f.life.advanceTo('2026-07-22T00:00:00.000Z');
    f.environment.set('world', 'weather.current', 'typhoon', { at: '2026-07-22T00:30:00.000Z' });
    const result = f.life.advanceTo('2026-07-22T01:00:00.000Z');
    const aliceAction = result.actions.find((item) => item.agentId === 'alice');
    assert.equal(aliceAction.action.type, 'shelter');
    assert.equal(aliceAction.action.location, 'shelter');
    assert.equal(f.store.getFact('alice', 'location').content, 'shelter');
    assert.ok(aliceAction.needs.safety > 80);
  } finally {
    f.close();
  }
});

test('scheduled choice waits for advice, then the agent accepts it and performs the consequence', () => {
  const f = fixture();
  try {
    f.life.advanceTo('2026-07-22T00:00:00.000Z');
    f.life.advanceTo('2026-07-22T01:00:00.000Z');
    const pending = f.life.decisions.listOpen()[0];
    assert.equal(pending.agentId, 'alice');
    assert.equal(f.life.getAgent('alice').currentAction, 'deliberate');
    f.life.decisions.suggest(pending.id, {
      content: '先去报告，这样更安全。',
      optionId: 'report',
      strength: 0.8,
    });
    f.life.advanceTo('2026-07-22T02:00:00.000Z');
    const resolved = f.life.decisions.get(pending.id);
    assert.equal(resolved.chosenOptionId, 'report');
    assert.equal(resolved.adviceOutcome, 'accepted');
    assert.equal(f.life.getAgent('alice').currentAction, 'report');
    assert.equal(f.store.getFact('alice', 'location').content, 'shelter');
    assert.ok(f.store.getRecentEvents().some((event) => event.type === 'decision_resolved'));
  } finally {
    f.close();
  }
});

test('long offline periods catch up only the most recent bounded window', () => {
  const f = fixture();
  try {
    f.life.advanceTo('2026-07-01T00:00:00.000Z');
    const result = f.life.advanceTo('2026-07-04T00:00:00.000Z', { maxSteps: 12 });
    assert.equal(result.steps, 12);
    assert.equal(result.skippedSteps, 60);
    assert.equal(result.caughtUp, true);
    assert.equal(f.life.getAgent('alice').updatedAt, '2026-07-04T00:00:00.000Z');
  } finally {
    f.close();
  }
});
