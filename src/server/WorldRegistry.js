import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../store/db.js';
import { EventStore } from '../store/EventStore.js';
import { AgentRegistry } from '../agents/AgentRegistry.js';
import { LocationRegistry } from '../settings/LocationRegistry.js';
import { seedInitialLocation } from '../agents/seedLocation.js';
import { slugify } from '../util/slugify.js';
import { loadWorldMetadata } from '../world/loadWorldMetadata.js';
import { WorldClock } from '../simulation/WorldClock.js';
import { JobQueue } from '../simulation/JobQueue.js';
import { DecisionManager } from '../simulation/DecisionManager.js';
import { WorldEventEngine } from '../simulation/WorldEventEngine.js';
import { WorldEngine } from '../simulation/WorldEngine.js';

/**
 * Lazily opens and caches one { db, store, agentRegistry, locationRegistry } bundle per world
 * directory under data/world/<worldId>. A world's sqlite connection is opened at most once per
 * server process.
 */
export class WorldRegistry {
  constructor({ projectRoot, dataDir }) {
    this.projectRoot = projectRoot;
    this.worldsRoot = path.join(projectRoot, dataDir);
    this._cache = new Map();
  }

  listTemplateIds() {
    const templatesRoot = path.join(this.projectRoot, 'data', 'templates');
    if (!fs.existsSync(templatesRoot)) return [];
    return fs
      .readdirSync(templatesRoot)
      .filter((name) => fs.statSync(path.join(templatesRoot, name)).isDirectory());
  }

  listWorldIds() {
    if (!fs.existsSync(this.worldsRoot)) return [];
    return fs
      .readdirSync(this.worldsRoot)
      .filter((name) => fs.statSync(path.join(this.worldsRoot, name)).isDirectory());
  }

  worldExists(worldId) {
    return fs.existsSync(path.join(this.worldsRoot, worldId));
  }

  getWorld(worldId) {
    if (this._cache.has(worldId)) return this._cache.get(worldId);

    const worldDir = path.join(this.worldsRoot, worldId);
    const db = openDb(path.join(worldDir, 'events.db'));
    const store = new EventStore(db);
    const agentRegistry = new AgentRegistry(worldDir);
    const locationRegistry = new LocationRegistry(path.join(worldDir, 'locations.json'));
    fs.mkdirSync(path.join(worldDir, 'images'), { recursive: true });

    const metadata = loadWorldMetadata(worldDir);
    const clock = new WorldClock(db);
    const queue = new JobQueue(db);
    const decisions = new DecisionManager(db);
    const worldNow = () => new Date(clock.getState().worldTime);
    const worldEvents = new WorldEventEngine({ db, queue, eventStore: store, now: worldNow });
    const engine = new WorldEngine({ clock, queue, worldEvents });
    const world = {
      worldId,
      worldDir,
      db,
      store,
      agentRegistry,
      locationRegistry,
      metadata,
      clock,
      queue,
      decisions,
      worldEvents,
      engine,
    };
    this._cache.set(worldId, world);
    return world;
  }

  _uniqueWorldId(base) {
    let candidate = base;
    let n = 2;
    while (this.worldExists(candidate)) candidate = `${base}-${n++}`;
    return candidate;
  }

  /**
   * Duplicates a world into a brand-new one. Character cards (agents/<id>/profile.json + avatar)
   * always come along unchanged. `keepContext` decides the runtime state:
   *  - true  → full clone: a consistent copy of the event log (via sqlite online backup, since the
   *            source runs in WAL mode), plus the location map, per-agent state/memory caches, and
   *            generated images. Relationships, history, positions — everything carries over.
   *  - false → clean slate: a fresh empty event store, the location map reset to just the seeded
   *            "Start", and each agent re-seeded there. All state (mood/action/location/
   *            relationships) is therefore reset; only the characters themselves are preserved.
   */
  async copyWorld(sourceId, { name, keepContext = false } = {}) {
    if (!this.worldExists(sourceId)) throw new Error(`world "${sourceId}" not found`);

    const newId = this._uniqueWorldId(slugify(name || `${sourceId}-copy`, { fallback: 'world' }));
    const srcDir = path.join(this.worldsRoot, sourceId);
    const dstDir = path.join(this.worldsRoot, newId);
    const srcAgents = path.join(srcDir, 'agents');
    fs.mkdirSync(path.join(dstDir, 'agents'), { recursive: true });

    if (fs.existsSync(srcAgents)) {
      for (const agentId of fs.readdirSync(srcAgents)) {
        const s = path.join(srcAgents, agentId);
        if (!fs.statSync(s).isDirectory()) continue;
        const d = path.join(dstDir, 'agents', agentId);
        fs.mkdirSync(d, { recursive: true });
        for (const file of fs.readdirSync(s)) {
          // state.json / memory.md are derived caches — only carried over when keeping context.
          if (!keepContext && (file === 'state.json' || file === 'memory.md')) continue;
          // Portrait sets live in a subdirectory (portraits/manifest.json + per-mood images) —
          // copyFileSync only handles flat files, so recurse for anything that isn't one.
          fs.cpSync(path.join(s, file), path.join(d, file), { recursive: true });
        }
      }
    }

    const worldJson = path.join(srcDir, 'world.json');
    if (fs.existsSync(worldJson)) fs.copyFileSync(worldJson, path.join(dstDir, 'world.json'));
    const storyMd = path.join(srcDir, 'STORY.md');
    if (fs.existsSync(storyMd)) fs.copyFileSync(storyMd, path.join(dstDir, 'STORY.md'));

    if (keepContext) {
      const src = this.getWorld(sourceId);
      await src.store.db.backup(path.join(dstDir, 'events.db')); // online, consistent even under WAL
      const locations = path.join(srcDir, 'locations.json');
      if (fs.existsSync(locations)) fs.copyFileSync(locations, path.join(dstDir, 'locations.json'));
      const images = path.join(srcDir, 'images');
      if (fs.existsSync(images)) fs.cpSync(images, path.join(dstDir, 'images'), { recursive: true });
    } else {
      const world = this.getWorld(newId); // openDb creates a fresh schema; LocationRegistry seeds "Start"
      const startId = world.locationRegistry.getStart().id;
      for (const agentId of world.agentRegistry.listAgentIds()) {
        seedInitialLocation(world.store, agentId, startId);
      }
    }

    return newId;
  }

  /**
   * Creates a world from an authored template under data/templates/<templateId>.
   * Copies the complete authored package (profiles, locations, intro, story, avatars,
   * portraits, backgrounds and scene images), excluding only runtime DB/state caches.
   * Then opens a fresh event store and seeds every agent at the template's start location.
   * Resulting world has no play history — first join will fire world intro if configured.
   */
  createFromTemplate(templateId, { name } = {}) {
    const templateDir = path.join(this.projectRoot, 'data', 'templates', templateId);
    if (!fs.existsSync(templateDir)) {
      throw new Error(`template "${templateId}" not found`);
    }

    const newId = this._uniqueWorldId(slugify(name || templateId, { fallback: 'world' }));
    const dstDir = path.join(this.worldsRoot, newId);
    // The template directory is the single authored source of truth (git-tracked under
    // data/templates). Live worlds under data/world are play instances and never read from here,
    // so deleting or playing the shipped default world can't affect what new copies contain.
    const runtimeFiles = new Set(['events.db', 'events.db-wal', 'events.db-shm', 'state.json', 'memory.md']);
    fs.cpSync(templateDir, dstDir, {
      recursive: true,
      filter: (src) => !runtimeFiles.has(path.basename(src)),
    });

    const world = this.getWorld(newId);
    const startId = world.locationRegistry.getStartId() || world.locationRegistry.getStart()?.id;
    if (startId) {
      for (const agentId of world.agentRegistry.listAgentIds()) {
        seedInitialLocation(world.store, agentId, startId);
      }
    }
    return world;
  }

  /** Scaffolds a brand-new world dir + schema + a seeded "Start" location, and returns its bundle. */
  createWorld(worldId) {
    if (this.worldExists(worldId)) throw new Error(`world "${worldId}" already exists`);
    fs.mkdirSync(path.join(this.worldsRoot, worldId, 'agents'), { recursive: true });
    const world = this.getWorld(worldId); // openDb() creates the schema idempotently
    world.locationRegistry.getStart(); // forces locations.json to materialize with its seeded "Start" entry now, not lazily on first later read
    return world;
  }

  /** Permanently removes a world directory (event log, locations, images, agent cards — everything).
   *  Closes the cached sqlite handle first so the WAL files aren't held open when the dir is removed. */
  deleteWorld(worldId) {
    if (!this.worldExists(worldId)) throw new Error(`world "${worldId}" not found`);
    const cached = this._cache.get(worldId);
    if (cached) {
      cached.db.close();
      this._cache.delete(worldId);
    }
    fs.rmSync(path.join(this.worldsRoot, worldId), { recursive: true, force: true });
  }

  closeAll() {
    for (const { db } of this._cache.values()) db.close();
    this._cache.clear();
  }
}
