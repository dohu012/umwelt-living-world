import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import { AgentRegistry } from '../src/agents/AgentRegistry.js';
import { introFactKey, loadWorldMetadata } from '../src/world/loadWorldMetadata.js';
import { maybeRunWorldIntro } from '../src/world/worldIntro.js';

function tempWorldDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-worldintro-'));
  fs.mkdirSync(path.join(dir, 'agents', 'he'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'agents', 'he', 'profile.json'),
    JSON.stringify({
      name: '赫',
      description: 'Captain.',
      first_mes: '巡视员，你终于来了。',
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'world.json'),
    JSON.stringify({
      name: '纠缠号',
      subtitle: '退相干之夜',
      intro: {
        version: 1,
        playerRole: '事故巡视员',
        summary: '链路退相干。',
        environment: '红灯旋转。',
        openingNarration: '舱门闭合。',
        openingAgentId: 'he',
      },
    }),
  );
  return dir;
}

describe('world intro', () => {
  test('first enter writes narration, dialogue, and completion fact', () => {
    const worldDir = tempWorldDir();
    const store = new EventStore(openDb(':memory:'));
    const agentRegistry = new AgentRegistry(worldDir);
    const metadata = loadWorldMetadata(worldDir);
    const frames = [];

    const result = maybeRunWorldIntro({
      store,
      agentRegistry,
      metadata,
      personaId: 'persona-a',
      locationId: '食堂',
      sendFrame: (frame) => frames.push(frame),
    });

    assert.ok(result);
    assert.equal(frames[0].type, 'world_intro');
    assert.equal(frames[1].type, 'narration_message');
    assert.equal(frames[2].type, 'agent_message');
    assert.equal(frames[2].dialogueText, '巡视员，你终于来了。');

    assert.ok(store.getFact('persona-a', introFactKey(1)));
    const timeline = store.getEventsByTagPrefix('private:persona-a');
    assert.equal(timeline.length, 3);
    assert.deepEqual(
      timeline.map((e) => e.type),
      ['narration', 'dialogue', 'fact'],
    );
  });

  test('same persona reconnect does not repeat intro', () => {
    const worldDir = tempWorldDir();
    const store = new EventStore(openDb(':memory:'));
    const agentRegistry = new AgentRegistry(worldDir);
    const metadata = loadWorldMetadata(worldDir);

    maybeRunWorldIntro({
      store,
      agentRegistry,
      metadata,
      personaId: 'persona-a',
      locationId: '食堂',
      sendFrame: () => {},
    });

    const second = maybeRunWorldIntro({
      store,
      agentRegistry,
      metadata,
      personaId: 'persona-a',
      locationId: '食堂',
      sendFrame: () => {},
    });

    assert.equal(second, null);
    assert.equal(store.getEventsByTagPrefix('private:persona-a').length, 3);
  });

  test('another persona gets its own intro', () => {
    const worldDir = tempWorldDir();
    const store = new EventStore(openDb(':memory:'));
    const agentRegistry = new AgentRegistry(worldDir);
    const metadata = loadWorldMetadata(worldDir);

    maybeRunWorldIntro({
      store,
      agentRegistry,
      metadata,
      personaId: 'persona-a',
      locationId: '食堂',
      sendFrame: () => {},
    });
    maybeRunWorldIntro({
      store,
      agentRegistry,
      metadata,
      personaId: 'persona-b',
      locationId: '食堂',
      sendFrame: () => {},
    });

    assert.equal(store.getEventsByTagPrefix('private:persona-a').length, 3);
    assert.equal(store.getEventsByTagPrefix('private:persona-b').length, 3);
  });

  test('world without world.json is a no-op', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-worldintro-empty-'));
    assert.equal(loadWorldMetadata(dir), null);

    const store = new EventStore(openDb(':memory:'));
    const agentRegistry = new AgentRegistry(dir);
    fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });

    const result = maybeRunWorldIntro({
      store,
      agentRegistry,
      metadata: null,
      personaId: 'persona-a',
      locationId: 'start',
      sendFrame: () => {},
    });

    assert.equal(result, null);
    assert.equal(store.getEventsByTagPrefix('private:persona-a').length, 0);
  });

  test('invalid opening agent degrades to narration-only intro', () => {
    const worldDir = tempWorldDir();
    const metadata = loadWorldMetadata(worldDir);
    metadata.intro.openingAgentId = 'missing-agent';

    const store = new EventStore(openDb(':memory:'));
    const agentRegistry = new AgentRegistry(worldDir);
    const frames = [];

    const result = maybeRunWorldIntro({
      store,
      agentRegistry,
      metadata,
      personaId: 'persona-a',
      locationId: '食堂',
      sendFrame: (frame) => frames.push(frame),
    });

    assert.ok(result);
    assert.equal(frames.length, 2);
    assert.equal(frames[0].type, 'world_intro');
    assert.equal(frames[1].type, 'narration_message');
    assert.ok(store.getFact('persona-a', introFactKey(1)));
  });
});
