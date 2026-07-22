import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { validateProfile } from '../../agents/profile-schema.js';
import { seedInitialLocation } from '../../agents/seedLocation.js';
import { buildInspectionReport } from '../../visibility/explain.js';
import { readStateSnapshot, summarizeState } from '../../agents/state/stateSnapshot.js';
import { slugify } from '../../util/slugify.js';
import { scheduleAgentPortraitGeneration } from '../../skills/portraitGenerate.js';
import { sceneImageProvidersFromStore } from '../../skills/sceneImageEnv.js';

function uniqueAgentId(worldDir, name) {
  const base = slugify(name, { fallback: 'agent' });
  const agentsDir = path.join(worldDir, 'agents');
  let candidate = base;
  let n = 2;
  while (fs.existsSync(path.join(agentsDir, candidate))) candidate = `${base}-${n++}`;
  return candidate;
}

function avatarStorage(worldRegistry) {
  return multer.diskStorage({
    destination(req, file, cb) {
      const { worldId, agentId } = req.params;
      if (!worldRegistry.worldExists(worldId)) return cb(new Error(`world "${worldId}" not found`));
      const dir = path.join(worldRegistry.getWorld(worldId).worldDir, 'agents', agentId);
      if (!fs.existsSync(dir)) return cb(new Error(`no character "${agentId}"`));
      cb(null, dir);
    },
    filename(req, file, cb) {
      cb(null, `avatar${path.extname(file.originalname) || '.png'}`);
    },
  });
}

export function charactersRouter(worldRegistry, { providerSettingsStore } = {}) {
  const router = Router({ mergeParams: true });
  const upload = multer({ storage: avatarStorage(worldRegistry), limits: { fileSize: 8 * 1024 * 1024 } });

  router.get('/', (req, res) => {
    const { worldId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    const { agentRegistry, store, locationRegistry } = worldRegistry.getWorld(worldId);
    const characters = agentRegistry.listAgentIds().map((id) => ({
      id,
      ...agentRegistry.loadProfile(id),
      state: summarizeState(readStateSnapshot(store, id), locationRegistry),
    }));
    res.json({ characters });
  });

  router.get('/:agentId', (req, res) => {
    const { worldId, agentId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    const { agentRegistry } = worldRegistry.getWorld(worldId);
    try {
      res.json({ id: agentId, ...agentRegistry.loadProfile(agentId) });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get('/:agentId/inspect', (req, res) => {
    const { worldId, agentId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    const { store, agentRegistry } = worldRegistry.getWorld(worldId);
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    const showDenied = req.query.showDenied === 'true';
    try {
      res.json(buildInspectionReport({ agentId, worldId, store, agentRegistry, limit, showDenied }));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.post('/', (req, res) => {
    const { worldId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    const profile = req.body ?? {};
    if (!validateProfile(profile)) {
      return res.status(400).json({ error: 'invalid character profile', details: validateProfile.errors });
    }

    const { worldDir, store, agentRegistry, locationRegistry } = worldRegistry.getWorld(worldId);
    const agentId = uniqueAgentId(worldDir, profile.name);
    const agentDir = path.join(worldDir, 'agents', agentId);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'profile.json'), JSON.stringify(profile, null, 2));
    agentRegistry.invalidate(agentId);

    const startId = profile.location ? locationRegistry.ensure(profile.location).id : locationRegistry.getStartId();
    seedInitialLocation(store, agentId, startId);

    // Async: generate emotion portraits + default avatar from profile text (does not block create).
    // Invalidate cache when done — the Python script may write profile.avatar on disk.
    scheduleAgentPortraitGeneration(
      {
        agentDir,
        agentId,
        seed: Date.now() % 100000,
        writeAvatar: true,
        provider: sceneImageProvidersFromStore(providerSettingsStore),
      },
      { onDone: () => agentRegistry.invalidate(agentId) },
    );

    res.status(201).json({
      id: agentId,
      ...agentRegistry.loadProfile(agentId),
      portraitsStatus: 'generating',
    });
  });

  router.put('/:agentId', (req, res) => {
    const { worldId, agentId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    const { worldDir, agentRegistry } = worldRegistry.getWorld(worldId);
    const agentDir = path.join(worldDir, 'agents', agentId);
    if (!fs.existsSync(agentDir)) {
      return res.status(404).json({ error: `no character "${agentId}"` });
    }

    let existing;
    try {
      existing = agentRegistry.loadProfile(agentId);
    } catch {
      existing = {};
    }
    const merged = { ...existing, ...req.body };
    if (!validateProfile(merged)) {
      return res.status(400).json({ error: 'invalid character profile', details: validateProfile.errors });
    }

    fs.writeFileSync(path.join(agentDir, 'profile.json'), JSON.stringify(merged, null, 2));
    agentRegistry.invalidate(agentId);
    res.json({ id: agentId, ...agentRegistry.loadProfile(agentId) });
  });

  router.delete('/:agentId', (req, res) => {
    const { worldId, agentId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    const { worldDir, agentRegistry } = worldRegistry.getWorld(worldId);
    const agentDir = path.join(worldDir, 'agents', agentId);
    if (!fs.existsSync(agentDir)) {
      return res.status(404).json({ error: `no character "${agentId}"` });
    }

    // Archive, never hard-delete — the event log is append-only, and this agent's history must
    // stay intact even after it's pulled from the active roster.
    fs.renameSync(agentDir, path.join(worldDir, 'agents', `_archived_${agentId}_${Date.now()}`));
    agentRegistry.invalidate(agentId);
    res.status(204).end();
  });

  router.post('/:agentId/avatar', upload.single('avatar'), (req, res) => {
    const { worldId, agentId } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: 'avatar file is required (multipart field "avatar")' });
    }

    const { worldDir, agentRegistry } = worldRegistry.getWorld(worldId);
    const profilePath = path.join(worldDir, 'agents', agentId, 'profile.json');
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    profile.avatar = req.file.filename;
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
    agentRegistry.invalidate(agentId);

    res.json({ id: agentId, ...agentRegistry.loadProfile(agentId) });
  });

  return router;
}
