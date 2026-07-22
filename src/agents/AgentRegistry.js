import fs from 'node:fs';
import path from 'node:path';
import { validateProfile } from './profile-schema.js';

export class AgentRegistry {
  constructor(worldDir) {
    this.worldDir = worldDir;
    this._cache = new Map();
  }

  /**
   * Every active agent dir under worldDir/agents, regardless of whether its profile has been
   * loaded yet. Dirs starting with "_" (e.g. "_archived_<id>_<ts>", see the character DELETE
   * route) are soft-deleted agents kept for history and excluded from the active roster.
   */
  listAgentIds() {
    const agentsDir = path.join(this.worldDir, 'agents');
    if (!fs.existsSync(agentsDir)) return [];
    return fs
      .readdirSync(agentsDir)
      .filter((name) => !name.startsWith('_'))
      .filter((name) => fs.statSync(path.join(agentsDir, name)).isDirectory());
  }

  invalidate(agentId) {
    this._cache.delete(agentId);
  }

  loadProfile(agentId) {
    if (this._cache.has(agentId)) return this._cache.get(agentId);

    const profilePath = path.join(this.worldDir, 'agents', agentId, 'profile.json');
    if (!fs.existsSync(profilePath)) {
      throw new Error(`No profile.json found for agent "${agentId}" at ${profilePath}`);
    }

    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    if (!validateProfile(profile)) {
      throw new Error(
        `profile.json for "${agentId}" failed schema validation: ${JSON.stringify(validateProfile.errors)}`,
      );
    }

    this._cache.set(agentId, profile);
    return profile;
  }
}
