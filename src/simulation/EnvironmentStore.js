function decode(value) {
  if (value == null) return null;
  try { return JSON.parse(value); } catch { return value; }
}

export class EnvironmentStore {
  constructor(db, { now = () => new Date() } = {}) {
    this.db = db;
    this.now = now;
  }

  set(scope, key, value, { at } = {}) {
    if (!scope || !key) throw new Error('environment scope and key are required');
    const updatedAt = new Date(at ?? this.now()).toISOString();
    this.db.prepare(`
      INSERT INTO environment_state (scope, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(scope, key, JSON.stringify(value), updatedAt);
    return { scope, key, value, updatedAt };
  }

  get(scope, key) {
    const row = this.db.prepare(
      'SELECT scope, key, value, updated_at FROM environment_state WHERE scope = ? AND key = ?',
    ).get(scope, key);
    return row ? { scope: row.scope, key: row.key, value: decode(row.value), updatedAt: row.updated_at } : null;
  }

  list(scope = null) {
    const rows = scope
      ? this.db.prepare('SELECT * FROM environment_state WHERE scope = ? ORDER BY key').all(scope)
      : this.db.prepare('SELECT * FROM environment_state ORDER BY scope, key').all();
    return rows.map((row) => ({
      scope: row.scope,
      key: row.key,
      value: decode(row.value),
      updatedAt: row.updated_at,
    }));
  }
}
