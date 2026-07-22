import fs from 'node:fs';
import path from 'node:path';
import { AgentPlanner } from './AgentPlanner.js';

const HOUR = 60 * 60 * 1000;
const DEFAULT_NEEDS = { energy: 75, satiety: 70, social: 60, safety: 80 };

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function parse(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export class LifeSimulator {
  constructor({ db, store, agentRegistry, locationRegistry, environment, decisions, worldDir, planner = new AgentPlanner() }) {
    this.db = db;
    this.store = store;
    this.agentRegistry = agentRegistry;
    this.locationRegistry = locationRegistry;
    this.environment = environment;
    this.decisions = decisions;
    this.worldDir = worldDir;
    this.planner = planner;
    this.config = this._loadConfig();
  }

  _loadConfig() {
    const file = path.join(this.worldDir, 'living-world.json');
    if (!fs.existsSync(file)) return { tickMinutes: 60, agents: {} };
    try { return { tickMinutes: 60, agents: {}, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
    catch { return { tickMinutes: 60, agents: {} }; }
  }

  _configFor(agentId) {
    return this.config.agents?.[agentId] ?? {};
  }

  _ensureAgent(agentId, at) {
    const existing = this.db.prepare('SELECT agent_id FROM agent_life_state WHERE agent_id = ?').get(agentId);
    if (existing) return;
    const configured = this._configFor(agentId).needs ?? {};
    const needs = { ...DEFAULT_NEEDS, ...configured };
    this.db.prepare(`
      INSERT INTO agent_life_state (agent_id, needs, current_action, updated_at)
      VALUES (?, ?, 'idle', ?)
    `).run(agentId, JSON.stringify(needs), at);
  }

  getAgent(agentId) {
    const row = this.db.prepare('SELECT * FROM agent_life_state WHERE agent_id = ?').get(agentId);
    if (!row) return null;
    return {
      agentId: row.agent_id,
      needs: parse(row.needs, { ...DEFAULT_NEEDS }),
      currentAction: row.current_action,
      actionData: parse(row.action_data, null),
      lastActionAt: row.last_action_at,
      updatedAt: row.updated_at,
      config: this._configFor(agentId),
    };
  }

  listAgents(at = new Date().toISOString()) {
    const ids = this.agentRegistry.listAgentIds();
    for (const id of ids) this._ensureAgent(id, at);
    return ids.map((id) => this.getAgent(id));
  }

  _getLastTick() {
    const row = this.db.prepare("SELECT value FROM simulation_state WHERE key = 'life.last_tick'").get();
    return row?.value ?? null;
  }

  _setLastTick(value) {
    this.db.prepare(`
      INSERT INTO simulation_state (key, value, updated_at) VALUES ('life.last_tick', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(value, value);
  }

  _locationOf(agentId) {
    return this.store.getFact(agentId, 'location')?.content ?? this.locationRegistry.getStartId();
  }

  _companions(agentId, location) {
    return this.agentRegistry.listAgentIds()
      .filter((otherId) => otherId !== agentId && this._locationOf(otherId) === location)
      .sort();
  }

  _decay(needs, elapsedHours, action) {
    const sleeping = action === 'sleep';
    return {
      energy: clamp(needs.energy + elapsedHours * (sleeping ? 16 : -4)),
      satiety: clamp(needs.satiety - elapsedHours * 4),
      social: clamp(needs.social - elapsedHours * 1.5),
      safety: clamp(needs.safety),
    };
  }

  _applyAction(needs, action, weather) {
    const next = { ...needs };
    if (action.type === 'eat') next.satiety += 30;
    if (action.type === 'sleep') next.energy += 20;
    if (action.type === 'socialize') next.social += 20;
    if (action.type === 'work' || action.type === 'inspect') next.energy -= 6;
    if ((weather === 'typhoon' || weather === 'storm') && action.type !== 'shelter') next.safety -= 12;
    if (action.type === 'shelter') next.safety += 4;
    return Object.fromEntries(Object.entries(next).map(([key, value]) => [key, clamp(value)]));
  }

  _runAgent(agentId, at, elapsedHours) {
    this._ensureAgent(agentId, at);
    const state = this.getAgent(agentId);
    const currentLocation = this._locationOf(agentId);
    const weather = this.environment.get('world', 'weather.current')?.value ?? 'clear';
    const decayed = this._decay(state.needs, elapsedHours, state.currentAction);
    const config = this._configFor(agentId);
    const action = this.planner.choose({
      needs: decayed,
      schedule: config.schedule ?? [],
      worldTime: at,
      weather,
      currentLocation,
      shelterLocation: config.shelterLocation ?? this.locationRegistry.getStartId(),
      companions: this._companions(agentId, currentLocation),
    });
    const location = this.locationRegistry.get(action.location) ? action.location : currentLocation;
    if (location && location !== currentLocation) {
      this.store.append({ type: 'state', actor: agentId, subject: agentId, key: 'location', content: location, ts: at }, [
        `private:${agentId}`,
        `local:${location}`,
      ]);
    }
    const needs = this._applyAction(decayed, action, weather);
    this.db.prepare(`
      UPDATE agent_life_state
      SET needs = ?, current_action = ?, action_data = ?, last_action_at = ?, updated_at = ?
      WHERE agent_id = ?
    `).run(JSON.stringify(needs), action.type, JSON.stringify({ ...action, location }), at, at, agentId);
    if (action.type !== 'idle' || state.currentAction !== 'idle') {
      this.store.append({
        type: 'life_action',
        actor: agentId,
        subject: agentId,
        content: action.type,
        data: { ...action, location, needs, weather },
        ts: at,
      }, [`private:${agentId}`, location ? `local:${location}` : 'global']);
    }
    return { agentId, action: { ...action, location }, needs };
  }

  advanceTo(worldTime, { maxSteps = 24 } = {}) {
    const target = new Date(worldTime);
    if (!Number.isFinite(target.getTime())) throw new Error(`invalid worldTime: ${worldTime}`);
    const interval = Math.max(1, Number(this.config.tickMinutes ?? 60)) * 60 * 1000;
    const previous = this._getLastTick();
    if (!previous) {
      this.listAgents(target.toISOString());
      this._setLastTick(target.toISOString());
      return { steps: 0, actions: [], caughtUp: false };
    }
    const elapsed = Math.max(0, target.getTime() - new Date(previous).getTime());
    const totalSteps = Math.floor(elapsed / interval);
    const steps = Math.min(totalSteps, maxSteps);
    const skippedSteps = Math.max(0, totalSteps - steps);
    const baseTime = new Date(previous).getTime() + skippedSteps * interval;
    const actions = [];
    for (let index = 1; index <= steps; index += 1) {
      const at = new Date(baseTime + index * interval).toISOString();
      const elapsedHours = (index === 1 ? skippedSteps + 1 : 1) * interval / HOUR;
      for (const agentId of this.agentRegistry.listAgentIds()) {
        actions.push(this._runAgent(agentId, at, elapsedHours));
      }
    }
    if (totalSteps > 0) this._setLastTick(target.toISOString());
    return { steps, actions, caughtUp: totalSteps > maxSteps, skippedSteps };
  }
}
