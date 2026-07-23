import fs from 'node:fs';
import path from 'node:path';
import { TurnRunner } from '../orchestrator/TurnRunner.js';
import { appendPlayerMessage, resolveResponders } from '../orchestrator/InteractivePlay.js';
import { setSubjectLocation } from '../agents/seedLocation.js';
import { createLLMClient } from '../llm/LLMClient.js';
import * as Policy from '../visibility/Policy.js';
import * as ContextAssembler from '../visibility/ContextAssembler.js';
import { runStateExtraction, applyStateExtraction } from '../agents/state/stateExtractionRunner.js';
import { runSceneLocationResolve } from '../agents/scene/locationResolveRunner.js';
import {
  runIntentDispatch,
  runSceneImagePipeline,
  buildSceneImageInput,
  buildLocationChangeImageInput,
  findLatestImagePath,
  readAgentStatus,
} from '../skills/hooks.js';
import { runNarratorTurn } from '../agents/NarratorRunner.js';
import { sceneImageProvidersFromStore } from '../skills/sceneImageEnv.js';

const PRELOADED_BACKGROUND_EXTS = ['.png', '.webp', '.jpg', '.jpeg'];

/** Static default backdrop written by preload_world_assets (or authored into the world package). */
function findPreloadedLocationBackground(worldDir, locationId) {
  const dir = path.join(worldDir, 'locations', locationId);
  for (const ext of PRELOADED_BACKGROUND_EXTS) {
    const fileName = `background${ext}`;
    const absPath = path.join(dir, fileName);
    if (fs.existsSync(absPath)) return { absPath, fileName };
  }
  return null;
}
/** Minimal, non-roleplay profile so the player's own persona can run through the same
 * state-extraction machinery as an NPC — local:{state.location} must be explicit here since
 * Policy's DEFAULT_POLICY fallback omits it, which would starve this call of scene context. */
function syntheticPersonaProfile(persona) {
  return {
    name: persona?.name ?? 'Player',
    extensions: {
      visibility: { allow: ['global', 'private:{self}', 'local:{state.location}'], deny: ['private:*'] },
    },
  };
}

/**
 * Owns WS room membership (one room = one worldId+location) and a per-world serial turn queue.
 *
 * EventStore.append() allocates seq atomically now (an in-transaction counter row), so two
 * interleaved runTurn calls can no longer corrupt seq ordering by racing. The queue still exists
 * as a correctness requirement for a different reason: each runTurn call computes its visible
 * context (ContextAssembler) *before* awaiting the LLM, so two turns for the same world running
 * fully concurrently could each build their prompt from a stale, pre-the-other-turn's-writes view
 * of the event log — this queue keeps turns from overlapping so each one sees everything the
 * previous one wrote. Utility-call concurrency (see TurnRunner's utilityLlmClient) is deliberately
 * exempt from this queue; it's safe precisely because seq allocation is now atomic.
 */
export class RoomManager {
  constructor({ worldRegistry, providerSettingsStore, personaStore, summarizeEveryNTurns = 0 }) {
    this.worldRegistry = worldRegistry;
    this.providerSettingsStore = providerSettingsStore;
    this.personaStore = personaStore;
    this.summarizeEveryNTurns = summarizeEveryNTurns;
    this._rooms = new Map(); // `${worldId}:${location}` -> Set<ws>
    this._queues = new Map(); // worldId -> Promise chain
    this._turnRunners = new Map(); // worldId -> TurnRunner
  }

  _roomKey(worldId, location) {
    return `${worldId}:${location}`;
  }

  /** id → display name across both players (personas) and NPCs (agent profiles); falls back to the id. */
  _makeResolveName(agentRegistry) {
    return (id) => {
      if (id === 'narrator') return '旁白';
      if (id === 'world-will' || id === 'world-will-agent') return '世界意志';
      const persona = this.personaStore.get(id);
      if (persona) return persona.name;
      try {
        return agentRegistry.loadProfile(id)?.name ?? id;
      } catch {
        return id;
      }
    };
  }

  join(ws, { worldId, location, personaId }) {
    const key = this._roomKey(worldId, location);
    if (!this._rooms.has(key)) this._rooms.set(key, new Set());
    this._rooms.get(key).add(ws);
    ws.umweltRoom = { worldId, location, personaId };
  }

  leave(ws, { recordDeparture = true } = {}) {
    if (!ws.umweltRoom) return;
    const { worldId, location, personaId } = ws.umweltRoom;
    this._rooms.get(this._roomKey(worldId, location))?.delete(ws);
    if (recordDeparture && personaId && this.worldRegistry.worldExists(worldId)) {
      const { db, clock } = this.worldRegistry.getWorld(worldId);
      const seq = db.prepare('SELECT COALESCE(MAX(seq), 0) FROM events').pluck().get();
      const value = JSON.stringify({ seq, worldTime: clock.getState().worldTime });
      const updatedAt = new Date().toISOString();
      db.prepare(`
        INSERT INTO simulation_state (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(`persona.last_departure:${personaId}`, value, updatedAt);
    }
    ws.umweltRoom = null;
  }

  /** Moves an already-joined socket to a different room within the same world (e.g. the player's own location changed mid-session). */
  moveSocket(ws, newLocation) {
    const { worldId, personaId } = ws.umweltRoom;
    this.leave(ws, { recordDeparture: false });
    this.join(ws, { worldId, location: newLocation, personaId });
  }

  _broadcast(worldId, location, message) {
    const sockets = this._rooms.get(this._roomKey(worldId, location));
    if (!sockets) return;
    const json = JSON.stringify(message);
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(json);
    }
  }

  _send(ws, message) {
    if (ws?.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  /**
   * Persist generated images and stamp mediaUrl. Tags use the location the image belongs to
   * (destination room for location-change draws), plus a private:<id> per witness — same
   * "在场即留痕" pattern as dialogue/narration events — so an image stays in each witness's own
   * cross-location history/timeline instead of only being visible live over the WS broadcast and
   * disappearing the moment the page is refreshed (the timeline endpoint queries by
   * private:<personaId>, which images never matched before this).
   */
  _persistSceneImages({ worldId, store, locationId, images, subjectId = null, witnessIds = [] }) {
    for (const img of images ?? []) {
      const mediaUrl = img.fileName ? `/media/${worldId}/images/${img.fileName}` : null;
      store.append(
        {
          type: 'image',
          actor: 'system',
          subject: subjectId,
          content: img.image_type,
          data: {
            path: img.path,
            url: img.url,
            mediaUrl,
            prompt: img.prompt,
            seed: img.seed,
            reason: img.reason ?? null,
          },
        },
        [`local:${locationId}`, 'global', ...witnessIds.map((id) => `private:${id}`)],
      );
      img.mediaUrl = mediaUrl;
    }
  }

  /**
   * On player arrival at a new location: generate an environment shot into images/, then notify
   * the destination room (and optionally the moving socket before it reconnects).
   *
   * If the location already has a preloaded `locations/<id>/background.*`, skip the API call —
   * the frontend already probes that file as the default backdrop. Forcing a redraw here was
   * why switching rooms / re-entering a world kept burning image quota on assets that already
   * shipped with the world.
   */
  async _generateEnvironmentForLocation({
    ws = null,
    worldId,
    locationId,
    personaId,
    fromLocationId = null,
    broadcastLocation = null,
  }) {
    const { store, locationRegistry, worldDir } = this.worldRegistry.getWorld(worldId);
    const locationName = locationRegistry.get(locationId)?.name ?? locationId;
    const preloaded = findPreloadedLocationBackground(worldDir, locationId);
    if (preloaded) {
      const mediaUrl = `/media/${worldId}/locations/${encodeURIComponent(locationId)}/${preloaded.fileName}`;
      const payload = {
        type: 'scene_image',
        reason: 'location_change',
        location: locationId,
        locationName,
        skipped: true,
        skipReason: 'preloaded_background',
        images: [
          {
            image_type: 'environment',
            path: preloaded.absPath,
            fileName: null,
            mediaUrl,
            reason: 'location_change',
          },
        ],
      };
      this._broadcast(worldId, locationId, payload);
      this._send(ws, payload);
      return payload;
    }

    const imagesDir = path.join(worldDir, 'images');
    const imageInput = buildLocationChangeImageInput({
      location: locationId,
      locationName,
      personaId,
      fromLocationId,
    });

    const pending = {
      type: 'scene_image_pending',
      requestImage: true,
      requestEdit: false,
      reason: 'location_change',
      location: locationId,
      locationName,
    };
    if (broadcastLocation) this._broadcast(worldId, broadcastLocation, pending);
    this._send(ws, pending);

    const imageResult = await runSceneImagePipeline(imageInput, {
      outputDir: imagesDir,
      force: true,
      provider: sceneImageProvidersFromStore(this.providerSettingsStore),
    });

    if (!imageResult.skipped && imageResult.images?.length) {
      for (const img of imageResult.images) img.reason = 'location_change';
      const { agentRegistry } = this.worldRegistry.getWorld(worldId);
      const witnessesAtDestination = agentRegistry
        .listAgentIds()
        .filter((id) => store.getFact(id, 'location')?.content === locationId);
      this._persistSceneImages({
        worldId,
        store,
        locationId,
        images: imageResult.images,
        subjectId: personaId,
        witnessIds: [personaId, ...witnessesAtDestination],
      });
    }

    const payload = {
      type: 'scene_image',
      reason: 'location_change',
      location: locationId,
      locationName,
      ...imageResult,
    };
    this._broadcast(worldId, locationId, payload);
    this._send(ws, payload);
    return imageResult;
  }

  /**
   * UI teleport / bookmark join: if the persona actually changed rooms, enqueue an environment
   * draw for the destination. Non-blocking for the join ack.
   */
  scheduleEnvironmentOnArrival({ ws, worldId, locationId, personaId, fromLocationId }) {
    if (!locationId || fromLocationId === locationId) return Promise.resolve(null);
    return this._enqueue(worldId, () =>
      this._generateEnvironmentForLocation({
        ws,
        worldId,
        locationId,
        personaId,
        fromLocationId,
        broadcastLocation: locationId,
      }),
    );
  }

  _getTurnRunner(worldId) {
    if (this._turnRunners.has(worldId)) return this._turnRunners.get(worldId);
    const { store, agentRegistry, worldDir, locationRegistry } = this.worldRegistry.getWorld(worldId);
    const turnRunner = new TurnRunner({
      store,
      llmClient: null, // always overridden per-call with the currently active provider
      agentRegistry,
      worldDir,
      locationRegistry,
      summarizeEveryNTurns: this.summarizeEveryNTurns,
      // The holistic scene-location skill (see _resolveSceneLocations) is the sole authority over
      // location on the interactive path, so per-turn extraction must not also write it.
      applyTurnLocation: false,
    });
    this._turnRunners.set(worldId, turnRunner);
    return turnRunner;
  }

  /** Chains jobs for the same world so turns never interleave; a failed job doesn't wedge the queue. */
  _enqueue(worldId, job) {
    const prev = this._queues.get(worldId) ?? Promise.resolve();
    const settled = prev.catch(() => {});
    const next = settled.then(job);
    this._queues.set(worldId, next.catch(() => {}));
    return next;
  }

  /** Shares the interactive turn lock with background simulation for this world. */
  runExclusive(worldId, job) {
    return this._enqueue(worldId, job);
  }

  /**
   * `location`/`personaId` are deliberately re-read from `ws.umweltRoom` *inside* the queued job,
   * not captured from the caller up front: `scene_done` broadcasts before this same message's own
   * trailing `_runPlayerStateExtraction` (which may moveSocket() this ws to a new room) has even
   * run, so a fast follow-up message queued right behind it would otherwise capture the pre-move
   * location and get tagged/scoped to a room the player has already left.
   */
  handlePlayerMessage({ ws, content }) {
    const { worldId } = ws.umweltRoom;
    return this._enqueue(worldId, () => {
      const { location, personaId } = ws.umweltRoom;
      return this._runScene({ ws, worldId, location, personaId, content });
    });
  }

  /**
   * The player's own state-extraction pass (mood/action/relationships, from the player's own
   * visibility-filtered point of view) — the same mechanism an NPC's turn uses, just with
   * subjectId = personaId and a synthetic profile. Location is deliberately NOT applied here
   * (applyLocation:false): the holistic scene-location skill owns every participant's location,
   * so this call reasons purely about the player's inner state from the pre-move room's context.
   */
  async _runPlayerStateExtraction({ store, locationRegistry, personaId, content, utilityLlmClient, resolveName }) {
    const profile = syntheticPersonaProfile(this.personaStore.get(personaId));
    const policy = Policy.resolve(personaId, profile, store);
    const context = ContextAssembler.assemble({ agentId: personaId, profile, store, policy, limit: 30 });

    const stateResult = await runStateExtraction({
      utilClient: utilityLlmClient,
      profile,
      subjectId: personaId,
      recentEvents: context.visibleEvents,
      dialogueText: content,
      locationRegistry,
      resolveName,
      stateSnapshot: context.stateSnapshot,
    });

    store.db.transaction(() => {
      applyStateExtraction({ store, subjectId: personaId, stateResult, locationRegistry, applyLocation: false });
    })();
  }

  /**
   * ★ Holistic scene-location skill — the single authority over where the cast ends up after a
   * round. One utility call sees the whole scene (player line + every NPC reply) plus current
   * positions and resolves each participant's next location, all through the same canonical
   * registry, so a party leaving together lands in ONE room. Pure read + LLM call: it never writes
   * to the store (the caller applies the moves), so it can run concurrently with the player's own
   * state extraction. Returns the resolved movers `[{ id, locationId, locationText }]`.
   */
  _resolveSceneMoves({ store, agentRegistry, locationRegistry, personaId, location, content, agentTurns, presentIds, utilityLlmClient }) {
    const persona = this.personaStore.get(personaId);
    const personaName = persona?.name ?? 'Player';
    const nameById = new Map(presentIds.map((id) => [id, agentRegistry.loadProfile(id)?.name ?? id]));

    const participants = [
      { id: personaId, name: personaName, location: store.getFact(personaId, 'location')?.content ?? location },
      ...presentIds.map((id) => ({ id, name: nameById.get(id), location: store.getFact(id, 'location')?.content ?? location })),
    ];

    const transcript = [
      `[${personaName}]: ${content}`,
      ...agentTurns
        .filter((t) => t.dialogueText)
        .map((t) => `[${nameById.get(t.agentId) ?? t.agentId}]: ${t.dialogueText}`),
    ].join('\n');

    return runSceneLocationResolve({ utilClient: utilityLlmClient, participants, transcript, locationRegistry, playerId: personaId });
  }

  _movePlayerSocket(ws, locationRegistry, newLocationId) {
    if (!ws) return;
    this.moveSocket(ws, newLocationId);
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'location_changed',
          location: newLocationId,
          locationName: locationRegistry.get(newLocationId)?.name,
        }),
      );
    }
  }

  /**
   * Shared scene tail. The player's own state extraction (mood/action/relationships, read from the
   * pre-move room) and the holistic location resolution are independent LLM calls over the same
   * already-committed transcript — neither writes what the other reads — so they run concurrently
   * rather than back-to-back, halving the wait before the scene settles. Location writes are then
   * applied together: NPC moves before scene_done (so the room's panel reflects who left), the
   * player's move last (socket move + navigation) so their socket only leaves after this round's
   * replies were broadcast to the old room.
   */
  async _concludeScene({ ws, worldId, store, agentRegistry, locationRegistry, personaId, location, content, agentTurns, presentIds, utilityLlmClient, sceneDoneReason }) {
    const resolveName = this._makeResolveName(agentRegistry);
    const [, moves] = await Promise.all([
      this._runPlayerStateExtraction({ store, locationRegistry, personaId, content, utilityLlmClient, resolveName }),
      this._resolveSceneMoves({ store, agentRegistry, locationRegistry, personaId, location, content, agentTurns, presentIds, utilityLlmClient }),
    ]);

    let playerMove = null;
    for (const move of moves) {
      if (move.id === personaId) {
        playerMove = move.locationId; // applied last, after scene_done
        continue;
      }
      setSubjectLocation({ store, subjectId: move.id, locationId: move.locationId });
    }

    // ★ 换地点现生成：为目的地生成环境图，写入 local:<newLocation>。Deliberately NOT awaited —
    // scene_done (and the player's ability to send their next message) doesn't need to wait on an
    // image generation round-trip; the existing scene_image_pending/scene_image broadcast pair
    // already delivers it live to whoever's in the new room once it's ready, same as any other
    // image generation in this file.
    if (playerMove && playerMove !== location) {
      this._generateEnvironmentForLocation({
        ws,
        worldId,
        locationId: playerMove,
        personaId,
        fromLocationId: location,
        broadcastLocation: location,
      }).catch((err) => {
        console.error(`[RoomManager] location-change environment generation failed for ${playerMove}:`, err);
      });
    }

    this._broadcast(worldId, location, sceneDoneReason ? { type: 'scene_done', reason: sceneDoneReason } : { type: 'scene_done' });

    if (playerMove) {
      setSubjectLocation({ store, subjectId: personaId, locationId: playerMove });
      this._movePlayerSocket(ws, locationRegistry, playerMove);
    }
  }

  async _runScene({ ws, worldId, location, personaId, content }) {
    const { store, agentRegistry, locationRegistry, worldDir } = this.worldRegistry.getWorld(worldId);

    // Who could perceive the message (pre-move room). Computed before appending the player's own
    // message so that message can be tagged with witnessIds below — fixed for the rest of this
    // round, since moves only ever apply at the very end (_concludeScene).
    const presentIds = resolveResponders({ store, agentIds: agentRegistry.listAgentIds(), location });
    // Everyone who actually witnessed this round's events — every private:<id> tag added below (to
    // the player's message, each agent's reply, and any narration) comes from this list, so each
    // witness keeps this round in their own memory forever, regardless of where they move to next
    // (see promptBuilder.js's scene-change markers for how an agent's own transcript then disambiguates
    // "this happened here" from "this happened somewhere I've since left").
    const witnessIds = [personaId, ...presentIds];

    // Tagged with the room the player was in when they said this — NPCs there should still react
    // to it even if the player's own state extraction (below) concludes they just left.
    const playerEvent = appendPlayerMessage({ store, personaId, location, content, witnessIds: presentIds });
    this._broadcast(worldId, location, { type: 'player_message_ack', event: playerEvent });

    const activeProvider = this.providerSettingsStore.getActiveForKind?.('dialogue')
      ?? this.providerSettingsStore.getActive();
    if (!activeProvider) {
      this._broadcast(worldId, location, { type: 'error', message: 'no active LLM provider configured' });
      return;
    }
    const llmClient = createLLMClient({ nim: activeProvider });

    // Falls back to the dialogue provider when no utility-kind provider is configured.
    const utilityProvider =
      this.providerSettingsStore.getActiveForKind?.('utility')
      ?? this.providerSettingsStore.getActiveForRole?.('utility')
      ?? activeProvider;
    const utilityLlmClient = createLLMClient({ nim: utilityProvider });

    // Persona+agent aware id→name so no prompt ever shows the model a raw id to echo back.
    const resolveName = this._makeResolveName(agentRegistry);

    const candidates = presentIds.map((id) => {
      const profile = agentRegistry.loadProfile(id);
      return { id, name: profile?.name ?? id, state: readAgentStatus(store, id) };
    });
    const dispatch = await runIntentDispatch({
      store,
      agentIds: agentRegistry.listAgentIds(),
      location,
      personaId,
      playerMessage: content,
      candidates,
    });
    this._broadcast(worldId, location, {
      type: 'intent_dispatch',
      intent: dispatch.intent,
      responderIds: dispatch.responderIds,
      flags: dispatch.flags,
      notes: dispatch.notes,
    });

    if (dispatch.flags?.endScene) {
      await this._concludeScene({
        ws,
        worldId,
        store,
        agentRegistry,
        locationRegistry,
        personaId,
        location,
        content,
        agentTurns: [],
        presentIds,
        utilityLlmClient,
        sceneDoneReason: 'endScene',
      });
      return;
    }

    const responders = dispatch.responderIds ?? presentIds;
    const turnRunner = this._getTurnRunner(worldId);
    const agentTurns = [];

    // Everyone actually present, by display name — the "who's in this scene" roster each agent's
    // prompt is framed against (see promptBuilder.js's groupSceneInstruction), so no agent mistakes
    // the last speaker for its sole conversational partner. Built once from presentIds (the full
    // room), not just this round's responders, since a present-but-not-speaking character is still
    // someone the scene should be framed around.
    const personaName = resolveName(personaId);
    const presentNamesById = new Map(presentIds.map((id) => [id, resolveName(id)]));

    for (const agentId of responders) {
      this._broadcast(worldId, location, { type: 'agent_typing', agentId });
      const roster = [personaName, ...[...presentNamesById].filter(([id]) => id !== agentId).map(([, name]) => name)];
      try {
        const result = await turnRunner.runTurn(agentId, {
          llmClient,
          utilityLlmClient,
          resolveName,
          roster,
          witnessIds,
          onToken: (delta) => this._broadcast(worldId, location, { type: 'agent_token', agentId, delta }),
        });
        if (result.silent) {
          this._broadcast(worldId, location, { type: 'agent_silent', agentId });
          continue;
        }
        agentTurns.push({ agentId, dialogueText: result.dialogueText, updates: result.updates });
        this._broadcast(worldId, location, {
          type: 'agent_message',
          agentId,
          dialogueText: result.dialogueText,
          updates: result.updates,
          parseError: result.parseError,
          state: readAgentStatus(store, agentId),
        });
      } catch (err) {
        this._broadcast(worldId, location, { type: 'agent_turn_error', agentId, error: err.message });
      }
    }

    // No one actually spoke this round (no NPC was present, or everyone present chose to stay
    // silent) — and the player didn't explicitly ask to go unanswered (`endScene`, e.g. "别说话/只
    // 观察"). Fall back to a stateless third-person narrator so the player's line/action still gets
    // *some* reaction instead of the scene going dead. See NarratorRunner.js.
    if (agentTurns.length === 0 && !dispatch.flags?.endScene) {
      try {
        const narration = await runNarratorTurn({ store, locationRegistry, location, utilityLlmClient, resolveName, witnessIds });
        if (narration) {
          this._broadcast(worldId, location, { type: 'narration_message', text: narration.content });
        }
      } catch {
        // Narration is a nice-to-have, never worth failing the scene over.
      }
    }

    // ★ Hook C–F — scene-image (after NPC turns, before player relocation)
    const imagesDir = path.join(worldDir, 'images');
    const locationName = locationRegistry.get(location)?.name ?? location;
    const imageAgents = (responders.length ? responders : presentIds).map((id) => {
      const profile = agentRegistry.loadProfile(id);
      return {
        id,
        name: profile?.name ?? id,
        state: readAgentStatus(store, id),
        profileHints: {
          description: profile?.description ?? '',
          personality: profile?.personality ?? '',
        },
      };
    });
    const requestEdit = Boolean(dispatch.flags?.requestEdit);
    const preferAgentPortrait = /立绘|portrait/i.test(content);
    const sourceImage = requestEdit
      ? findLatestImagePath(store, {
          subjectId: responders[0] ?? null,
          worldDir,
          preferAgentPortrait,
        })
      : null;
    const imageInput = buildSceneImageInput({
      location,
      locationName,
      personaId,
      playerMessage: content,
      agentTurns,
      requestImage: Boolean(dispatch.flags?.requestImage),
      requestEdit,
      sourceImage,
      agents: imageAgents,
    });
    this._broadcast(worldId, location, {
      type: 'scene_image_pending',
      requestImage: imageInput.requestImage,
      requestEdit: imageInput.requestEdit,
    });

    // The scene-image call and _concludeScene (location resolve + player state extraction) don't
    // read each other's output — nothing genuinely requires one to finish before the other starts
    // (see the plan doc's Tier-1 finding) — so run them concurrently instead of back-to-back.
    // Resolve everyone's location, announce scene_done, extract the player's own state, then move
    // the player last — deliberately: if the player is leaving, they still get to see whatever the
    // old room's NPCs just said back (broadcast to the old room above) before their socket moves to
    // the new one. Moving first would silently cut them out of that reply.
    const [imageResult] = await Promise.all([
      runSceneImagePipeline(imageInput, {
        outputDir: imagesDir,
        provider: sceneImageProvidersFromStore(this.providerSettingsStore),
      }),
      this._concludeScene({
        ws,
        worldId,
        store,
        agentRegistry,
        locationRegistry,
        personaId,
        location,
        content,
        agentTurns,
        presentIds,
        utilityLlmClient,
      }),
    ]);

    if (!imageResult.skipped && imageResult.images?.length) {
      this._persistSceneImages({
        worldId,
        store,
        locationId: location,
        images: imageResult.images,
        subjectId: responders[0] ?? null,
        witnessIds,
      });
    }
    // Broadcast to the room AND send directly to this socket: _concludeScene may have already
    // moved the player's socket out of `location`'s room set by the time this resolves, since it
    // now runs concurrently with the image call above rather than strictly after it.
    this._broadcast(worldId, location, { type: 'scene_image', ...imageResult });
    this._send(ws, { type: 'scene_image', ...imageResult });
  }
}
