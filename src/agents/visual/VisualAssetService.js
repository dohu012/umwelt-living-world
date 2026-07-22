import fs from 'node:fs';
import path from 'node:path';

import {
  backgroundFileName,
  backgroundVariantKey,
  portraitFileName,
  portraitKey,
  stableSeed,
} from './assetKeys.js';
import { ImageJobQueue } from './ImageJobQueue.js';
import { bridgeAvailable, runSceneImageBridge } from './sceneImageBridge.js';
import { VisualAssetStore } from './VisualAssetStore.js';
import { runVisualCardExtraction } from './visualCardRunner.js';

/**
 * The visual asset library: "does this character/place already have a picture, and if not, make
 * one in the background".
 *
 * This replaces the old per-round "should we draw something?" question. Trigger-based generation
 * could only fire when the player literally typed 画/draw, produced a different-looking character
 * every time, and blocked the turn while it ran. Addressing images by a content key instead means
 * a hit costs nothing, a miss happens once, and the same character keeps the same face.
 *
 * Every public method is safe to call unawaited — failures resolve to `{ok: false}` and are
 * reported through `onEvent`, never thrown into the caller's turn.
 */
export class VisualAssetService {
  /**
   * @param {{
   *   worldId: string,
   *   worldDir: string,
   *   agentRegistry: object,
   *   locationRegistry: object,
   *   onEvent?: (event: object) => void,
   *   provider?: object|null,
   *   getProvider?: (() => object|null)|null,
   * }} opts
   *
   * `provider` / `getProvider` should return the split object from
   * `sceneImageProvidersFromStore` so the Python bridge uses 模型服务, not only .env.
   */
  constructor({
    worldId,
    worldDir,
    agentRegistry,
    locationRegistry,
    onEvent = () => {},
    provider = null,
    getProvider = null,
  }) {
    this.worldId = worldId;
    this.worldDir = worldDir;
    this.agentRegistry = agentRegistry;
    this.locationRegistry = locationRegistry;
    this.onEvent = onEvent;
    this.provider = provider;
    this.getProvider = getProvider;
    this.store = new VisualAssetStore({ worldId, worldDir, agentRegistry, locationRegistry });
    this.queue = new ImageJobQueue();
  }

  _resolveProvider() {
    if (typeof this.getProvider === 'function') return this.getProvider();
    return this.provider ?? null;
  }

  /**
   * A character's standing portrait, generated from their full profile.
   *
   * `force` bypasses the cache and offsets the seed — the one path that is allowed to change an
   * established character's face, reserved for the player explicitly asking for a redraw.
   */
  ensurePortrait({ agentId, profile, utilClient, transcript = '', state = null, force = false }) {
    if (!profile) return Promise.resolve({ ok: false, reason: 'no profile' });

    const key = portraitKey(profile);
    if (!force && this.store.hasPortrait(agentId, key)) {
      // Repair the pointer if a previous run generated the file but died before writing avatar.
      if (profile.avatar !== portraitFileName(key)) this.store.commitPortrait(agentId, key);
      return Promise.resolve({
        ok: true,
        hit: true,
        agentId,
        key,
        avatar: portraitFileName(key),
        url: this.store.portraitUrl(agentId, key),
      });
    }
    if (!bridgeAvailable()) return Promise.resolve({ ok: false, reason: 'scene-image bridge missing' });

    const jobKey = `portrait:${this.worldId}:${agentId}:${key}${force ? `:${Date.now()}` : ''}`;
    return this.queue.enqueue(jobKey, async () => {
      this.onEvent({ type: 'portrait_pending', agentId });
      const { character } = await runVisualCardExtraction({
        utilClient,
        needCharacter: true,
        transcript,
        profile,
        state,
      });

      const outcome = await this._generate({
        payloadCard: { character_card: character ?? this._fallbackCharacterCard(profile) },
        outputDir: this.store.portraitDir(agentId),
        filename: portraitFileName(key),
        seed: stableSeed(agentId) + (force ? Math.floor(Math.random() * 1000) + 1 : 0),
      });

      if (!outcome.ok) {
        this.onEvent({ type: 'portrait_failed', agentId, error: outcome.error });
        return outcome;
      }

      const avatar = this.store.commitPortrait(agentId, key);
      const result = {
        ok: true,
        hit: false,
        agentId,
        key,
        avatar,
        url: this.store.portraitUrl(agentId, key),
        prompt: outcome.prompt,
      };
      this.onEvent({ type: 'portrait_ready', ...result });
      return result;
    });
  }

  /**
   * The backdrop for a location under the current conditions.
   *
   * The card has to be extracted *before* the cache is consulted: the variant key is derived from
   * time of day / weather / mood, which only the dialogue knows. That LLM call is cheap and fast
   * relative to image generation, and it is what lets the same alley at dusk and in the rain be two
   * distinct cached images rather than one that keeps getting overwritten.
   */
  ensureBackground({ locationId, locationName, utilClient, transcript = '', force = false }) {
    if (!locationId) return Promise.resolve({ ok: false, reason: 'no location' });
    if (!bridgeAvailable()) return Promise.resolve({ ok: false, reason: 'scene-image bridge missing' });

    const jobKey = `bg:${this.worldId}:${locationId}:${force ? Date.now() : transcript.length}`;
    return this.queue.enqueue(jobKey, async () => {
      const { scene } = await runVisualCardExtraction({
        utilClient,
        needScene: true,
        transcript,
        locationName,
      });
      const card = scene ?? { location: locationName || locationId, no_characters: true };
      const variantKey = backgroundVariantKey(card);

      if (!force && this.store.hasBackground(locationId, variantKey)) {
        const hit = {
          ok: true,
          hit: true,
          locationId,
          variantKey,
          url: this.store.backgroundUrl(locationId, variantKey),
        };
        // Still announce it: the player may have just walked in, and this is the room they see.
        this.onEvent({ type: 'background_ready', ...hit });
        return hit;
      }

      this.onEvent({ type: 'background_pending', locationId, variantKey });
      const outcome = await this._generate({
        payloadCard: { scene_card: card },
        outputDir: this.store.backgroundDir(locationId),
        filename: backgroundFileName(variantKey),
        seed: stableSeed(`${locationId}:${variantKey}`) + (force ? Math.floor(Math.random() * 1000) + 1 : 0),
      });

      if (!outcome.ok) {
        this.onEvent({ type: 'background_failed', locationId, error: outcome.error });
        return outcome;
      }

      this.store.commitBackground(locationId, variantKey, {
        prompt: outcome.prompt?.prompt ?? '',
        seed: outcome.seed,
      });
      const result = {
        ok: true,
        hit: false,
        locationId,
        variantKey,
        url: this.store.backgroundUrl(locationId, variantKey),
        prompt: outcome.prompt,
      };
      this.onEvent({ type: 'background_ready', ...result });
      return result;
    });
  }

  /** Minimal card from the raw profile, for when the sub-agent call failed outright. */
  _fallbackCharacterCard(profile) {
    return {
      name: profile.name ?? '',
      extra: [profile.description, profile.personality].filter(Boolean).map((s) => String(s)),
    };
  }

  async _generate({ payloadCard, outputDir, filename, seed }) {
    this.store.ensureDir(outputDir);
    const bridge = await runSceneImageBridge(
      {
        ...payloadCard,
        output_filename: filename,
        outputDir,
        seed,
      },
      { provider: this._resolveProvider() },
    );
    if (!bridge.ok) return { ok: false, error: bridge.error, stderr: bridge.stderr };

    const image = bridge.result?.images?.[0];
    if (!image?.path || !fs.existsSync(image.path)) {
      return { ok: false, error: 'bridge produced no image file' };
    }
    // Defensive: the client slugifies the requested name, so confirm we can find it where the
    // asset layer expects rather than trusting the round-trip.
    const expected = path.join(outputDir, filename);
    if (path.resolve(image.path) !== path.resolve(expected)) {
      fs.renameSync(image.path, expected);
    }
    return { ok: true, path: expected, prompt: bridge.result.prompts?.[0], seed: image.seed };
  }
}
