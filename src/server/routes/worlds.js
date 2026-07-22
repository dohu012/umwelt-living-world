import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { slugify } from '../../util/slugify.js';
import { movePersonaToLocation, resolvePersonaLocation } from '../../agents/seedLocation.js';
import { readStateSnapshot, summarizeState } from '../../agents/state/stateSnapshot.js';

const BACKGROUND_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function buildReturnBriefing(world, personaId) {
  const marker = world.db.prepare('SELECT value FROM simulation_state WHERE key = ?')
    .pluck().get(`persona.last_departure:${personaId}`);
  const departure = parseJson(marker);
  if (departure?.seq == null) return null;
  const relevantTypes = new Set(['life_action', 'decision_resolved', 'world_event', 'dialogue', 'narration', 'autonomous_scene']);
  const events = world.store.getEventsWithTags()
    .filter((event) => event.seq > departure.seq && relevantTypes.has(event.type))
    .map((event) => ({ ...event, data: parseJson(event.data) }))
    .filter((event) => !['dialogue', 'narration'].includes(event.type) || event.data?.autonomous === true)
    .slice(-40)
    .map((event) => {
      let actorName = event.actor;
      try { actorName = world.agentRegistry.loadProfile(event.actor)?.name ?? event.actor; } catch { /* system actor */ }
      const locationId = event.data?.location ?? event.tags?.find((tag) => tag.startsWith('local:'))?.slice(6) ?? null;
      return {
        id: event.id,
        seq: event.seq,
        ts: event.ts,
        type: event.type,
        actor: event.actor,
        actorName,
        content: event.content,
        data: event.data,
        locationId,
        locationName: locationId ? world.locationRegistry.get(locationId)?.name ?? locationId : null,
      };
    });
  if (events.length === 0) return null;
  return {
    from: departure.worldTime,
    to: world.clock.getState().worldTime,
    eventCount: events.length,
    events,
  };
}

function uniqueWorldId(worldRegistry, name) {
  const base = slugify(name, { fallback: 'world' });
  let candidate = base;
  let n = 2;
  while (worldRegistry.worldExists(candidate)) candidate = `${base}-${n++}`;
  return candidate;
}

export function worldsRouter(worldRegistry, { personaStore } = {}) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({ worlds: worldRegistry.listWorldIds(), templates: worldRegistry.listTemplateIds() });
  });

  router.post('/', (req, res) => {
    const { name, template } = req.body ?? {};
    if (!name && !template) return res.status(400).json({ error: 'name or template is required' });
    try {
      if (template) {
        const world = worldRegistry.createFromTemplate(template, { name: name || template });
        return res.status(201).json({
          id: world.worldId,
          agentIds: world.agentRegistry.listAgentIds(),
          template,
          metadata: world.metadata ?? null,
        });
      }
      const id = uniqueWorldId(worldRegistry, name);
      const world = worldRegistry.createWorld(id);
      res.status(201).json({ id, agentIds: world.agentRegistry.listAgentIds() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/:worldId', (req, res) => {
    const { worldId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    const { agentRegistry, metadata } = worldRegistry.getWorld(worldId);
    res.json({ id: worldId, agentIds: agentRegistry.listAgentIds(), metadata: metadata ?? null });
  });

  router.post('/:worldId/copy', async (req, res) => {
    const { worldId } = req.params;
    const { name, keepContext = false } = req.body ?? {};
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    try {
      const id = await worldRegistry.copyWorld(worldId, { name, keepContext: Boolean(keepContext) });
      res.status(201).json({ id, keepContext: Boolean(keepContext) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:worldId', (req, res) => {
    const { worldId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    try {
      worldRegistry.deleteWorld(worldId);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:worldId/locations', (req, res) => {
    const { worldId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    const { locationRegistry } = worldRegistry.getWorld(worldId);
    res.json({ locations: locationRegistry.list() });
  });

  router.post('/:worldId/locations', (req, res) => {
    const { worldId } = req.params;
    const { name } = req.body ?? {};
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const { locationRegistry } = worldRegistry.getWorld(worldId);
    const existingIds = new Set(locationRegistry.list().map((item) => item.id));
    const location = locationRegistry.ensure(name);
    res.status(existingIds.has(location.id) ? 200 : 201).json(location);
  });

  router.post('/:worldId/personas/:personaId/enter', (req, res) => {
    const { worldId, personaId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    if (!personaStore?.get(personaId)) {
      return res.status(404).json({ error: `no persona "${personaId}"` });
    }
    const current = worldRegistry.getWorld(worldId);
    const { store, locationRegistry } = current;
    const location = resolvePersonaLocation({ store, personaId, locationRegistry });
    res.json({ location, briefing: buildReturnBriefing(current, personaId) });
  });

  router.post('/:worldId/personas/:personaId/location', (req, res) => {
    const { worldId, personaId } = req.params;
    const { location } = req.body ?? {};
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    if (!personaStore?.get(personaId)) {
      return res.status(404).json({ error: `no persona "${personaId}"` });
    }
    if (!location) return res.status(400).json({ error: 'location is required' });

    const { store, locationRegistry } = worldRegistry.getWorld(worldId);
    if (!locationRegistry.get(location)) {
      return res.status(404).json({ error: `no location "${location}" in world "${worldId}"` });
    }
    res.json(movePersonaToLocation({ store, personaId, locationId: location }));
  });

  router.get('/:worldId/personas/:personaId/state', (req, res) => {
    const { worldId, personaId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    if (!personaStore?.get(personaId)) {
      return res.status(404).json({ error: `no persona "${personaId}"` });
    }
    const { store, locationRegistry } = worldRegistry.getWorld(worldId);
    res.json({ personaId, ...summarizeState(readStateSnapshot(store, personaId), locationRegistry) });
  });

  router.get('/:worldId/background', (req, res) => {
    const { worldId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    const { worldDir } = worldRegistry.getWorld(worldId);
    const found = BACKGROUND_EXTENSIONS.map((ext) => `background${ext}`).find((name) =>
      fs.existsSync(path.join(worldDir, name)),
    );
    if (!found) return res.status(404).json({ error: `no background set for world "${worldId}"` });
    res.sendFile(path.join(worldDir, found));
  });

  /**
   * A location's generated backdrop. `?v=<variantKey>` picks a specific one (dusk, rain…);
   * without it the location's most recently generated variant is served. A 404 here is normal and
   * expected — the client falls back to the world background until generation finishes.
   */
  router.get('/:worldId/locations/:locationId/background', (req, res) => {
    const { worldId, locationId } = req.params;
    if (!worldRegistry.worldExists(worldId)) {
      return res.status(404).json({ error: `world "${worldId}" not found` });
    }
    const { worldDir, locationRegistry } = worldRegistry.getWorld(worldId);
    const entry = locationRegistry.getBackground(locationId, req.query.v ?? null);
    if (!entry?.file) {
      return res.status(404).json({ error: `no background for location "${locationId}"` });
    }
    const file = path.join(worldDir, 'locations', locationId, entry.file);
    if (!fs.existsSync(file)) {
      return res.status(404).json({ error: `background file missing for "${locationId}"` });
    }
    res.sendFile(file);
  });

  return router;
}
