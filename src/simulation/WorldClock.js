const VALID_STATUSES = new Set(['running', 'paused']);

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid date: ${value}`);
  return date.toISOString();
}

export class WorldClock {
  constructor(db, { now = () => new Date(), initialWorldTime } = {}) {
    this.db = db;
    this.now = now;
    const wallTime = iso(this.now());
    db.prepare(`
      INSERT OR IGNORE INTO world_clock (id, world_time, time_scale, status, last_wall_time)
      VALUES (1, ?, 1, 'running', ?)
    `).run(iso(initialWorldTime ?? wallTime), wallTime);
  }

  _row() {
    return this.db.prepare('SELECT * FROM world_clock WHERE id = 1').get();
  }

  _serialize(row) {
    return {
      worldTime: row.world_time,
      timeScale: row.time_scale,
      status: row.status,
      lastWallTime: row.last_wall_time,
    };
  }

  synchronize() {
    const wallTime = iso(this.now());
    const update = this.db.transaction(() => {
      const row = this._row();
      let worldTime = row.world_time;
      if (row.status === 'running') {
        const elapsed = Math.max(0, new Date(wallTime).getTime() - new Date(row.last_wall_time).getTime());
        worldTime = new Date(new Date(row.world_time).getTime() + elapsed * row.time_scale).toISOString();
      }
      this.db.prepare(
        'UPDATE world_clock SET world_time = ?, last_wall_time = ? WHERE id = 1',
      ).run(worldTime, wallTime);
      return this._row();
    });
    return this._serialize(update());
  }

  getState({ sync = true } = {}) {
    return sync ? this.synchronize() : this._serialize(this._row());
  }

  setStatus(status) {
    if (!VALID_STATUSES.has(status)) throw new Error(`invalid clock status: ${status}`);
    const current = this.synchronize();
    const wallTime = iso(this.now());
    this.db.prepare(
      'UPDATE world_clock SET status = ?, last_wall_time = ? WHERE id = 1',
    ).run(status, wallTime);
    return { ...current, status, lastWallTime: wallTime };
  }

  setTimeScale(timeScale) {
    const value = Number(timeScale);
    if (!Number.isFinite(value) || value <= 0 || value > 10_000) {
      throw new Error('timeScale must be greater than 0 and no more than 10000');
    }
    const current = this.synchronize();
    this.db.prepare('UPDATE world_clock SET time_scale = ? WHERE id = 1').run(value);
    return { ...current, timeScale: value };
  }

  advanceBy(milliseconds) {
    const amount = Number(milliseconds);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('milliseconds must be non-negative');
    this.synchronize();
    const row = this._row();
    const worldTime = new Date(new Date(row.world_time).getTime() + amount).toISOString();
    this.db.prepare('UPDATE world_clock SET world_time = ? WHERE id = 1').run(worldTime);
    return this.getState({ sync: false });
  }
}
