function parse(value) {
  if (value == null) return null;
  try { return JSON.parse(value); } catch { return null; }
}

const HOUR = 60 * 60 * 1000;
const WEATHER_KINDS = new Set(['typhoon', 'storm', 'rain', 'snow', 'heatwave', 'blizzard']);

export class WorldEventEngine {
  constructor({ db, queue, eventStore, environment = null, now = () => new Date() }) {
    this.db = db;
    this.queue = queue;
    this.eventStore = eventStore;
    this.environment = environment;
    this.now = now;
  }

  schedule({ kind, title, scheduledAt, intensity = 0.5, scope = 'world', data = {} }) {
    if (!kind || !title) throw new Error('kind and title are required');
    const scheduled = new Date(scheduledAt);
    if (!Number.isFinite(scheduled.getTime())) throw new Error(`invalid scheduledAt: ${scheduledAt}`);
    const level = Number(intensity);
    if (!Number.isFinite(level) || level < 0 || level > 1) throw new Error('intensity must be between 0 and 1');
    const now = this.now().toISOString();
    const result = this.db.prepare(`
      INSERT INTO world_events (kind, title, scheduled_at, intensity, scope, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(kind, title, scheduled.toISOString(), level, scope, JSON.stringify(data), now, now);
    const eventId = Number(result.lastInsertRowid);
    const leadTimeMs = Math.max(0, Number(data.leadTimeMs ?? 6 * HOUR));
    const durationMs = Math.max(0, Number(data.durationMs ?? 6 * HOUR));
    const forecastAt = new Date(Math.max(this.now().getTime(), scheduled.getTime() - leadTimeMs));
    this.queue.schedule({ runAt: forecastAt, type: 'world_event_phase', subject: String(eventId), payload: { eventId, phase: 'forecast' } });
    this.queue.schedule({ runAt: scheduled, type: 'world_event_phase', subject: String(eventId), payload: { eventId, phase: 'impact' } });
    this.queue.schedule({ runAt: new Date(scheduled.getTime() + durationMs), type: 'world_event_phase', subject: String(eventId), payload: { eventId, phase: 'aftermath' } });
    return this.get(eventId);
  }

  schedulePlan({ title, kind = 'custom', scope = 'world', intensity = 0.5, rationale = '', timeline, instruction = '' }) {
    if (!title?.trim()) throw new Error('世界意志计划缺少事件名称');
    if (!Array.isArray(timeline) || timeline.length < 1 || timeline.length > 8) {
      throw new Error('世界意志计划必须包含 1-8 个时间节点');
    }
    const normalized = timeline.map((step, index) => {
      const at = new Date(step.at);
      if (!Number.isFinite(at.getTime())) throw new Error(`世界意志节点 ${index + 1} 的时间无效`);
      if (!step.description?.trim()) throw new Error(`世界意志节点 ${index + 1} 缺少发生过程`);
      const effects = Array.isArray(step.effects) ? step.effects.slice(0, 12).map((effect) => ({
        scope: effect.scope || scope || 'world',
        key: String(effect.key || '').trim(),
        value: effect.value ?? null,
      })).filter((effect) => effect.key) : [];
      return { at: at.toISOString(), phase: String(step.phase || `step-${index + 1}`), description: step.description.trim(), effects };
    }).sort((a, b) => a.at.localeCompare(b.at));
    const level = Math.max(0, Math.min(1, Number(intensity) || 0.5));
    const now = this.now().toISOString();
    const data = { origin: 'world-will-agent', instruction, rationale, timeline: normalized };
    const result = this.db.prepare(`
      INSERT INTO world_events (kind, title, scheduled_at, intensity, scope, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(kind || 'custom'), title.trim(), normalized[0].at, level, scope || 'world', JSON.stringify(data), now, now);
    const eventId = Number(result.lastInsertRowid);
    normalized.forEach((step, stepIndex) => this.queue.schedule({
      runAt: step.at,
      type: 'world_will_step',
      subject: String(eventId),
      payload: { eventId, stepIndex },
    }));
    return { event: this.get(eventId), plan: data };
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM world_events WHERE id = ?').get(id);
    return row ? this._serialize(row) : null;
  }

  list({ limit = 100 } = {}) {
    return this.db.prepare('SELECT * FROM world_events ORDER BY scheduled_at DESC, id DESC LIMIT ?')
      .all(limit).map((row) => this._serialize(row));
  }

  handlePhase({ eventId, phase }, worldTime) {
    const event = this.get(eventId);
    if (!event) throw new Error(`world event ${eventId} not found`);
    const status = phase === 'forecast' ? 'forecast' : phase === 'impact' ? 'active' : 'completed';
    this.db.prepare('UPDATE world_events SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, worldTime, eventId);
    this._applyEnvironment(event, phase, worldTime);
    this.eventStore.append({
      ts: worldTime,
      type: 'world_event',
      actor: 'world-will',
      subject: `world-event:${eventId}`,
      key: phase,
      content: `${event.title}: ${phase}`,
      data: { ...event, phase, status },
    }, ['global', 'system:world-event']);
    return { ...event, phase, status };
  }

  handlePlannedStep({ eventId, stepIndex }, worldTime) {
    const event = this.get(eventId);
    if (!event) throw new Error(`world event ${eventId} not found`);
    const timeline = event.data?.timeline ?? [];
    const step = timeline[stepIndex];
    if (!step) throw new Error(`world event ${eventId} has no step ${stepIndex}`);
    const final = stepIndex === timeline.length - 1;
    const status = final ? 'completed' : 'active';
    this.db.prepare('UPDATE world_events SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, worldTime, eventId);
    for (const effect of step.effects ?? []) {
      if (effect.key) this.environment?.set(effect.scope || event.scope || 'world', effect.key, effect.value, { at: worldTime });
    }
    this.eventStore.append({
      ts: worldTime,
      type: 'world_event',
      actor: 'world-will-agent',
      subject: `world-event:${eventId}`,
      key: step.phase,
      content: `${event.title}：${step.description}`,
      data: { ...event, origin: 'world-will-agent', stepIndex, step, status },
    }, ['global', 'system:world-event', 'system:world-will-agent']);
    return { ...event, stepIndex, step, status };
  }

  _applyEnvironment(event, phase, worldTime) {
    if (!this.environment) return;
    this.environment.set('world', `event.${event.kind}`, {
      phase,
      title: event.title,
      intensity: event.intensity,
      scope: event.scope,
    }, { at: worldTime });
    if (!WEATHER_KINDS.has(event.kind)) return;
    if (phase === 'forecast') {
      this.environment.set('world', 'weather.alert', {
        kind: event.kind,
        title: event.title,
        intensity: event.intensity,
        scheduledAt: event.scheduledAt,
      }, { at: worldTime });
      return;
    }
    if (phase === 'impact') {
      this.environment.set('world', 'weather.current', event.kind, { at: worldTime });
      this.environment.set('world', 'weather.intensity', event.intensity, { at: worldTime });
      return;
    }
    this.environment.set('world', 'weather.current', 'aftermath', { at: worldTime });
    this.environment.set('world', 'weather.alert', null, { at: worldTime });
  }

  _serialize(row) {
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      status: row.status,
      scheduledAt: row.scheduled_at,
      intensity: row.intensity,
      scope: row.scope,
      data: parse(row.data) ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
