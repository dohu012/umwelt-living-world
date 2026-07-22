/**
 * Fire-and-forget agent portrait generation after character create.
 * Spawns scene-image/scripts/generate_agent_portraits.py into agents/<id>/portraits/.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { loadSceneImageEnv, resolveSceneImagePython, SCENE_IMAGE_ROOT } from './sceneImageEnv.js';

/**
 * @param {{
 *   agentDir: string,
 *   agentId?: string,
 *   seed?: number,
 *   skipExisting?: boolean,
 *   writeAvatar?: boolean,
 *   timeoutMs?: number,
 *   provider?: { apiKey?: string|null, baseUrl?: string|null },
 * }} opts
 * @returns {Promise<{ ok: boolean, result?: object, error?: string, stderr?: string }>}
 */
export function runAgentPortraitGeneration(opts) {
  const script = path.join(SCENE_IMAGE_ROOT, 'scripts', 'generate_agent_portraits.py');
  if (!fs.existsSync(script)) {
    return Promise.resolve({ ok: false, error: 'generate_agent_portraits.py missing' });
  }
  if (!opts?.agentDir) {
    return Promise.resolve({ ok: false, error: 'agentDir is required' });
  }

  const args = ['--agent-dir', opts.agentDir];
  if (opts.agentId) args.push('--agent-id', opts.agentId);
  if (opts.seed != null) args.push('--seed', String(opts.seed));
  if (opts.skipExisting) args.push('--skip-existing');
  if (opts.writeAvatar === false) args.push('--no-avatar');

  const python = resolveSceneImagePython();
  const env = loadSceneImageEnv(opts.provider);
  const timeoutMs = opts.timeoutMs ?? 300_000;

  return new Promise((resolve) => {
    const child = spawn(python, [script, ...args], {
      cwd: SCENE_IMAGE_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: `portrait generation timed out after ${timeoutMs}ms`, stderr });
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
        resolve({ ok: false, error: `portrait script exit ${code}`, stderr: stderr || stdout });
        return;
      }
      try {
        const line = stdout.trim().split('\n').filter(Boolean).pop() || '{}';
        resolve({ ok: true, result: JSON.parse(line), stderr });
      } catch (err) {
        resolve({ ok: false, error: `invalid JSON from portrait script: ${err.message}`, stdout, stderr });
      }
    });
  });
}

/**
 * Non-blocking: schedules portrait generation and logs failures.
 * Safe to call from HTTP handlers after responding.
 */
export function scheduleAgentPortraitGeneration(opts, { onDone } = {}) {
  const script = path.join(SCENE_IMAGE_ROOT, 'scripts', 'generate_agent_portraits.py');
  if (!fs.existsSync(script)) {
    onDone?.({ ok: false, error: 'generate_agent_portraits.py missing' });
    return;
  }
  setImmediate(() => {
    runAgentPortraitGeneration(opts)
      .then((result) => {
        if (!result.ok) {
          console.warn('[portraits]', opts.agentId || opts.agentDir, result.error, result.stderr || '');
        } else {
          console.log('[portraits]', opts.agentId || opts.agentDir, 'ok', result.result?.generated);
        }
        onDone?.(result);
      })
      .catch((err) => {
        console.warn('[portraits]', opts.agentId || opts.agentDir, err.message);
        onDone?.({ ok: false, error: err.message });
      });
  });
}
