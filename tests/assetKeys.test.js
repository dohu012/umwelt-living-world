import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  backgroundVariantKey,
  portraitKey,
  stableSeed,
} from '../src/agents/visual/assetKeys.js';

describe('portraitKey', () => {
  const base = { name: 'Alice', description: 'silver hair', personality: 'wary', tags: ['npc'] };

  test('is stable across calls and tag order', () => {
    assert.equal(portraitKey(base), portraitKey({ ...base }));
    assert.equal(portraitKey(base), portraitKey({ ...base, tags: ['npc'] }));
  });

  test('changes when appearance-bearing fields change', () => {
    assert.notEqual(portraitKey(base), portraitKey({ ...base, description: 'black hair' }));
    assert.notEqual(portraitKey(base), portraitKey({ ...base, name: 'Beth' }));
  });

  test('ignores fields that cannot affect how the character looks', () => {
    // Editing dialogue examples must not cost an API call, and must not hand the player a
    // different face for the same character.
    assert.equal(
      portraitKey(base),
      portraitKey({ ...base, first_mes: 'hello there', system_prompt: 'be terse', avatar: 'x.png' }),
    );
  });
});

describe('backgroundVariantKey', () => {
  test('collapses synonyms onto one cached image', () => {
    const dusk = backgroundVariantKey({ time_of_day: 'sunset' });
    assert.equal(backgroundVariantKey({ time_of_day: 'golden hour' }), dusk);
    assert.equal(backgroundVariantKey({ time_of_day: 'dusk' }), dusk);
    assert.equal(backgroundVariantKey({ time_of_day: '黄昏' }), dusk);
  });

  test('separates genuinely different conditions', () => {
    const rainyNight = backgroundVariantKey({ time_of_day: 'night', weather: 'heavy rain' });
    const clearNight = backgroundVariantKey({ time_of_day: 'night', weather: 'clear sky' });
    assert.notEqual(rainyNight, clearNight);
  });

  test('an empty card is the default variant', () => {
    assert.equal(backgroundVariantKey({}), 'default');
    assert.equal(backgroundVariantKey({ location: 'tavern' }), 'default');
  });

  test('unrecognised conditions still get their own bounded key', () => {
    const key = backgroundVariantKey({ weather: 'a rain of frogs descending upon the city' });
    assert.notEqual(key, 'default');
    // Bounded: an arbitrarily florid description must not become an arbitrarily long filename.
    assert.ok(key.length < 40, key);
  });
});

describe('stableSeed', () => {
  test('is deterministic per id and within StepFun range', () => {
    assert.equal(stableSeed('alice'), stableSeed('alice'));
    assert.notEqual(stableSeed('alice'), stableSeed('bob'));
    for (const id of ['alice', 'bob', '林晚', 'start:dusk-rain-calm']) {
      const seed = stableSeed(id);
      assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2_000_000_000, `${id} → ${seed}`);
    }
  });
});
