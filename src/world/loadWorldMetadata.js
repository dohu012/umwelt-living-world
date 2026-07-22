import fs from 'node:fs';
import path from 'node:path';

/** @typedef {{
 *   name?: string;
 *   subtitle?: string;
 *   intro?: {
 *     version: number;
 *     playerRole?: string;
 *     summary?: string;
 *     environment?: string;
 *     openingNarration?: string;
 *     openingAgentId?: string;
 *   };
 * }} WorldMetadata */

/**
 * Loads optional authored world metadata from data/world/<id>/world.json.
 * Worlds without this file behave exactly as before (no intro).
 */
export function loadWorldMetadata(worldDir) {
  const filePath = path.join(worldDir, 'world.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function introFactKey(version) {
  return `world_intro:${version}`;
}
