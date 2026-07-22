import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import { buildReturnBriefing } from '../src/server/routes/worlds.js';

test('return briefing contains autonomous world activity after the player departure cursor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-briefing-'));
  const db = openDb(path.join(dir, 'events.db'));
  try {
    const store = new EventStore(db);
    store.append({ type: 'dialogue', actor: 'player', content: '我先离开。' }, ['private:player']);
    db.prepare('INSERT INTO simulation_state (key, value, updated_at) VALUES (?, ?, ?)')
      .run('persona.last_departure:player', JSON.stringify({ seq: 1, worldTime: '2026-07-22T01:00:00.000Z' }), '2026-07-22T01:00:00.000Z');
    store.append({ type: 'life_action', actor: 'alice', content: 'work', data: { location: 'bridge' }, ts: '2026-07-22T02:00:00.000Z' }, ['local:bridge']);
    store.append({ type: 'dialogue', actor: 'alice', content: '这里的电压不对。', data: { autonomous: true, location: 'bridge' }, ts: '2026-07-22T02:05:00.000Z' }, ['local:bridge', 'system:autonomous']);
    const briefing = buildReturnBriefing({
      db,
      store,
      clock: { getState: () => ({ worldTime: '2026-07-22T03:00:00.000Z' }) },
      agentRegistry: { loadProfile: () => ({ name: '爱丽丝' }) },
      locationRegistry: { get: () => ({ name: '舰桥' }) },
    }, 'player');
    assert.equal(briefing.eventCount, 2);
    assert.equal(briefing.events[1].content, '这里的电压不对。');
    assert.equal(briefing.events[1].actorName, '爱丽丝');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
