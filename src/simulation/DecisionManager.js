function json(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export class DecisionManager {
  constructor(db, { now = () => new Date() } = {}) {
    this.db = db;
    this.now = now;
  }

  create({ agentId, prompt, options, context = null, dueAt = null }) {
    if (!agentId || !prompt) throw new Error('agentId and prompt are required');
    if (!Array.isArray(options) || options.length < 2) throw new Error('at least two options are required');
    const normalized = options.map((option, index) => ({
      id: String(option.id ?? index + 1),
      label: String(option.label ?? option),
      weight: Number(option.weight ?? 0.5),
    }));
    const result = this.db.prepare(`
      INSERT INTO decision_points (agent_id, prompt, options, context, due_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      agentId,
      prompt,
      JSON.stringify(normalized),
      context == null ? null : JSON.stringify(context),
      dueAt == null ? null : new Date(dueAt).toISOString(),
      this.now().toISOString(),
    );
    return this.get(Number(result.lastInsertRowid));
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
      agentId: row.agent_id,
      prompt: row.prompt,
      options: json(row.options, []),
      context: json(row.context, null),
      status: row.status,
      dueAt: row.due_at,
      chosenOptionId: row.chosen_option_id,
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
}
