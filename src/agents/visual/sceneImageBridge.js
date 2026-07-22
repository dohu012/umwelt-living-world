import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  loadSceneImageEnv,
  resolveSceneImagePython,
  SCENE_IMAGE_ROOT,
} from '../../skills/sceneImageEnv.js';

/** Repository-local Python scene-image package (Hook E+F). */
export { SCENE_IMAGE_ROOT };

export const BRIDGE_SCRIPT = path.join(SCENE_IMAGE_ROOT, 'scripts', 'run_umwelt_bridge.py');

export function bridgeAvailable() {
  return fs.existsSync(BRIDGE_SCRIPT);
}

/**
 * Spawns the Python bridge with `payload` on stdin and parses its JSON stdout.
 *
 * Resolves (never rejects) with `{ok, result | error}` so callers can treat a missing venv, a
 * timeout and a bad key uniformly. Spawning per call is fine here: the asset layer only reaches
 * this code on a cache miss, where a real image generation of tens of seconds dwarfs interpreter
 * startup.
 *
 * `provider` should be the split object from `sceneImageProvidersFromStore` (or a legacy single
 * profile). When omitted, falls back to scene-image/.env — UI 模型服务 will not apply.
 */
export function runSceneImageBridge(payload, { timeoutMs = 180_000, provider } = {}) {
  const python = resolveSceneImagePython();
  const env = loadSceneImageEnv(provider ?? {});
  if (payload.outputDir) env.SCENE_IMAGE_OUTPUT_DIR = payload.outputDir;

  return new Promise((resolve) => {
    const child = spawn(python, [BRIDGE_SCRIPT], {
      cwd: SCENE_IMAGE_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: `scene-image timed out after ${timeoutMs}ms`, stderr });
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, stderr });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, error: `bridge exit ${code}`, stderr: stderr || stdout });
        return;
      }
      try {
        resolve({ ok: true, result: JSON.parse(stdout), stderr });
      } catch (err) {
        resolve({ ok: false, error: `invalid JSON from bridge: ${err.message}`, stdout, stderr });
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
