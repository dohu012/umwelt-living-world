import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import { appendPlayerMessage, resolveResponders } from '../src/orchestrator/InteractivePlay.js';

function makeStore() {
  return new EventStore(openDb(':memory:'));
}

describe('InteractivePlay.appendPlayerMessage', () => {
  test('tags the message local:<location> + private:<personaId>, like agent dialogue', () => {
    const store = makeStore();
    const event = appendPlayerMessage({ store, personaId: 'player1', location: 'tavern', content: 'Hi all' });

    const tags = store.getTagsForEvent(event.id);
    assert.deepEqual(tags.sort(), ['local:tavern', 'private:player1']);
    assert.equal(event.type, 'dialogue');
    assert.equal(event.actor, 'player1');
    assert.equal(event.content, 'Hi all');
  });

  test('is visible to an agent whose policy allows local:<location>', () => {
    const store = makeStore();
    appendPlayerMessage({ store, personaId: 'player1', location: 'tavern', content: 'Hi all' });

    const visible = store.queryVisible({ allow: ['local:tavern'], deny: [] });
    assert.equal(visible.length, 1);
    assert.equal(visible[0].content, 'Hi all');
  });

  test('tags one private:<id> per witness, so each present agent remembers this permanently', () => {
    const store = makeStore();
    const event = appendPlayerMessage({
      store,
      personaId: 'player1',
      location: 'tavern',
      content: 'Hi all',
      witnessIds: ['alice', 'bob'],
    });

    const tags = store.getTagsForEvent(event.id);
    assert.deepEqual(tags.sort(), ['local:tavern', 'private:alice', 'private:bob', 'private:player1']);
  });

  test('a witness can still see this event via their own private:{self} even after moving elsewhere', () => {
    const store = makeStore();
    appendPlayerMessage({ store, personaId: 'player1', location: 'tavern', content: 'Hi all', witnessIds: ['alice'] });

    // Alice's policy here deliberately has no local:tavern entry (she's "moved on"), only her own
    // private:{self} — mirroring an agent whose current-location tag no longer matches this room.
    const visible = store.queryVisible({ allow: ['private:alice'], deny: [] });
    assert.equal(visible.length, 1);
    assert.equal(visible[0].content, 'Hi all');
  });

  test('omitting witnessIds behaves exactly like before (no extra tags)', () => {
    const store = makeStore();
    const event = appendPlayerMessage({ store, personaId: 'player1', location: 'tavern', content: 'Hi all' });

    assert.deepEqual(store.getTagsForEvent(event.id).sort(), ['local:tavern', 'private:player1']);
  });
});

describe('InteractivePlay.resolveResponders', () => {
  test('includes only agents whose location fact matches', () => {
    const store = makeStore();
    store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: 'tavern' }, []);
    store.append({ type: 'state', actor: 'system', subject: 'bob', key: 'location', content: 'market' }, []);

    const responders = resolveResponders({ store, agentIds: ['alice', 'bob'], location: 'tavern' });
    assert.deepEqual(responders, ['alice']);
  });

  test('excludes agents with no location fact at all', () => {
    const store = makeStore();
    store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: 'tavern' }, []);

    const responders = resolveResponders({ store, agentIds: ['alice', 'bob'], location: 'tavern' });
    assert.deepEqual(responders, ['alice']);
  });

  test('sorts responders alphabetically for deterministic ordering', () => {
    const store = makeStore();
    store.append({ type: 'state', actor: 'system', subject: 'zoe', key: 'location', content: 'tavern' }, []);
    store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: 'tavern' }, []);
    store.append({ type: 'state', actor: 'system', subject: 'mike', key: 'location', content: 'tavern' }, []);

    const responders = resolveResponders({ store, agentIds: ['zoe', 'alice', 'mike'], location: 'tavern' });
    assert.deepEqual(responders, ['alice', 'mike', 'zoe']);
  });

  test('returns empty array when no agents are at that location', () => {
    const store = makeStore();
    store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: 'market' }, []);

    const responders = resolveResponders({ store, agentIds: ['alice'], location: 'tavern' });
    assert.deepEqual(responders, []);
  });

  test('excludes an agent present in-location whose action is "asleep"', () => {
    const store = makeStore();
    store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: 'tavern' }, []);
    store.append({ type: 'fact', actor: 'alice', subject: 'alice', key: 'action', content: 'asleep' }, []);
    store.append({ type: 'state', actor: 'system', subject: 'bob', key: 'location', content: 'tavern' }, []);

    const responders = resolveResponders({ store, agentIds: ['alice', 'bob'], location: 'tavern' });
    assert.deepEqual(responders, ['bob']);
  });

  test('excludes an agent whose action is "left"', () => {
    const store = makeStore();
    store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: 'tavern' }, []);
    store.append({ type: 'fact', actor: 'alice', subject: 'alice', key: 'action', content: 'left' }, []);

    const responders = resolveResponders({ store, agentIds: ['alice'], location: 'tavern' });
    assert.deepEqual(responders, []);
  });

  test('silent-action matching is case-insensitive and trims whitespace', () => {
    const store = makeStore();
    store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: 'tavern' }, []);
    store.append({ type: 'fact', actor: 'alice', subject: 'alice', key: 'action', content: '  ASLEEP  ' }, []);

    const responders = resolveResponders({ store, agentIds: ['alice'], location: 'tavern' });
    assert.deepEqual(responders, []);
  });

  test('an ordinary (non-reserved) action does not exclude the agent', () => {
    const store = makeStore();
    store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: 'tavern' }, []);
    store.append({ type: 'fact', actor: 'alice', subject: 'alice', key: 'action', content: 'wiping down glasses' }, []);

    const responders = resolveResponders({ store, agentIds: ['alice'], location: 'tavern' });
    assert.deepEqual(responders, ['alice']);
  });

  test('an agent with no action fact at all is still included (opt-out, not opt-in)', () => {
    const store = makeStore();
    store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: 'tavern' }, []);

    const responders = resolveResponders({ store, agentIds: ['alice'], location: 'tavern' });
    assert.deepEqual(responders, ['alice']);
  });
});
