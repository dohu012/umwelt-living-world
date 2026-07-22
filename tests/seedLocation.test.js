import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { movePersonaToLocation } from '../src/agents/seedLocation.js';
import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';

describe('movePersonaToLocation', () => {
  test('updates the canonical location fact and tags the move for the destination and persona', () => {
    const db = openDb(':memory:');
    const store = new EventStore(db);

    const result = movePersonaToLocation({ store, personaId: 'player', locationId: 'market' });

    assert.deepEqual(result, { location: 'market', changed: true });
    assert.equal(store.getFact('player', 'location').content, 'market');
    const event = store.getRecentEvents(1)[0];
    assert.deepEqual(store.getTagsForEvent(event.id).sort(), ['local:market', 'private:player']);
    db.close();
  });

  test('is idempotent when the persona is already at the destination', () => {
    const db = openDb(':memory:');
    const store = new EventStore(db);
    movePersonaToLocation({ store, personaId: 'player', locationId: 'market' });
    const before = store.getRecentEvents().length;

    const result = movePersonaToLocation({ store, personaId: 'player', locationId: 'market' });

    assert.deepEqual(result, { location: 'market', changed: false });
    assert.equal(store.getRecentEvents().length, before);
    db.close();
  });
});
