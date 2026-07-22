import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ImageJobQueue } from '../src/agents/visual/ImageJobQueue.js';
import { LocationRegistry } from '../src/settings/LocationRegistry.js';
import { VisualAssetService } from '../src/agents/visual/VisualAssetService.js';

const PROFILE = { name: 'Alice', description: 'long silver hair, navy coat', personality: 'wary' };

/**
 * VisualAssetService with the Python bridge stubbed out: `_generate` is the single seam between
 * the asset logic and the outside world, so counting calls to it counts image API calls.
 */
class FakeService extends VisualAssetService {
  constructor(opts) {
    super(opts);
    this.generated = [];
  }

  async _generate({ outputDir, filename, seed }) {
    this.generated.push({ filename, seed });
    fs.mkdirSync(outputDir, { recursive: true });
    const file = path.join(outputDir, filename);
    fs.writeFileSync(file, 'PNG');
    return { ok: true, path: file, prompt: { prompt: 'test prompt' }, seed };
  }
}

/** Utility LLM stand-in returning a fixed card, so tests never depend on a live provider. */
function fakeUtilClient(card) {
  return { chatCompletion: async () => JSON.stringify(card) };
}

describe('VisualAssetService', () => {
  let dir;
  let service;
  let events;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-visual-'));
    fs.mkdirSync(path.join(dir, 'agents', 'alice'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'agents', 'alice', 'profile.json'),
      JSON.stringify(PROFILE, null, 2),
    );
    events = [];
    const locationRegistry = new LocationRegistry(path.join(dir, 'locations.json'));
    locationRegistry.create({ name: 'Tavern' });
    service = new FakeService({
      worldId: 'w1',
      worldDir: dir,
      agentRegistry: { invalidate() {} },
      locationRegistry,
      onEvent: (e) => events.push(e),
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('generates a portrait once, then serves it from cache', async () => {
    const utilClient = fakeUtilClient({ character: { name: 'Alice', hair: 'long silver hair' } });

    const first = await service.ensurePortrait({ agentId: 'alice', profile: PROFILE, utilClient });
    assert.equal(first.ok, true);
    assert.equal(first.hit, false);
    assert.equal(service.generated.length, 1);

    // The profile now points at the generated file — this is what makes it show up in the UI.
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'agents', 'alice', 'profile.json'), 'utf8'));
    assert.equal(saved.avatar, first.avatar);

    const second = await service.ensurePortrait({
      agentId: 'alice',
      profile: { ...PROFILE, avatar: saved.avatar },
      utilClient,
    });
    assert.equal(second.hit, true);
    assert.equal(second.avatar, first.avatar);
    assert.equal(service.generated.length, 1, 'a cache hit must cost zero image API calls');
  });

  test('a forced redraw regenerates, and only it may change the face', async () => {
    const utilClient = fakeUtilClient({ character: { name: 'Alice' } });
    await service.ensurePortrait({ agentId: 'alice', profile: PROFILE, utilClient });
    await service.ensurePortrait({ agentId: 'alice', profile: PROFILE, utilClient, force: true });
    assert.equal(service.generated.length, 2);
    // Regeneration normally reuses the character's stable seed; a forced redraw is the one path
    // allowed to move off it, because the player explicitly asked for something different.
    assert.notEqual(service.generated[0].seed, service.generated[1].seed);
  });

  test('falls back to the raw profile when the sub-agent fails', async () => {
    const brokenClient = { chatCompletion: async () => { throw new Error('provider down'); } };
    const result = await service.ensurePortrait({
      agentId: 'alice',
      profile: PROFILE,
      utilClient: brokenClient,
    });
    // A flaky utility provider degrades the prompt, it does not block the picture.
    assert.equal(result.ok, true);
    assert.equal(service.generated.length, 1);
  });

  test('backgrounds are cached per time/weather variant', async () => {
    const dusk = fakeUtilClient({ scene: { location: 'tavern', time_of_day: 'sunset' } });
    const duskAgain = fakeUtilClient({ scene: { location: 'tavern', time_of_day: 'golden hour' } });
    const night = fakeUtilClient({ scene: { location: 'tavern', time_of_day: 'night' } });

    const a = await service.ensureBackground({ locationId: 'tavern', utilClient: dusk, transcript: '1' });
    assert.equal(a.hit, false);
    assert.equal(service.generated.length, 1);

    // "golden hour" is the same moment as "sunset" — it must reuse the image, not make a new one.
    const b = await service.ensureBackground({ locationId: 'tavern', utilClient: duskAgain, transcript: '2' });
    assert.equal(b.hit, true);
    assert.equal(b.variantKey, a.variantKey);
    assert.equal(service.generated.length, 1);

    // Nightfall is a genuinely different room.
    const c = await service.ensureBackground({ locationId: 'tavern', utilClient: night, transcript: '3' });
    assert.equal(c.hit, false);
    assert.notEqual(c.variantKey, a.variantKey);
    assert.equal(service.generated.length, 2);
  });

  test('records the background in the location registry', async () => {
    const utilClient = fakeUtilClient({ scene: { location: 'tavern', weather: 'rain' } });
    const result = await service.ensureBackground({ locationId: 'tavern', utilClient });
    const entry = service.locationRegistry.getBackground('tavern');
    assert.equal(entry.file, `bg-${result.variantKey}.png`);
    assert.ok(entry.createdAt);
    assert.ok(fs.existsSync(path.join(dir, 'locations', 'tavern', entry.file)));
  });

  test('announces every ready background, including cache hits', async () => {
    const utilClient = fakeUtilClient({ scene: { location: 'tavern' } });
    await service.ensureBackground({ locationId: 'tavern', utilClient, transcript: '1' });
    await service.ensureBackground({ locationId: 'tavern', utilClient, transcript: '22' });
    // A player who just walked in needs the frame even when nothing was generated for them.
    assert.equal(events.filter((e) => e.type === 'background_ready').length, 2);
  });
});

describe('ImageJobQueue', () => {
  test('runs one job per key even when callers race', async () => {
    const queue = new ImageJobQueue();
    let runs = 0;
    const job = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 10));
      return runs;
    };

    const [a, b] = await Promise.all([queue.enqueue('k', job), queue.enqueue('k', job)]);
    assert.equal(runs, 1, 'two rooms wanting the same asset must share one generation');
    assert.equal(a, b);
  });

  test('a failed job clears its key so a retry can run', async () => {
    const queue = new ImageJobQueue();
    await assert.rejects(queue.enqueue('k', async () => { throw new Error('boom'); }));
    assert.equal(queue.isPending('k'), false);
    assert.equal(await queue.enqueue('k', async () => 'recovered'), 'recovered');
  });

  test('runs jobs serially so concurrent scenes do not flood the image API', async () => {
    const queue = new ImageJobQueue();
    let active = 0;
    let maxActive = 0;
    const job = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    };

    await Promise.all(['a', 'b', 'c'].map((k) => queue.enqueue(k, job)));
    assert.equal(maxActive, 1);
  });
});
