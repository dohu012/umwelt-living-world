import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';

function makeStore() {
  return new EventStore(openDb(':memory:'));
}

describe('EventStore seq allocation', () => {
  test('starts at 1 for a fresh database', () => {
    const store = makeStore();
    const event = store.append({ type: 'system', actor: 'system', content: 'first' }, []);
    assert.equal(event.seq, 1);
  });

  test('strictly increases across sequential appends, never repeating', () => {
    const store = makeStore();
    const seqs = [];
    for (let i = 0; i < 20; i++) {
      seqs.push(store.append({ type: 'system', actor: 'system', content: `e${i}` }, []).seq);
    }
    for (let i = 1; i < seqs.length; i++) {
      assert.ok(seqs[i] > seqs[i - 1], `seq ${seqs[i]} should be greater than previous ${seqs[i - 1]}`);
    }
    assert.equal(new Set(seqs).size, seqs.length, 'no duplicate seq values');
  });

  test('two "overlapping" async writers (interleaved without awaiting between appends) get distinct seq', async () => {
    const store = makeStore();

    async function writer(actor, count) {
      const seqs = [];
      for (let i = 0; i < count; i++) {
        // No await before append() — simulates a utility call and a dialogue call both
        // reaching their write step around the same tick, which is exactly the scenario
        // the old peek-then-write-later pattern raced on.
        seqs.push(store.append({ type: 'fact', actor, subject: actor, key: 'k', content: `${i}` }, []).seq);
      }
      return seqs;
    }

    const [seqsA, seqsB] = await Promise.all([writer('alice', 10), writer('bob', 10)]);
    const all = [...seqsA, ...seqsB];
    assert.equal(new Set(all).size, all.length, 'no two writers ever got the same seq');
  });

  test('peekNextSeq reflects the next value the counter will hand out, without allocating', () => {
    const store = makeStore();
    store.append({ type: 'system', actor: 'system', content: 'e0' }, []);
    const peeked = store.peekNextSeq();
    const actual = store.append({ type: 'system', actor: 'system', content: 'e1' }, []).seq;
    assert.equal(actual, peeked);
  });

  test('an explicit event.seq still bypasses allocation (back-compat escape hatch)', () => {
    const store = makeStore();
    const event = store.append({ seq: 999, type: 'system', actor: 'system', content: 'pinned' }, []);
    assert.equal(event.seq, 999);
  });

  test('a pre-existing world database (predating seq_counter) backfills the counter above its max seq', () => {
    const dbPath = path.join(os.tmpdir(), `umwelt-seq-migration-${Date.now()}.db`);
    try {
      // Simulate a world created before seq_counter existed: hand-create just the events table
      // (matching schema.sql's shape) and insert a row with a seq far ahead of 0, with no
      // seq_counter table at all — then open it through the real migration path.
      const legacy = new Database(dbPath);
      legacy.exec(`CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, seq INTEGER NOT NULL, ts TEXT NOT NULL,
        type TEXT NOT NULL, actor TEXT NOT NULL, subject TEXT, key TEXT, content TEXT, data TEXT,
        turn_id INTEGER
      )`);
      legacy.prepare(
        `INSERT INTO events (seq, ts, type, actor, content) VALUES (500, ?, 'system', 'system', 'legacy row')`,
      ).run(new Date().toISOString());
      legacy.close();

      const db = openDb(dbPath);
      const counter = db.prepare('SELECT value FROM seq_counter WHERE id = 1').get();
      assert.ok(counter.value >= 500, `expected counter seeded >= 500, got ${counter.value}`);

      const store = new EventStore(db);
      const next = store.append({ type: 'system', actor: 'system', content: 'first post-migration event' }, []);
      assert.ok(next.seq > 500, `expected new event seq > 500, got ${next.seq}`);
      db.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
    }
  });

  test('re-opening an already-migrated database (e.g. a server restart) does not throw', () => {
    // Regression test: a naive `INSERT ... SELECT ... WHERE NOT EXISTS(...)` backfill guard looks
    // like it only inserts once, but an aggregate SELECT with no GROUP BY always produces exactly
    // one row even when its WHERE clause filters out every base-table row — so that guard doesn't
    // actually prevent the second INSERT attempt, and it violates seq_counter's PRIMARY KEY on the
    // very next server restart against any world that's already been opened once. OR IGNORE is the
    // real guard; this test would have caught the bug (found via manual smoke testing) immediately.
    const dbPath = path.join(os.tmpdir(), `umwelt-seq-reopen-${Date.now()}.db`);
    try {
      const db1 = openDb(dbPath);
      new EventStore(db1).append({ type: 'system', actor: 'system', content: 'e0' }, []);
      db1.close();

      assert.doesNotThrow(() => {
        const db2 = openDb(dbPath);
        const counterAfterReopen = db2.prepare('SELECT value FROM seq_counter WHERE id = 1').get();
        assert.equal(counterAfterReopen.value, 1, 'reopening must not re-seed/reset the counter');
        const next = new EventStore(db2).append({ type: 'system', actor: 'system', content: 'e1' }, []);
        assert.equal(next.seq, 2);
        db2.close();
      });
    } finally {
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
    }
  });
});
