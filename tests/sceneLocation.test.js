import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildLocationResolvePrompt, parseLocationResolve } from '../src/agents/scene/locationResolver.js';
import { runSceneLocationResolve } from '../src/agents/scene/locationResolveRunner.js';
import { LocationRegistry } from '../src/settings/LocationRegistry.js';

describe('parseLocationResolve', () => {
  test('returns moves only for participants with a non-empty location, keyed to valid ids', () => {
    const text = '{"moves":[{"id":"bob","location":"Church"},{"id":"alice","location":null}]}';
    const moves = parseLocationResolve(text, ['bob', 'alice', 'player']);
    assert.deepEqual(moves, [{ id: 'bob', location: 'Church' }]);
  });

  test('drops entries whose id is not in the participant set', () => {
    const text = '{"moves":[{"id":"stranger","location":"Church"}]}';
    assert.deepEqual(parseLocationResolve(text, ['bob', 'alice']), []);
  });

  test('malformed JSON degrades to no moves', () => {
    assert.deepEqual(parseLocationResolve('not json at all', ['bob']), []);
  });

  test('a body missing the moves array degrades to no moves', () => {
    assert.deepEqual(parseLocationResolve('{"foo":1}', ['bob']), []);
  });

  test('strips a ```json fence before parsing', () => {
    const text = '```json\n{"moves":[{"id":"bob","location":"Market"}]}\n```';
    assert.deepEqual(parseLocationResolve(text, ['bob']), [{ id: 'bob', location: 'Market' }]);
  });

  test('first mention wins when an id is repeated', () => {
    const text = '{"moves":[{"id":"bob","location":"Church"},{"id":"bob","location":"Market"}]}';
    assert.deepEqual(parseLocationResolve(text, ['bob']), [{ id: 'bob', location: 'Church' }]);
  });
});

describe('buildLocationResolvePrompt', () => {
  test('lists every participant with id and current location, and constrains ids', () => {
    const { system, messages } = buildLocationResolvePrompt({
      participants: [
        { id: 'player', name: '旅人', location: 'Outside the bar' },
        { id: 'bob', name: 'Bob', location: 'Outside the bar' },
      ],
      transcript: '[旅人]: bob, come to the church\n[Bob]: sure',
      knownLocations: [{ id: 'start', name: 'Start' }],
    });
    assert.match(system, /旅人 \(id=player\)/);
    assert.match(system, /Bob \(id=bob\)/);
    assert.match(system, /must be exactly one of: player, bob/);
    assert.match(system, /EXACT same location string/);
    assert.match(system, /Known locations so far: Start/);
    assert.equal(messages[0].content, '[旅人]: bob, come to the church\n[Bob]: sure');
  });
});

describe('runSceneLocationResolve canonical grouping', () => {
  function tempRegistry() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-sceneloc-'));
    return new LocationRegistry(path.join(dir, 'locations.json'));
  }

  test('two participants sent to the identical place resolve to the SAME canonical id', async () => {
    const locationRegistry = tempRegistry();
    const utilClient = {
      async chatCompletion() {
        return '{"moves":[{"id":"player","location":"教堂"},{"id":"bob","location":"教堂"}]}';
      },
    };

    const moves = await runSceneLocationResolve({
      utilClient,
      participants: [
        { id: 'player', name: '旅人', location: 'start' },
        { id: 'bob', name: 'Bob', location: 'start' },
      ],
      transcript: '[旅人]: bob, 我们去教堂\n[Bob]: 走',
      locationRegistry,
    });

    assert.equal(moves.length, 2);
    assert.equal(moves[0].locationId, moves[1].locationId, 'party lands in one canonical room');
    assert.ok(locationRegistry.get(moves[0].locationId), 'destination was registered');
  });

  test('a participant who did not actually change canonical location is dropped', async () => {
    const locationRegistry = tempRegistry();
    const start = locationRegistry.getStart(); // id "start", name "Start"
    const utilClient = {
      async chatCompletion() {
        // Model names the same place the participant is already at.
        return `{"moves":[{"id":"alice","location":"${start.name}"}]}`;
      },
    };

    const moves = await runSceneLocationResolve({
      utilClient,
      participants: [{ id: 'alice', name: 'Alice', location: start.id }],
      transcript: '[Alice]: I stay right here.',
      locationRegistry,
    });

    assert.deepEqual(moves, [], 'no-op move filtered out');
  });

  test('a thrown LLM call degrades to no moves', async () => {
    const locationRegistry = tempRegistry();
    const utilClient = {
      async chatCompletion() {
        throw new Error('network down');
      },
    };
    const moves = await runSceneLocationResolve({
      utilClient,
      participants: [{ id: 'player', name: '旅人', location: 'start' }],
      transcript: '[旅人]: hello',
      locationRegistry,
    });
    assert.deepEqual(moves, []);
  });
});
