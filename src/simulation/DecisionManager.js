function json(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export class DecisionManager {
  constructor(db, { now = () => new Date() } = {}) {
    this.db = db;
    this.now = now;
  }

  create({ sourceKey = null, agentId, prompt, options, context = null, dueAt = null }) {
    if (!agentId || !prompt) throw new Error('agentId and prompt are required');
    if (!Array.isArray(options) || options.length < 2) throw new Error('at least two options are required');
    const normalized = options.map((option, index) => ({
      id: String(option.id ?? index + 1),
      label: String(option.label ?? option),
      weight: Number(option.weight ?? 0.5),
      action: option.action ?? null,
      location: option.location ?? null,
      targetId: option.targetId ?? null,
    }));
    const result = this.db.prepare(`
      INSERT INTO decision_points (source_key, agent_id, prompt, options, context, due_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sourceKey,
      agentId,
      prompt,
      JSON.stringify(normalized),
      context == null ? null : JSON.stringify(context),
      dueAt == null ? null : new Date(dueAt).toISOString(),
      this.now().toISOString(),
    );
    return this.get(Number(result.lastInsertRowid));
  }

  createUnique(input) {
    if (!input.sourceKey) return this.create(input);
    const existing = this.db.prepare('SELECT id FROM decision_points WHERE source_key = ?').pluck().get(input.sourceKey);
    return existing ? this.get(existing) : this.create(input);
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM decision_points WHERE id = ?').get(id);
    if (!row) return null;
    const suggestions = this.db.prepare(
      'SELECT id, option_id, content, strength, created_at FROM world_will_suggestions WHERE decision_id = ? ORDER BY id',
    ).all(id).map((item) => ({
      id: item.id,
      optionId: item.option_id,
      content: item.content,
      strength: item.strength,
      createdAt: item.created_at,
    }));
    return {
      id: row.id,
      sourceKey: row.source_key,
      agentId: row.agent_id,
      prompt: row.prompt,
      options: json(row.options, []),
      context: json(row.context, null),
      status: row.status,
      dueAt: row.due_at,
      chosenOptionId: row.chosen_option_id,
      resolutionReason: row.resolution_reason,
      adviceOutcome: row.advice_outcome,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      suggestions,
    };
  }

  listOpen() {
    return this.db.prepare(
      "SELECT id FROM decision_points WHERE status = 'open' ORDER BY created_at, id",
    ).pluck().all().map((id) => this.get(id));
  }

  list({ status = null, limit = 100 } = {}) {
    const ids = status
      ? this.db.prepare('SELECT id FROM decision_points WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?').pluck().all(status, limit)
      : this.db.prepare('SELECT id FROM decision_points ORDER BY created_at DESC, id DESC LIMIT ?').pluck().all(limit);
    return ids.map((id) => this.get(id));
  }

  listDue(worldTime) {
    return this.db.prepare(`
      SELECT id FROM decision_points
      WHERE status = 'open' AND due_at IS NOT NULL AND due_at <= ?
      ORDER BY due_at, id
    `).pluck().all(new Date(worldTime).toISOString()).map((id) => this.get(id));
  }

  suggest(decisionId, { content, optionId = null, strength = 0.5 }) {
    const decision = this.get(decisionId);
    if (!decision) throw new Error(`decision ${decisionId} not found`);
    if (decision.status !== 'open') throw new Error(`decision ${decisionId} is not open`);
    const value = Number(strength);
    if (!content?.trim()) throw new Error('suggestion content is required');
    if (optionId != null && !decision.options.some((option) => option.id === String(optionId))) {
      throw new Error(`unknown option ${optionId}`);
    }
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('strength must be between 0 and 1');
    this.db.prepare(`
      INSERT INTO world_will_suggestions (decision_id, option_id, content, strength, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(decisionId, optionId == null ? null : String(optionId), content.trim(), value, this.now().toISOString());
    return this.get(decisionId);
  }

  resolve(decisionId, chosenOptionId) {
    const decision = this.get(decisionId);
    if (!decision) throw new Error(`decision ${decisionId} not found`);
    if (!decision.options.some((option) => option.id === String(chosenOptionId))) {
      throw new Error(`unknown option ${chosenOptionId}`);
    }
    this.db.prepare(`
      UPDATE decision_points
      SET status = 'resolved', chosen_option_id = ?, resolved_at = ?
      WHERE id = ? AND status = 'open'
    `).run(String(chosenOptionId), this.now().toISOString(), decisionId);
    return this.get(decisionId);
  }

  resolveAutonomously(decisionId, { receptiveness = 0.5, resolvedAt = null } = {}) {
    const decision = this.get(decisionId);
    if (!decision) throw new Error(`decision ${decisionId} not found`);
    if (decision.status !== 'open') return decision;
    const openness = Math.max(0, Math.min(1, Number(receptiveness) || 0));
    const scored = decision.options.map((option, index) => {
      const adviceBoost = decision.suggestions
        .filter((suggestion) => suggestion.optionId === option.id)
        .reduce((sum, suggestion) => sum + suggestion.strength * openness, 0);
      return { option, index, score: Number(option.weight ?? 0.5) + adviceBoost };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    const chosen = scored[0].option;
    const directedAdvice = decision.suggestions.filter((suggestion) => suggestion.optionId != null);
    const adviceOutcome = directedAdvice.length === 0
      ? (decision.suggestions.length === 0 ? 'no_advice' : 'general_advice')
      : directedAdvice.some((suggestion) => suggestion.optionId === chosen.id) ? 'accepted' : 'rejected';
    const resolutionReason = `agent preference and advice score selected ${chosen.id}`;
    this.db.prepare(`
      UPDATE decision_points
      SET status = 'resolved', chosen_option_id = ?, resolution_reason = ?, advice_outcome = ?, resolved_at = ?
      WHERE id = ? AND status = 'open'
    `).run(chosen.id, resolutionReason, adviceOutcome, new Date(resolvedAt ?? this.now()).toISOString(), decisionId);
    return this.get(decisionId);
  }
}
