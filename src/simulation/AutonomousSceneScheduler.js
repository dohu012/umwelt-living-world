const HOUR = 60 * 60 * 1000;

export class AutonomousSceneScheduler {
  constructor({ db, queue, cooldownHours = 6, maxParticipants = 3 }) {
    this.db = db;
    this.queue = queue;
    this.cooldownMs = Math.max(1, cooldownHours) * HOUR;
    this.maxParticipants = Math.max(2, maxParticipants);
  }

  _stateKey(location) {
    return `autonomous_scene.last_scheduled:${location}`;
  }

  _lastScheduled(location) {
    return this.db.prepare('SELECT value FROM simulation_state WHERE key = ?').pluck().get(this._stateKey(location));
  }

  _markScheduled(location, at) {
    this.db.prepare(`
      INSERT INTO simulation_state (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(this._stateKey(location), at, at);
  }

  scheduleFromLife(life, worldTime) {
    if (!life?.actions?.length) return [];
    const fallbackAt = new Date(worldTime).toISOString();
    const byMomentAndLocation = new Map();
    for (const item of life.actions) {
      const location = item.action?.location;
      if (!location) continue;
      const at = item.at ?? fallbackAt;
      const key = `${at}\u0000${location}`;
      if (!byMomentAndLocation.has(key)) byMomentAndLocation.set(key, { at, location, present: [] });
      byMomentAndLocation.get(key).present.push(item);
    }

    const jobs = [];
    for (const { at, location, present } of byMomentAndLocation.values()) {
      // Quiet shared time is a valid social scene; only sleeping characters are unavailable.
      const available = present.filter((item) => item.action?.type !== 'sleep');
      if (available.length < 2) continue;
      const last = this._lastScheduled(location);
      if (last && new Date(at).getTime() - new Date(last).getTime() < this.cooldownMs) continue;
      const participants = available
        .sort((a, b) => a.agentId.localeCompare(b.agentId))
        .slice(0, this.maxParticipants)
        .map((item) => ({ agentId: item.agentId, action: item.action?.type ?? 'idle' }));
      const job = this.queue.schedule({
        runAt: at,
        type: 'autonomous_scene',
        subject: location,
        payload: { location, participants, triggeredAt: at },
      });
      this._markScheduled(location, at);
      jobs.push(job);
    }
    return jobs;
  }
}
