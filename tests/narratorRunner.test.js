import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import { appendPlayerMessage } from '../src/orchestrator/InteractivePlay.js';
import { runNarratorTurn } from '../src/agents/NarratorRunner.js';

function fakeClient(replyText) {
  return {
    calls: [],
    async chatCompletion({ system, messages }) {
      this.calls.push({ system, messages });
      return replyText;
    },
  };
}

describe('runNarratorTurn', () => {
  test('appends a narration event tagged local:<location> only when the model narrates', async () => {
    const store = new EventStore(openDb(':memory:'));
    appendPlayerMessage({ store, personaId: 'player1', location: 'tavern', content: '（推开门，四下无人）' });
    const utilClient = fakeClient('炉火噼啪作响，酒馆里空无一人，只有风从门缝里钻进来。');

    const result = await runNarratorTurn({
      store,
      locationRegistry: { get: () => ({ name: 'The Rusty Anchor' }) },
      location: 'tavern',
      utilityLlmClient: utilClient,
      resolveName: (id) => (id === 'player1' ? 'Player' : id),
    });

    assert.ok(result);
    assert.equal(result.content, '炉火噼啪作响，酒馆里空无一人，只有风从门缝里钻进来。');
    const narrationEvents = store.queryVisible({ allow: ['local:tavern'] }).filter((e) => e.type === 'narration');
    assert.equal(narrationEvents.length, 1);
    assert.equal(narrationEvents[0].actor, 'narrator');
    assert.deepEqual(store.getTagsForEvent(narrationEvents[0].id), ['local:tavern']);
    // A narration about this room must not leak into another room's context via a 'global' tag.
    assert.equal(store.queryVisible({ allow: ['global'] }).filter((e) => e.type === 'narration').length, 0);
  });

  test('tags the narration with one private:<id> per witness, so everyone present remembers it', async () => {
    const store = new EventStore(openDb(':memory:'));
    const utilClient = fakeClient('炉火噼啪作响。');

    await runNarratorTurn({
      store,
      locationRegistry: { get: () => ({ name: 'The Rusty Anchor' }) },
      location: 'tavern',
      utilityLlmClient: utilClient,
      witnessIds: ['player1', 'bob'],
    });

    const narrationEvent = store.queryVisible({ allow: ['local:tavern'] }).find((e) => e.type === 'narration');
    assert.deepEqual(
      store.getTagsForEvent(narrationEvent.id).sort(),
      ['local:tavern', 'private:bob', 'private:player1'],
    );
  });

  test('the location name is passed through to the prompt', async () => {
    const store = new EventStore(openDb(':memory:'));
    const utilClient = fakeClient('narration text');

    await runNarratorTurn({
      store,
      locationRegistry: { get: () => ({ name: 'The Rusty Anchor' }) },
      location: 'tavern',
      utilityLlmClient: utilClient,
    });

    assert.match(utilClient.calls[0].system, /The Rusty Anchor/);
  });

  test('declining via the silence marker writes no event', async () => {
    const store = new EventStore(openDb(':memory:'));
    const utilClient = fakeClient('[[SILENT]]');

    const result = await runNarratorTurn({
      store,
      locationRegistry: { get: () => null },
      location: 'tavern',
      utilityLlmClient: utilClient,
    });

    assert.equal(result, null);
    assert.equal(store.queryVisible({ allow: ['global'] }).length, 0);
  });

  test('a failed LLM call degrades to no narration rather than throwing', async () => {
    const store = new EventStore(openDb(':memory:'));
    const utilClient = {
      async chatCompletion() {
        throw new Error('provider unreachable');
      },
    };

    const result = await runNarratorTurn({
      store,
      locationRegistry: { get: () => null },
      location: 'tavern',
      utilityLlmClient: utilClient,
    });

    assert.equal(result, null);
  });
});
