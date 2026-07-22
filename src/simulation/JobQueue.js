function parseJson(value) {
  if (value == null) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export class JobQueue {
  constructor(db, { now = () => new Date() } = {}) {
    this.db = db;
    this.now = now;
  }

  schedule({ runAt, type, subject = null, payload = null }) {
    const date = new Date(runAt);
    if (!Number.isFinite(date.getTime())) throw new Error(`invalid job runAt: ${runAt}`);
    if (!type) throw new Error('job type is required');
    const createdAt = this.now().toISOString();
    const result = this.db.prepare(`
      INSERT INTO scheduled_jobs (run_at, type, subject, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(date.toISOString(), type, subject, payload == null ? null : JSON.stringify(payload), createdAt);
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
      "UPDATE scheduled_jobs SET status = 'running', error = NULL WHERE id = ? AND status = 'pending'",
    ).run(id).changes === 1;
  }

  complete(id) {
    this.db.prepare(
      "UPDATE scheduled_jobs SET status = 'completed', completed_at = ?, error = NULL WHERE id = ?",
    ).run(this.now().toISOString(), id);
  }

  fail(id, error) {
    this.db.prepare(
      "UPDATE scheduled_jobs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?",
    ).run(this.now().toISOString(), String(error?.message ?? error), id);
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
    };
  }
}
