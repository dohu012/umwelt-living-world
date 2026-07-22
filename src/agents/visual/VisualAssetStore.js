import fs from 'node:fs';
import path from 'node:path';

import { backgroundFileName, portraitFileName } from './assetKeys.js';

/**
 * Where generated visuals live on disk, and how they get addressed over HTTP.
 *
 * Portraits go into the agent's own directory and are published through `profile.avatar` — the
 * field the roster (ws.js `participantsAt`) and the chat bubbles (ChatRoom.jsx) already read, so a
 * generated portrait lights up the existing UI without any new plumbing.
 *
 * Backgrounds go into `<worldDir>/locations/<locId>/` and are indexed in locations.json by the
 * registry, so a world's visual state travels with its data directory.
 */
export class VisualAssetStore {
  constructor({ worldDir, worldId, agentRegistry, locationRegistry }) {
    this.worldDir = worldDir;
    this.worldId = worldId;
    this.agentRegistry = agentRegistry;
    this.locationRegistry = locationRegistry;
  }

  // ---- portraits ----

  portraitDir(agentId) {
    return path.join(this.worldDir, 'agents', agentId);
  }

  portraitPath(agentId, key) {
    return path.join(this.portraitDir(agentId), portraitFileName(key));
  }

  hasPortrait(agentId, key) {
    return fs.existsSync(this.portraitPath(agentId, key));
  }

  portraitUrl(agentId, key) {
    return `/media/${this.worldId}/agents/${agentId}/${portraitFileName(key)}`;
  }

  /**
   * Points the profile at a freshly generated portrait. Writing `avatar` is what makes the image
   * visible; the registry cache must be invalidated or every later read serves the stale profile.
   */
  commitPortrait(agentId, key) {
    const profilePath = path.join(this.portraitDir(agentId), 'profile.json');
    if (!fs.existsSync(profilePath)) return null;

    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    profile.avatar = portraitFileName(key);
    fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
    this.agentRegistry?.invalidate(agentId);
    return profile.avatar;
  }

  // ---- backgrounds ----

  backgroundDir(locationId) {
    return path.join(this.worldDir, 'locations', locationId);
  }

  backgroundPath(locationId, variantKey) {
    return path.join(this.backgroundDir(locationId), backgroundFileName(variantKey));
  }

  hasBackground(locationId, variantKey) {
    return fs.existsSync(this.backgroundPath(locationId, variantKey));
  }

  backgroundUrl(locationId, variantKey) {
    return `/api/worlds/${this.worldId}/locations/${encodeURIComponent(locationId)}/background?v=${variantKey}`;
  }

  commitBackground(locationId, variantKey, meta) {
    this.locationRegistry?.setBackground(locationId, variantKey, {
      file: backgroundFileName(variantKey),
      ...meta,
    });
    return backgroundFileName(variantKey);
  }

  ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
