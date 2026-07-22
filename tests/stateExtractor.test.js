import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStateExtractionPrompt,
  mergeRelationshipDeltas,
  summarizeRelationshipMap,
} from '../src/agents/state/stateExtractor.js';
import { runStateExtraction } from '../src/agents/state/stateExtractionRunner.js';

test('runStateExtraction uses the utility provider token budget', async () => {
  let receivedArgs;
  const utilClient = {
    async chatCompletion(args) {
      receivedArgs = args;
      return '{"mood":null,"action":null,"location":"Tavern","relationships":[]}';
    },
  };

  const result = await runStateExtraction({
    utilClient,
    profile: { name: 'Player' },
    subjectId: 'player',
    recentEvents: [],
    dialogueText: 'I move to the tavern.',
    locationRegistry: { list: () => [{ id: 'start', name: 'Start' }] },
  });

  assert.equal(Object.hasOwn(receivedArgs, 'maxTokens'), false);
  assert.equal(result.location, 'Tavern');
});

test('remaps relationship `with` from the display name the model uses back to the canonical id', async () => {
  const utilClient = {
    async chatCompletion() {
      return '{"mood":null,"action":null,"location":null,"relationships":[{"with":"Bob","affinityDelta":2,"trustDelta":1,"note":"x"}]}';
    },
  };
  const result = await runStateExtraction({
    utilClient,
    profile: { name: 'Alice' },
    subjectId: 'alice',
    recentEvents: [{ type: 'dialogue', actor: 'bob-9f2', content: 'hi' }],
    dialogueText: 'hello',
    locationRegistry: { list: () => [] },
    resolveName: (id) => (id === 'bob-9f2' ? 'Bob' : id),
  });
  assert.equal(result.relationships[0].with, 'bob-9f2', 'name "Bob" resolved to canonical id');
});

test('leaves an unrecognized relationship `with` untouched (lenient)', async () => {
  const utilClient = { async chatCompletion() { return '{"relationships":[{"with":"bob-9f2","affinityDelta":1,"trustDelta":0}]}'; } };
  const result = await runStateExtraction({
    utilClient,
    profile: { name: 'Alice' },
    subjectId: 'alice',
    recentEvents: [{ type: 'dialogue', actor: 'bob-9f2', content: 'hi' }],
    dialogueText: 'hello',
    locationRegistry: { list: () => [] },
    resolveName: (id) => (id === 'bob-9f2' ? 'Bob' : id),
  });
  assert.equal(result.relationships[0].with, 'bob-9f2', 'an id echoed by the model is kept as-is');
});

describe('mergeRelationshipDeltas', () => {
  test('creates a new entry (starting from 0/0) for a previously-unknown id', () => {
    const merged = mergeRelationshipDeltas({}, [{ with: 'bob', affinityDelta: 2, trustDelta: 1, note: 'just met' }]);
    assert.deepEqual(merged, { bob: { affinity: 2, trust: 1, notes: 'just met' } });
  });

  test('adds deltas onto an existing entry rather than overwriting it', () => {
    const existing = { bob: { affinity: 5, trust: 3, notes: 'old note' } };
    const merged = mergeRelationshipDeltas(existing, [{ with: 'bob', affinityDelta: -2, trustDelta: 1 }]);
    assert.deepEqual(merged, { bob: { affinity: 3, trust: 4, notes: 'old note' } });
  });

  test('leaves untouched entries in the existing map alone (partial update)', () => {
    const existing = {
      bob: { affinity: 5, trust: 3, notes: 'bob note' },
      carol: { affinity: -1, trust: 0, notes: 'carol note' },
    };
    const merged = mergeRelationshipDeltas(existing, [{ with: 'bob', affinityDelta: 1, trustDelta: 0 }]);
    assert.deepEqual(merged.carol, { affinity: -1, trust: 0, notes: 'carol note' });
    assert.deepEqual(merged.bob, { affinity: 6, trust: 3, notes: 'bob note' });
  });

  test('attaches a relationship label (full value, latest non-null wins) and omits the key when never set', () => {
    // No label anywhere → shape stays {affinity,trust,notes}, no label key.
    const plain = mergeRelationshipDeltas({}, [{ with: 'bob', affinityDelta: 1, trustDelta: 0 }]);
    assert.equal(Object.hasOwn(plain.bob, 'label'), false);

    // A label is stored, then kept when a later delta omits it, then replaced when a new one arrives.
    let m = mergeRelationshipDeltas({}, [{ with: 'bob', affinityDelta: 2, trustDelta: 1, label: '陌生人' }]);
    assert.equal(m.bob.label, '陌生人');
    m = mergeRelationshipDeltas(m, [{ with: 'bob', affinityDelta: 1, trustDelta: 0, label: null }]);
    assert.equal(m.bob.label, '陌生人', 'a null label keeps the prior one');
    m = mergeRelationshipDeltas(m, [{ with: 'bob', affinityDelta: 1, trustDelta: 1, label: '朋友' }]);
    assert.equal(m.bob.label, '朋友', 'a new label replaces the prior one');
  });

  test('replaces notes only when a new note is given, otherwise keeps the old one', () => {
    const existing = { bob: { affinity: 0, trust: 0, notes: 'old' } };
    const merged = mergeRelationshipDeltas(existing, [{ with: 'bob', affinityDelta: 0, trustDelta: 0, note: null }]);
    assert.equal(merged.bob.notes, 'old');
  });

  test('handles multiple deltas for different ids in one call', () => {
    const merged = mergeRelationshipDeltas({}, [
      { with: 'bob', affinityDelta: 1, trustDelta: 0 },
      { with: 'carol', affinityDelta: -1, trustDelta: 2 },
    ]);
    assert.deepEqual(Object.keys(merged).sort(), ['bob', 'carol']);
  });
});

describe('summarizeRelationshipMap', () => {
  test('empty map summarizes to an empty string', () => {
    assert.equal(summarizeRelationshipMap({}), '');
  });

  test('renders a short human-readable line per entry', () => {
    const summary = summarizeRelationshipMap({ bob: { affinity: 3, trust: 1, notes: null } });
    assert.match(summary, /bob: affinity 3, trust 1/);
  });
});

describe('buildStateExtractionPrompt', () => {
  test('constrains relationships[].with to the given knownOtherIds', () => {
    const { system } = buildStateExtractionPrompt({
      profile: { name: 'Alice' },
      agentId: 'alice',
      recentEvents: [],
      dialogueText: 'Hello.',
      knownOtherIds: ['bob', 'carol'],
    });
    assert.match(system, /bob, carol/);
  });

  test('tells the model relationships must be empty when no one else is visible', () => {
    const { system } = buildStateExtractionPrompt({
      profile: { name: 'Alice' },
      agentId: 'alice',
      recentEvents: [],
      dialogueText: 'Hello.',
      knownOtherIds: [],
    });
    assert.match(system, /must be an empty array/);
  });

  test('labels the transcript and the relationship target list by resolved display name, not raw id', () => {
    const { system, messages } = buildStateExtractionPrompt({
      profile: { name: 'Alice' },
      agentId: 'alice',
      recentEvents: [{ type: 'dialogue', actor: 'bob-9f2', content: 'Hi Alice.' }],
      dialogueText: 'Hello.',
      knownOtherIds: ['bob-9f2'],
      resolveName: (id) => (id === 'bob-9f2' ? 'Bob' : id),
    });
    assert.match(messages[0].content, /\[Bob\]: Hi Alice\./);
    assert.doesNotMatch(messages[0].content, /bob-9f2/);
    assert.match(system, /these names: Bob/);
  });

  test('includes the just-delivered dialogue as the final line of context', () => {
    const { messages } = buildStateExtractionPrompt({
      profile: { name: 'Alice' },
      agentId: 'alice',
      recentEvents: [{ type: 'dialogue', actor: 'bob', content: 'Hi Alice.' }],
      dialogueText: 'Hello Bob.',
      knownOtherIds: ['bob'],
    });
    assert.equal(messages.length, 1);
    assert.match(messages[0].content, /\[bob\]: Hi Alice\./);
    assert.match(messages[0].content, /\[Alice, just now\]: Hello Bob\./);
  });

  test('never asks the model to roleplay — system prompt is explicitly non-persona', () => {
    const { system } = buildStateExtractionPrompt({
      profile: { name: 'Alice' },
      agentId: 'alice',
      recentEvents: [],
      dialogueText: 'Hello.',
      knownOtherIds: [],
    });
    assert.match(system, /do not roleplay or speak as Alice/);
  });

  test('omits the known-locations nudge entirely when none are known yet', () => {
    const { system } = buildStateExtractionPrompt({
      profile: { name: 'Alice' },
      agentId: 'alice',
      recentEvents: [],
      dialogueText: 'Hello.',
      knownOtherIds: [],
    });
    assert.doesNotMatch(system, /Known locations/);
  });

  test('nudges the model to reuse a known location name instead of inventing new phrasing', () => {
    const { system } = buildStateExtractionPrompt({
      profile: { name: 'Alice' },
      agentId: 'alice',
      recentEvents: [],
      dialogueText: 'Hello.',
      knownOtherIds: [],
      knownLocations: [{ id: 'tavern', name: 'Rusty Anchor Tavern' }, { id: 'market', name: 'Market' }],
    });
    assert.match(system, /Known locations so far: Rusty Anchor Tavern, Market/);
    assert.match(system, /reuse its name exactly rather than inventing new phrasing/);
  });
});
