function parseJson(value) {
  if (value == null) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export class JobQueue {
  constructor(db, { now = () => new Date() } = {}) {
    this.db = db;
    this.now = now;
  }

  schedule({ runAt, type, subject = null, payload = null, maxAttempts = 3 }) {
    const date = new Date(runAt);
    if (!Number.isFinite(date.getTime())) throw new Error(`invalid job runAt: ${runAt}`);
    if (!type) throw new Error('job type is required');
    const createdAt = this.now().toISOString();
    const result = this.db.prepare(`
      INSERT INTO scheduled_jobs (run_at, type, subject, payload, created_at, max_attempts)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      date.toISOString(), type, subject, payload == null ? null : JSON.stringify(payload), createdAt,
      Math.max(1, Number(maxAttempts) || 3),
    );
    return this.get(Number(result.lastInsertRowid));
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id);
    return row ? this._serialize(row) : null;
  }

  listDue(worldTime, { limit = 100 } = {}) {
    return this.db.prepare(`
      SELECT * FROM scheduled_jobs
      WHERE status = 'pending' AND run_at <= ?
      ORDER BY run_at, id
      LIMIT ?
    `).all(new Date(worldTime).toISOString(), limit).map((row) => this._serialize(row));
  }

  markRunning(id) {
    return this.db.prepare(
      `UPDATE scheduled_jobs
       SET status = 'running', error = NULL, started_at = ?, attempts = attempts + 1
       WHERE id = ? AND status = 'pending'`,
    ).run(this.now().toISOString(), id).changes === 1;
  }

  complete(id) {
    this.db.prepare(
      "UPDATE scheduled_jobs SET status = 'completed', completed_at = ?, error = NULL, started_at = NULL WHERE id = ?",
    ).run(this.now().toISOString(), id);
  }

  fail(id, error) {
    this.db.prepare(
      "UPDATE scheduled_jobs SET status = 'failed', completed_at = ?, started_at = NULL, error = ? WHERE id = ?",
    ).run(this.now().toISOString(), String(error?.message ?? error), id);
  }

  retry(id, { runAt, error } = {}) {
    const nextRun = new Date(runAt ?? this.now());
    if (!Number.isFinite(nextRun.getTime())) throw new Error(`invalid retry runAt: ${runAt}`);
    return this.db.prepare(`
      UPDATE scheduled_jobs
      SET status = 'pending', run_at = ?, completed_at = NULL, started_at = NULL, error = ?
      WHERE id = ? AND status = 'running' AND attempts < max_attempts
    `).run(nextRun.toISOString(), String(error?.message ?? error ?? 'retry requested'), id).changes === 1;
  }

  /**
   * A process can die after claiming a job. Older builds also made autonomous provider failures
   * terminal immediately; their migrated attempts value is 0, so give them the new retry policy.
   */
  recoverInterrupted() {
    return this.db.prepare(`
      UPDATE scheduled_jobs
      SET status = 'pending', started_at = NULL,
          error = CASE WHEN error IS NULL THEN 'recovered after worker restart' ELSE error END
      WHERE (status = 'running' OR (status = 'failed' AND type = 'autonomous_scene'))
        AND attempts < max_attempts
    `).run().changes;
  }

  _serialize(row) {
    return {
      id: row.id,
      runAt: row.run_at,
      type: row.type,
      subject: row.subject,
      payload: parseJson(row.payload),
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      error: row.error,
      attempts: row.attempts ?? 0,
      maxAttempts: row.max_attempts ?? 3,
    };
  }
}
