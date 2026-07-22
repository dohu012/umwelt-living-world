import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LocationRegistry } from '../src/settings/LocationRegistry.js';
import { slugify } from '../src/util/slugify.js';

describe('slugify', () => {
  test('lowercases, dashes, and trims', () => {
    assert.equal(slugify('Rusty Anchor Tavern'), 'rusty-anchor-tavern');
  });

  test('preserves Unicode letters such as Chinese names', () => {
    assert.equal(slugify(' 张 三 '), '张-三');
    assert.equal(slugify('爱丽丝'), '爱丽丝');
  });

  test('falls back when nothing survives', () => {
    assert.equal(slugify('!!!', { fallback: 'place' }), 'place');
  });

  test('default fallback is "item"', () => {
    assert.equal(slugify(''), 'item');
  });
});

let scratchDir;
let filePath;

beforeEach(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-location-registry-'));
  filePath = path.join(scratchDir, 'locations.json');
});

afterEach(() => {
  fs.rmSync(scratchDir, { recursive: true, force: true });
});

describe('LocationRegistry', () => {
  test('auto-seeds a "Start" entry on first load and sets it as start', () => {
    const registry = new LocationRegistry(filePath);
    const start = registry.getStart();
    assert.equal(start.name, 'Start');
    assert.equal(registry.getStartId(), start.id);
    assert.deepEqual(registry.list(), [start]);
  });

  test('create() slugifies the name and dedupes on collision', () => {
    const registry = new LocationRegistry(filePath);
    const a = registry.create({ name: 'Market' });
    const b = registry.create({ name: 'Market' });
    assert.equal(a.id, 'market');
    assert.equal(b.id, 'market-2');
  });

  test('setStart validates the id exists', () => {
    const registry = new LocationRegistry(filePath);
    assert.throws(() => registry.setStart('does-not-exist'));
  });

  test('setStart switches the start pointer', () => {
    const registry = new LocationRegistry(filePath);
    const market = registry.create({ name: 'Market' });
    registry.setStart(market.id);
    assert.equal(registry.getStartId(), market.id);
  });

  describe('ensure()', () => {
    test('returns null for empty/blank input', () => {
      const registry = new LocationRegistry(filePath);
      assert.equal(registry.ensure(''), null);
      assert.equal(registry.ensure('   '), null);
      assert.equal(registry.ensure(undefined), null);
    });

    test('reuses an existing entry when the raw text slugifies to a known id', () => {
      const registry = new LocationRegistry(filePath);
      const market = registry.create({ name: 'Market' });
      const resolved = registry.ensure('market');
      assert.equal(resolved.id, market.id);
      assert.equal(registry.list().length, 2); // Start + Market, no new entry
    });

    test('reuses an existing entry via case-insensitive name match even if the slug differs', () => {
      const registry = new LocationRegistry(filePath);
      const tavern = registry.create({ name: 'Rusty Anchor Tavern' });
      const resolved = registry.ensure('rusty anchor tavern'); // same words, different case
      assert.equal(resolved.id, tavern.id);
    });

    test('auto-registers a brand-new location when nothing matches', () => {
      const registry = new LocationRegistry(filePath);
      const resolved = registry.ensure('The Docks');
      assert.equal(resolved.name, 'The Docks');
      assert.equal(resolved.id, 'the-docks');
      assert.equal(registry.get('the-docks'), resolved);
    });

    test('documented residual-drift tradeoff: two different phrasings for "the same place" register as two entries', () => {
      const registry = new LocationRegistry(filePath);
      const a = registry.ensure('tavern');
      const b = registry.ensure('Rust Anchor Tavern bar');
      assert.notEqual(a.id, b.id);
      assert.equal(registry.list().length, 3); // Start + both distinct entries
    });
  });

  test('persists across instances via the same file', () => {
    const registry1 = new LocationRegistry(filePath);
    const market = registry1.create({ name: 'Market' });

    const registry2 = new LocationRegistry(filePath);
    assert.deepEqual(registry2.get(market.id), market);
    assert.equal(registry2.getStartId(), registry1.getStartId());
  });
});
