/**
 * Shared env loader for spawning scene-image Python (portraits + scene pipeline).
 * Prefers API keys / models from the 模型服务 UI (per-kind providers) over .env files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The image pipeline lives inside this repository so a fresh clone is self-contained.
export const SCENE_IMAGE_ROOT = path.resolve(__dirname, '../../scene-image');

function applyBaseUrl(env, baseUrl) {
  if (!baseUrl) return;
  let base = String(baseUrl).replace(/\/+$/, '');
  if (!/\/v1$/i.test(base)) base = `${base}/v1`;
  env.STEP_BASE_URL = base;
  env.STEPFUN_BASE_URL = base;
}

function applyApiKey(env, apiKey) {
  if (!apiKey) return;
  env.STEP_API_KEY = apiKey;
  env.STEPFUN_API_KEY = apiKey;
}

/**
 * @param {{
 *   apiKey?: string|null,
 *   baseUrl?: string|null,
 *   model?: string|null,
 *   imageModel?: string|null,
 *   imageEditModel?: string|null,
 *   kind?: string|null,
 * } | {
 *   image?: object|null,
 *   imageEdit?: object|null,
 *   fallback?: object|null,
 * }} [fromProvider]
 *
 * Accepts either:
 * - a single legacy provider profile, or
 * - `{ image, imageEdit, fallback }` from per-kind 模型服务 entries.
 */
export function loadSceneImageEnv(fromProvider = {}) {
  const env = { ...process.env };
  const envPath = path.join(SCENE_IMAGE_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (env[m[1]] == null || env[m[1]] === '') env[m[1]] = v;
    }
  }

  const hasSplit =
    fromProvider &&
    (Object.prototype.hasOwnProperty.call(fromProvider, 'image') ||
      Object.prototype.hasOwnProperty.call(fromProvider, 'imageEdit') ||
      Object.prototype.hasOwnProperty.call(fromProvider, 'fallback'));

  if (hasSplit) {
    const image = fromProvider.image || null;
    const imageEdit = fromProvider.imageEdit || null;
    const fallback = fromProvider.fallback || null;

    // Key/baseUrl: prefer dedicated image providers, then fallback (e.g. dialogue).
    const keySource = image || imageEdit || fallback;
    applyApiKey(env, keySource?.apiKey || env.STEP_API_KEY || env.STEPFUN_API_KEY);
    if (!env.STEP_API_KEY && env.STEPFUN_API_KEY) env.STEP_API_KEY = env.STEPFUN_API_KEY;
    applyBaseUrl(env, keySource?.baseUrl);

    if (image?.model) env.STEP_IMAGE_MODEL = String(image.model).trim();
    if (imageEdit?.model) env.STEP_IMAGE_EDIT_MODEL = String(imageEdit.model).trim();

    // If only one image-related provider is set, still apply its key (already done) but
    // leave the other model to .env / Python defaults.
    return env;
  }

  // Legacy single-profile path (compat with older callers / tests).
  const key = fromProvider.apiKey || env.STEP_API_KEY || env.STEPFUN_API_KEY;
  applyApiKey(env, key);
  if (!env.STEP_API_KEY && env.STEPFUN_API_KEY) env.STEP_API_KEY = env.STEPFUN_API_KEY;
  applyBaseUrl(env, fromProvider.baseUrl);

  if (fromProvider.kind === 'image' && fromProvider.model) {
    env.STEP_IMAGE_MODEL = String(fromProvider.model).trim();
  } else if (fromProvider.imageModel) {
    env.STEP_IMAGE_MODEL = String(fromProvider.imageModel).trim();
  }

  if (fromProvider.kind === 'imageEdit' && fromProvider.model) {
    env.STEP_IMAGE_EDIT_MODEL = String(fromProvider.model).trim();
  } else if (fromProvider.imageEditModel) {
    env.STEP_IMAGE_EDIT_MODEL = String(fromProvider.imageEditModel).trim();
  }

  return env;
}

/** Build the split provider arg for loadSceneImageEnv / portrait scripts. */
export function sceneImageProvidersFromStore(store) {
  if (!store) return { image: null, imageEdit: null, fallback: null };
  return {
    image: store.getActiveForKind?.('image') ?? null,
    imageEdit: store.getActiveForKind?.('imageEdit') ?? null,
    fallback: store.getActiveForKind?.('dialogue') ?? store.getActive?.() ?? null,
  };
}

export function resolveSceneImagePython() {
  const venvPy = path.join(SCENE_IMAGE_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPy)) return venvPy;
  return process.env.SCENE_IMAGE_PYTHON || 'python3';
}
