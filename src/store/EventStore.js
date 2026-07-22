import { isVisible } from '../visibility/tags.js';

export class EventStore {
  constructor(db) {
    this.db = db;
    this._allocateSeqStmt = db.prepare(
      'UPDATE seq_counter SET value = value + 1 WHERE id = 1 RETURNING value',
    ).pluck();
  }

  /**
   * Atomically allocates the next seq inside the caller's transaction. better-sqlite3 is fully
   * synchronous, so two logically-concurrent JS call sites can never interleave mid-transaction —
   * at worst they queue as back-to-back synchronous transactions, each getting a distinct,
   * correctly-ordered seq. Replaces the old peek-then-write-later pattern, which raced whenever a
   * write was deferred across an `await` (see git history for the bug this replaced).
   */
  _allocateSeq() {
    return this._allocateSeqStmt.get();
  }

  /** Advisory/debug only — no caller should feed this into append()'s seq field anymore. */
  peekNextSeq() {
    return this.db.prepare('SELECT value + 1 AS seq FROM seq_counter WHERE id = 1').pluck().get();
  }

  append(event, tags = []) {
    const insertEvent = this.db.prepare(`
      INSERT INTO events (seq, ts, type, actor, subject, key, content, data, turn_id)
      VALUES (@seq, @ts, @type, @actor, @subject, @key, @content, @data, @turn_id)
    `);
    const insertTag = this.db.prepare(
      'INSERT INTO event_tags (event_id, tag) VALUES (?, ?)',
    );
    const upsertFact = this.db.prepare(`
      INSERT INTO facts_current (subject, key, latest_event_id, updated_seq)
      VALUES (@subject, @key, @eventId, @seq)
      ON CONFLICT(subject, key) DO UPDATE SET
        latest_event_id = excluded.latest_event_id,
        updated_seq = excluded.updated_seq
      WHERE excluded.updated_seq >= facts_current.updated_seq
    `);

    const run = this.db.transaction((event, tags) => {
      const seq = event.seq ?? this._allocateSeq();
      const row = {
        seq,
        ts: event.ts ?? new Date().toISOString(),
        type: event.type,
        actor: event.actor,
        subject: event.subject ?? null,
        key: event.key ?? null,
        content: event.content ?? null,
        data: event.data !== undefined ? JSON.stringify(event.data) : null,
        turn_id: event.turnId ?? null,
      };
      const { lastInsertRowid: eventId } = insertEvent.run(row);

      for (const tag of tags) {
        insertTag.run(eventId, tag);
      }

      if ((event.type === 'state' || event.type === 'fact') && event.subject && event.key) {
        upsertFact.run({ subject: event.subject, key: event.key, eventId, seq });
      }

      return { id: eventId, seq, ...row };
    });

    return run(event, tags);
  }

  /** Phase 1 leftover, unused by Phase 2 code paths — kept for ad hoc debugging. */
  getRecentEvents(limit = 50) {
    return this.db
      .prepare('SELECT * FROM events ORDER BY seq DESC LIMIT ?')
      .all(limit)
      .reverse();
  }

  getTagsForEvent(eventId) {
    return this.db
      .prepare('SELECT tag FROM event_tags WHERE event_id = ?')
      .pluck()
      .all(eventId);
  }

  _tagsForEvents(ids) {
    const map = new Map();
    if (ids.length === 0) return map;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT event_id, tag FROM event_tags WHERE event_id IN (${placeholders})`)
      .all(...ids);
    for (const { event_id, tag } of rows) {
      if (!map.has(event_id)) map.set(event_id, []);
      map.get(event_id).push(tag);
    }
    return map;
  }

  /**
   * Tag-ACL-filtered, chronological, trailing window (see Phase 2 plan's
   * "Context assembly window" decision — no cursor bound here). Two-stage:
   * a SQL prefilter via indexed GLOB over event_tags (our tag syntax is
   * valid SQLite GLOB), then an authoritative JS decision via isVisible()
   * so the SQL stage can never cause an incorrect inclusion, only an
   * unnecessary candidate that gets correctly dropped in JS.
   */
  queryVisible(policy, { limit, afterEventId = 0 } = {}) {
    const allow = policy.allow ?? [];
    if (allow.length === 0) return [];

    const globClauses = allow.map(() => 'tag GLOB ?').join(' OR ');
    const candidateIds = this.db
      .prepare(`SELECT DISTINCT event_id FROM event_tags WHERE ${globClauses}`)
      .pluck()
      .all(...allow)
      .filter((id) => id > afterEventId);
    if (candidateIds.length === 0) return [];

    const placeholders = candidateIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE id IN (${placeholders}) ORDER BY seq ASC, id ASC`)
      .all(...candidateIds);

    const tagsByEvent = this._tagsForEvents(candidateIds);
    const visible = rows
      .map((row) => ({ ...row, tags: tagsByEvent.get(row.id) ?? [] }))
      .filter((row) => row.tags.some((tag) => isVisible(tag, policy)));

    return limit ? visible.slice(-limit) : visible;
  }

  /**
   * God-view read: events whose tags GLOB-match `tagPattern`, chronological, NO Policy/isVisible
   * filtering. This is deliberately the human-facing counterpart to queryVisible — callers must
   * never use this to build an agent's LLM context, only to render a room's raw transcript for
   * the player watching it.
   */
  getEventsByTagPrefix(tagPattern, { limit, afterEventId = 0 } = {}) {
    const candidateIds = this.db
      .prepare('SELECT DISTINCT event_id FROM event_tags WHERE tag GLOB ?')
      .pluck()
      .all(tagPattern)
      .filter((id) => id > afterEventId);
    if (candidateIds.length === 0) return [];

    const placeholders = candidateIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE id IN (${placeholders}) ORDER BY seq ASC, id ASC`)
      .all(...candidateIds);

    const tagsByEvent = this._tagsForEvents(candidateIds);
    const withTags = rows.map((row) => ({ ...row, tags: tagsByEvent.get(row.id) ?? [] }));
    return limit ? withTags.slice(-limit) : withTags;
  }

  /** Unfiltered counterpart to queryVisible, with tags attached — used by inspect.js. */
  getEventsWithTags({ limit } = {}) {
    const rows = limit
      ? this.db.prepare('SELECT * FROM events ORDER BY seq DESC LIMIT ?').all(limit).reverse()
      : this.db.prepare('SELECT * FROM events ORDER BY seq ASC').all();
    const tagsByEvent = this._tagsForEvents(rows.map((r) => r.id));
    return rows.map((row) => ({ ...row, tags: tagsByEvent.get(row.id) ?? [] }));
  }

  getFact(subject, key) {
    const row = this.db
      .prepare(
        `SELECT f.subject, f.key, e.content, e.data, e.ts, e.seq
         FROM facts_current f JOIN events e ON e.id = f.latest_event_id
         WHERE f.subject = ? AND f.key = ?`,
      )
      .get(subject, key);
    if (!row) return undefined;
    return { ...row, data: row.data ? JSON.parse(row.data) : null };
  }

  getFactsForSubject(subject) {
    const rows = this.db
      .prepare(
        `SELECT f.subject, f.key, e.content, e.data, e.ts, e.seq
         FROM facts_current f JOIN events e ON e.id = f.latest_event_id
         WHERE f.subject = ?`,
      )
      .all(subject);
    return rows.map((row) => ({ ...row, data: row.data ? JSON.parse(row.data) : null }));
  }

  /** Most recent type='memory' event this agent authored about itself, or undefined if none yet. */
  getLatestMemory(subject) {
    const row = this.db
      .prepare(
        `SELECT * FROM events WHERE type = 'memory' AND subject = ? ORDER BY seq DESC, id DESC LIMIT 1`,
      )
      .get(subject);
    if (!row) return undefined;
    return { ...row, data: row.data ? JSON.parse(row.data) : null };
  }

  /** Completed (non-error) turns for this agent — used to decide when a summary is due. */
  countCompletedTurns(agentId) {
    return this.db
      .prepare(`SELECT COUNT(*) AS n FROM turns WHERE agent_id = ? AND status != 'error'`)
      .get(agentId).n;
  }

  getCursor(agentId) {
    const row = this.db
      .prepare('SELECT last_seen_event_id FROM agent_cursors WHERE agent_id = ?')
      .get(agentId);
    return row?.last_seen_event_id ?? 0;
  }

  advanceCursor(agentId, eventId) {
    this.db
      .prepare(
        `INSERT INTO agent_cursors (agent_id, last_seen_event_id) VALUES (?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET last_seen_event_id = excluded.last_seen_event_id
         WHERE excluded.last_seen_event_id > agent_cursors.last_seen_event_id`,
      )
      .run(agentId, eventId);
  }

  startTurn(agentId, seq) {
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO turns (seq, agent_id, started_at, status) VALUES (?, ?, ?, 'running')`,
      )
      .run(seq, agentId, new Date().toISOString());
    return lastInsertRowid;
  }

  endTurn(turnId, status) {
    this.db
      .prepare(`UPDATE turns SET ended_at = ?, status = ? WHERE id = ?`)
      .run(new Date().toISOString(), status, turnId);
  }
}
