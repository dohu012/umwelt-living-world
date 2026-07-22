import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import {
  runIntentDispatch,
  buildSceneImageInput,
  buildLocationChangeImageInput,
  readAgentStatus,
} from '../src/skills/hooks.js';

function makeStore() {
  return new EventStore(openDb(':memory:'));
}

describe('skills hooks (skill-on-fix)', () => {
  test('Hook A addresses a named agent only', async () => {
    const store = makeStore();
    const result = await runIntentDispatch({
      store,
      agentIds: ['alice', 'bob'],
      location: 'start',
      personaId: 'player',
      playerMessage: 'Alice，你怎么看？',
      candidates: [
        { id: 'alice', name: 'Alice', state: {} },
        { id: 'bob', name: 'Bob', state: {} },
      ],
    });
    assert.deepEqual(result.responderIds, ['alice']);
    assert.equal(result.intent, 'address_agent');
  });

  test('Hook A sets requestImage for portrait asks', async () => {
    const store = makeStore();
    const result = await runIntentDispatch({
      store,
      agentIds: ['alice', 'bob'],
      location: 'start',
      personaId: 'player',
      playerMessage: '请生成立绘',
      candidates: [
        { id: 'alice', name: 'Alice', state: {} },
        { id: 'bob', name: 'Bob', state: {} },
      ],
    });
    assert.equal(result.flags.requestImage, true);
    assert.equal(result.intent, 'request_image');
    assert.deepEqual(result.responderIds, ['alice']);
  });

  test('Hook A matches Unicode display names', async () => {
    const store = makeStore();
    const result = await runIntentDispatch({
      store,
      agentIds: ['linwan'],
      location: 'start',
      personaId: 'player',
      playerMessage: '林晚你在吗',
      candidates: [{ id: 'linwan', name: '林晚', state: {} }],
    });
    assert.deepEqual(result.responderIds, ['linwan']);
  });

  test('buildSceneImageInput shapes messages', () => {
    const input = buildSceneImageInput({
      location: 'start',
      locationName: '酒馆',
      personaId: 'player',
      playerMessage: '画一下',
      agentTurns: [{ agentId: 'alice', dialogueText: '好的' }],
      requestImage: true,
    });
    assert.equal(input.location, '酒馆');
    // Generic draw ask: do not force portrait; Python detect decides.
    assert.equal(input.forceTypes, null);
    assert.match(input.messages[1].content, /\[alice\]/);
  });

  test('buildSceneImageInput forces environment for scene asks', () => {
    const input = buildSceneImageInput({
      location: 'tavern',
      locationName: 'tavern',
      personaId: 'player',
      playerMessage: '生成当前场景图',
      requestImage: true,
    });
    assert.deepEqual(input.forceTypes, ['environment']);
  });

  test('buildSceneImageInput forces portrait for立绘 asks', () => {
    const input = buildSceneImageInput({
      location: 'tavern',
      personaId: 'player',
      playerMessage: '请生成立绘',
      requestImage: true,
    });
    assert.deepEqual(input.forceTypes, ['character_portrait']);
  });

  test('buildLocationChangeImageInput forces environment', () => {
    const input = buildLocationChangeImageInput({
      location: '后巷',
      locationName: '后巷',
      personaId: 'player',
      fromLocationId: 'start',
    });
    assert.deepEqual(input.forceTypes, ['environment']);
    assert.equal(input.requestImage, true);
    assert.match(input.messages[0].content, /后巷/);
  });

  test('readAgentStatus keeps status keys', () => {
    const store = makeStore();
    store.append({ type: 'fact', actor: 'alice', subject: 'alice', key: 'mood', content: 'wary' }, []);
    store.append({ type: 'fact', actor: 'alice', subject: 'alice', key: 'goal', content: 'serve' }, []);
    const state = readAgentStatus(store, 'alice');
    assert.equal(state.mood, 'wary');
    assert.equal(state.goal, undefined);
  });
});
