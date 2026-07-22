import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import { appendPlayerMessage } from '../src/orchestrator/InteractivePlay.js';

/**
 * Exercises the actual data shape the new `GET /api/worlds/:worldId/personas/:personaId/timeline`
 * route depends on (`store.getEventsByTagPrefix('private:'+personaId, ...)`) — the route itself is
 * a two-line pass-through (see src/server/routes/timeline.js), so the real logic worth testing is
 * the witness-tagging scheme it reads: everything a persona was actually present to witness gets
 * private:<personaId>, bounded exactly to the presence window (see the plan doc's "在场即留痕").
 */
describe('persona timeline (private:<personaId> query)', () => {
  test('returns the player\'s own lines plus every witnessed reply, across locations, in order', () => {
    const store = new EventStore(openDb(':memory:'));

    // Round 1, in the tavern: player + bob present.
    appendPlayerMessage({ store, personaId: 'player1', location: 'tavern', content: 'Hi Bob', witnessIds: ['bob'] });
    store.append(
      { type: 'dialogue', actor: 'bob', subject: 'bob', content: 'Hey!' },
      ['local:tavern', 'private:bob', 'private:player1'],
    );

    // Round 2, player moved outside — bob stayed behind, so his later lines must NOT carry
    // private:player1.
    appendPlayerMessage({ store, personaId: 'player1', location: 'outside', content: 'Anyone here?', witnessIds: [] });
    store.append(
      { type: 'dialogue', actor: 'bob', subject: 'bob', content: 'Talking to himself back at the tavern' },
      ['local:tavern', 'private:bob'],
    );

    const timeline = store.getEventsByTagPrefix('private:player1');
    const contents = timeline.map((e) => e.content);

    assert.deepEqual(contents, ['Hi Bob', 'Hey!', 'Anyone here?']);
    assert.ok(!contents.includes('Talking to himself back at the tavern'), "not witnessed — must not appear");
  });

  test('a narration the player witnessed is included; one that happened after they left is not', () => {
    const store = new EventStore(openDb(':memory:'));

    appendPlayerMessage({ store, personaId: 'player1', location: 'tavern', content: 'Hello?', witnessIds: [] });
    store.append(
      { type: 'narration', actor: 'narrator', subject: null, content: 'The fire crackles.' },
      ['local:tavern', 'private:player1'],
    );
    // A later narration in the same room, after the player moved on — no private:player1 tag.
    store.append(
      { type: 'narration', actor: 'narrator', subject: null, content: 'The room falls silent.' },
      ['local:tavern'],
    );

    const timeline = store.getEventsByTagPrefix('private:player1');
    const contents = timeline.map((e) => e.content);
    assert.deepEqual(contents, ['Hello?', 'The fire crackles.']);
  });

  test('events come back with their tags attached, so the caller can resolve a per-event location', () => {
    const store = new EventStore(openDb(':memory:'));
    appendPlayerMessage({ store, personaId: 'player1', location: 'tavern', content: 'Hi', witnessIds: [] });

    const [event] = store.getEventsByTagPrefix('private:player1');
    assert.ok(event.tags.includes('local:tavern'));
  });

  test('intro events store location in data when private tags omit local:', () => {
    const store = new EventStore(openDb(':memory:'));
    store.append(
      { type: 'narration', actor: 'narrator', content: 'The door closes.', data: { location: '食堂', intro: true } },
      ['private:player1', 'private:he'],
    );

    const [event] = store.getEventsByTagPrefix('private:player1');
    assert.equal(JSON.parse(event.data).location, '食堂');
    assert.ok(!event.tags.some((tag) => tag.startsWith('local:')));
  });
});
