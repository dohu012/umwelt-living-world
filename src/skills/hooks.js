/**
 * Skill hooks for fix-branch umwelt:
 *   A intent-dispatch  → who responds
 *   B state            → owned by agents/state/stateExtractionRunner (not this file)
 *   C–F scene-image    → portrait/background via Python bridge
 *
 * See HOOKS.md.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { resolveResponders } from '../orchestrator/InteractivePlay.js';
import { loadSceneImageEnv, resolveSceneImagePython, SCENE_IMAGE_ROOT } from './sceneImageEnv.js';

/** Status keys projected from facts_current for dispatch / image context. */
export const STATUS_KEYS = ['location', 'mood', 'action', 'affinity', 'relationship', 'trust'];

const DRAW_RE = /(画|立绘|背景|场景图|portrait|draw|generate\s+(an?\s+)?image|background)/i;
const EDIT_RE =
  /(改图|修图|编辑(一下|这张|图片|图像)?|改一下(图|立绘|背景)?|把.*(改成|换成|变成)|换成|edit(\s+the)?\s*(image|portrait|background)?|modify(\s+the)?\s*(image|portrait)?|change(\s+the)?\s*(image|portrait|outfit|hair|background)?)/i;
const ALL_SPEAK_RE = /(你们|大家都|各位|都说说|一起说)/;
const OBSERVE_RE = /(别说话|先别回|只看|旁观)/;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionsCandidate(text, token) {
  if (!token) return false;
  if (text.includes(token)) return true;
  // Latin id/name word boundary
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(token)}([^\\p{L}\\p{N}_]|$)`, 'iu').test(text);
}

/**
 * Hook A — intent-dispatch
 */
export async function runIntentDispatch({
  store,
  agentIds,
  location,
  personaId,
  playerMessage,
  candidates,
}) {
  const present =
    candidates ??
    resolveResponders({ store, agentIds, location }).map((id) => ({ id, name: id, state: {} }));

  const text = playerMessage ?? '';
  // Location is owned by the holistic scene-location skill (Hook G), so intent-dispatch no longer
  // carries a movement flag — only "should we draw/edit" and "should anyone respond at all".
  const requestEdit = EDIT_RE.test(text);
  const flags = {
    requestImage: DRAW_RE.test(text) || requestEdit,
    requestEdit,
    endScene: false,
  };

  if (OBSERVE_RE.test(text) && !flags.requestImage) {
    return {
      intent: 'observe',
      responderIds: [],
      mode: 'sequential',
      notes: 'player asked not to be answered',
      flags: { ...flags, endScene: true },
      personaId,
    };
  }

  const byNameLen = [...present].sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0));
  const addressed = [];
  for (const c of byNameLen) {
    for (const p of [c.name, c.id].filter(Boolean)) {
      if (mentionsCandidate(text, p)) {
        addressed.push(c.id);
        break;
      }
    }
  }

  let intent = 'chitchat';
  let responderIds = present.map((c) => c.id).sort();
  let notes = 'all present agents respond';

  if (addressed.length > 0) {
    intent = 'address_agent';
    responderIds = [...new Set(addressed)].sort();
    notes = `addressed: ${responderIds.join(', ')}`;
  } else if (ALL_SPEAK_RE.test(text)) {
    intent = 'chitchat';
    notes = 'explicit group address';
  } else if (flags.requestImage && present.length > 0) {
    intent = 'request_image';
    responderIds = [present.map((c) => c.id).sort()[0]];
    notes = 'image requested; one agent acknowledges';
  }

  return {
    intent,
    responderIds,
    mode: 'sequential',
    notes,
    flags,
    personaId,
  };
}

/** Latest type=image event path in this world (optionally preferring a subject). */
export function findLatestImagePath(store, { subjectId, worldDir, preferAgentPortrait = false } = {}) {
  if (!store?.db) return null;

  const pathFromRow = (row) => {
    if (!row?.data) return null;
    try {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      const p = data?.path;
      return typeof p === 'string' && p ? p : null;
    } catch {
      return null;
    }
  };

  const agentPortraitPath = () => {
    if (!worldDir || !subjectId) return null;
    const agentDir = path.join(worldDir, 'agents', subjectId);
    for (const rel of ['portraits/neutral.png', 'avatar.png']) {
      const candidate = path.join(agentDir, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  };

  if (subjectId) {
    // 「改立绘」类请求：优先用角色卡上的常驻立绘，避免沿用对话里误绑到别人的修图链。
    if (preferAgentPortrait) {
      const disk = agentPortraitPath();
      if (disk) return disk;
    }

    // Prefer this character's prior portrait/edit — never silently reuse another agent's art.
    const subjectPortrait = store.db
      .prepare(
        `SELECT data FROM events
         WHERE type = 'image' AND subject = ?
           AND content IN ('character_portrait', 'image_edit')
         ORDER BY seq DESC, id DESC LIMIT 1`,
      )
      .get(subjectId);
    const fromEvents = pathFromRow(subjectPortrait);
    if (fromEvents) return fromEvents;

    const anyForSubject = store.db
      .prepare(
        `SELECT data FROM events
         WHERE type = 'image' AND subject = ?
         ORDER BY seq DESC, id DESC LIMIT 1`,
      )
      .get(subjectId);
    const anyPath = pathFromRow(anyForSubject);
    if (anyPath) return anyPath;

    const disk = agentPortraitPath();
    if (disk) return disk;
    return null;
  }

  const row = store.db
    .prepare(
      `SELECT data FROM events WHERE type = 'image' ORDER BY seq DESC, id DESC LIMIT 1`,
    )
    .get();
  return pathFromRow(row);
}

export function buildSceneImageInput({
  location,
  locationName,
  personaId,
  playerMessage,
  agentTurns,
  agents,
  requestImage = false,
  requestEdit = false,
  sourceImage = null,
  forceTypes = undefined,
}) {
  const messages = [];
  if (playerMessage) {
    messages.push({ role: 'user', content: playerMessage });
  }
  for (const turn of agentTurns ?? []) {
    if (!turn?.dialogueText) continue;
    const label = turn.agentId ? `[${turn.agentId}]` : '';
    messages.push({
      role: 'assistant',
      content: label ? `${label}: ${turn.dialogueText}` : turn.dialogueText,
    });
  }
  const resolvedForceTypes =
    forceTypes !== undefined
      ? forceTypes
      : inferForceImageTypes(playerMessage, { requestEdit, requestImage });
  return {
    messages,
    location: locationName || location,
    personaId,
    requestImage: Boolean(requestImage || requestEdit),
    requestEdit: Boolean(requestEdit),
    sourceImage: sourceImage || null,
    forceTypes: resolvedForceTypes,
    agents: agents ?? [],
  };
}

/** Forced environment draw when the player arrives at a new location. */
export function buildLocationChangeImageInput({ location, locationName, personaId, fromLocationId = null }) {
  const dest = locationName || location;
  const from = fromLocationId ? `（从 ${fromLocationId}）` : '';
  return buildSceneImageInput({
    location,
    locationName: dest,
    personaId,
    playerMessage: `换地点到${dest}${from}，生成当前环境场景图`,
    agentTurns: [],
    agents: [],
    requestImage: true,
    requestEdit: false,
    forceTypes: ['environment'],
  });
}

/**
 * Map player wording to pipeline image types.
 * Previously requestImage always forced character_portrait, so「生成场景图」still drew a portrait.
 */
function inferForceImageTypes(playerMessage, { requestEdit = false, requestImage = false } = {}) {
  if (requestEdit) return ['image_edit'];
  if (!requestImage) return null;

  const text = playerMessage ?? '';
  const wantsScene = /(背景|场景图|场景|environment|background)/i.test(text);
  const wantsPortrait =
    /(立绘|角色立绘|portrait)/i.test(text) ||
    (/(角色)/.test(text) && /(画|生成|出图)/.test(text));

  if (wantsScene && wantsPortrait) return ['character_portrait', 'environment'];
  if (wantsScene) return ['environment'];
  if (wantsPortrait) return ['character_portrait'];
  // Generic「画一下」— leave null so Python detect can decide (defaults to portrait).
  return null;
}

function runPythonBridge(payload, { timeoutMs = 120_000, provider } = {}) {
  const script = path.join(SCENE_IMAGE_ROOT, 'scripts', 'run_umwelt_bridge.py');
  const python = resolveSceneImagePython();
  const env = loadSceneImageEnv(provider);
  if (payload.outputDir) env.SCENE_IMAGE_OUTPUT_DIR = payload.outputDir;

  return new Promise((resolve) => {
    const child = spawn(python, [script], {
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

/**
 * Hook C–F — scene-image pipeline via Python bridge.
 */
export async function runSceneImagePipeline(input, opts = {}) {
  if (!input?.messages?.length) {
    return { skipped: true, reason: 'no messages' };
  }

  const blob = input.messages.map((m) => m.content).join('\n');
  const looksVisual =
    DRAW_RE.test(blob) || EDIT_RE.test(blob) || input.requestImage || input.requestEdit;
  if (!looksVisual && !opts.force) {
    return { skipped: true, reason: 'no visual trigger', input };
  }

  const bridgeScript = path.join(SCENE_IMAGE_ROOT, 'scripts', 'run_umwelt_bridge.py');
  if (!fs.existsSync(bridgeScript)) {
    return { skipped: true, reason: 'scene-image bridge missing', input };
  }

  const outputDir = opts.outputDir || path.join(SCENE_IMAGE_ROOT, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const bridge = await runPythonBridge(
    {
      ...input,
      dry_run: Boolean(opts.dryRun),
      outputDir,
      seed: opts.seed ?? Date.now() % 100000,
    },
    { timeoutMs: opts.timeoutMs ?? 120_000, provider: opts.provider },
  );

  if (!bridge.ok) {
    const detail = (bridge.stderr || '').trim().split('\n').filter(Boolean).slice(-3).join(' | ');
    const error = detail ? `${bridge.error}: ${detail}` : bridge.error;
    return { skipped: false, error, stderr: bridge.stderr, input };
  }

  const result = bridge.result;
  if (result?.error) {
    return { skipped: false, error: result.error, detect: result?.detect, input };
  }
  if (!result?.detect?.need_image && !(result?.images?.length > 0)) {
    return {
      skipped: true,
      reason: result?.detect?.reason || 'detector said no image',
      detect: result?.detect,
      input,
    };
  }

  const images = (result.images || []).map((img) => {
    const basename = img.path ? path.basename(img.path) : null;
    return {
      ...img,
      fileName: basename,
      mediaPath: basename ? `images/${basename}` : null,
    };
  });

  return {
    skipped: false,
    detect: result.detect,
    context: result.context,
    prompts: result.prompts,
    images,
    dry_run: result.dry_run,
    input,
  };
}

export function readAgentStatus(store, agentId) {
  const facts = store.getFactsForSubject(agentId);
  const state = {};
  for (const f of facts) {
    if (STATUS_KEYS.includes(f.key)) state[f.key] = f.content;
  }
  return state;
}
