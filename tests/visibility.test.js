import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import { matchTag, specificity, mostSpecificMatch, isVisible, interpolateTag } from '../src/visibility/tags.js';

describe('tags: matchTag / specificity', () => {
  test('exact match', () => {
    assert.equal(matchTag('global', 'global'), true);
    assert.equal(matchTag('global', 'globalx'), false);
  });

  test('prefix glob match requires content after prefix', () => {
    assert.equal(matchTag('private:alice', 'private:*'), true);
    assert.equal(matchTag('private:', 'private:*'), false);
  });

  test('specificity: exact beats glob, longer glob beats shorter', () => {
    assert.equal(specificity('private:alice'), Infinity);
    assert.ok(specificity('private:*') > specificity('*'));
    assert.ok(specificity('local:tavern:*') > specificity('local:*'));
  });
});

describe('tags: isVisible', () => {
  test('deny overrides a broader allow (private:* denies private:bob even though private:{self}=alice allows nothing here)', () => {
    const policy = { allow: ['global', 'private:alice'], deny: ['private:*'] };
    assert.equal(isVisible('private:alice', policy), true, 'more specific allow punches through deny');
    assert.equal(isVisible('private:bob', policy), false, 'broad deny blocks anything not specifically allowed');
  });

  test('symmetric case: specific deny overrides a broader allow', () => {
    const policy = { allow: ['local:*'], deny: ['local:secret_room'] };
    assert.equal(isVisible('local:tavern', policy), true);
    assert.equal(isVisible('local:secret_room', policy), false);
  });

  test('no matching allow pattern -> not visible', () => {
    const policy = { allow: ['global'], deny: [] };
    assert.equal(isVisible('private:alice', policy), false);
  });

  test('equal specificity tie favors deny (fail-closed)', () => {
    const policy = { allow: ['private:alice'], deny: ['private:alice'] };
    assert.equal(isVisible('private:alice', policy), false);
  });
});

describe('tags: interpolateTag', () => {
  test('resolves {self} and {state.X}', () => {
    const ctx = { self: 'alice', state: { location: 'tavern' } };
    assert.equal(interpolateTag('private:{self}', ctx), 'private:alice');
    assert.equal(interpolateTag('local:{state.location}', ctx), 'local:tavern');
  });

  test('unresolved placeholder returns null, not a partial string', () => {
    const ctx = { self: 'alice', state: {} };
    assert.equal(interpolateTag('local:{state.location}', ctx), null);
  });

  test('mostSpecificMatch picks the exact match over a glob', () => {
    assert.equal(mostSpecificMatch('private:alice', ['private:*', 'private:alice']), 'private:alice');
  });
});

describe('EventStore.queryVisible: information-asymmetry guarantee', () => {
  function seedWorld() {
    const db = openDb(':memory:');
    const store = new EventStore(db);

    const aliceDialogue = store.append(
      { type: 'dialogue', actor: 'alice', subject: 'alice', content: 'Alice says hi.' },
      ['local:tavern', 'private:alice'],
    );
    const aliceFact = store.append(
      { type: 'fact', actor: 'alice', subject: 'alice', key: 'mood', content: 'wary' },
      ['private:alice'],
    );
    const bobDialogue = store.append(
      { type: 'dialogue', actor: 'bob', subject: 'bob', content: 'Bob says hi back.' },
      ['local:tavern', 'private:bob'],
    );
    const bobFact = store.append(
      { type: 'fact', actor: 'bob', subject: 'bob', key: 'mood', content: 'tired' },
      ['private:bob'],
    );
    const systemEvent = store.append(
      { type: 'system', actor: 'system', content: 'The tavern door creaks.' },
      ['global'],
    );

    return { db, store, ids: { aliceDialogue, aliceFact, bobDialogue, bobFact, systemEvent } };
  }

  const alicePolicy = { allow: ['global', 'private:alice', 'local:tavern'], deny: ['private:*'] };
  const bobPolicy = { allow: ['global', 'private:bob', 'local:tavern'], deny: ['private:*'] };

  test('alice sees global/local/her own private, never bob-only private', () => {
    const { store, ids } = seedWorld();
    const visible = store.queryVisible(alicePolicy);
    const visibleIds = new Set(visible.map((e) => e.id));

    assert.ok(visibleIds.has(ids.aliceDialogue.id));
    assert.ok(visibleIds.has(ids.aliceFact.id));
    assert.ok(visibleIds.has(ids.bobDialogue.id), 'shared local:tavern dialogue is mutually visible');
    assert.ok(visibleIds.has(ids.systemEvent.id));
    assert.ok(!visibleIds.has(ids.bobFact.id), "bob's private-only fact must never be visible to alice");
  });

  test('symmetric: bob never sees alice-only private facts', () => {
    const { store, ids } = seedWorld();
    const visible = store.queryVisible(bobPolicy);
    const visibleIds = new Set(visible.map((e) => e.id));

    assert.ok(visibleIds.has(ids.bobDialogue.id));
    assert.ok(visibleIds.has(ids.bobFact.id));
    assert.ok(visibleIds.has(ids.aliceDialogue.id), 'shared local:tavern dialogue is mutually visible');
    assert.ok(!visibleIds.has(ids.aliceFact.id), "alice's private-only fact must never be visible to bob");
  });

  test('limit takes the trailing N after filtering, not before', () => {
    const { store } = seedWorld();
    const visible = store.queryVisible(alicePolicy, { limit: 2 });
    assert.equal(visible.length, 2);
    // chronological order preserved
    assert.ok(visible[0].seq <= visible[1].seq);
  });

  test('empty allow set returns nothing', () => {
    const { store } = seedWorld();
    assert.deepEqual(store.queryVisible({ allow: [], deny: [] }), []);
  });
});
