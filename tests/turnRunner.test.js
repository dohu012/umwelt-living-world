import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import { AgentRegistry } from '../src/agents/AgentRegistry.js';
import { LocationRegistry } from '../src/settings/LocationRegistry.js';
import { TurnRunner } from '../src/orchestrator/TurnRunner.js';

let worldDir;

beforeEach(() => {
  worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-turnrunner-'));
  const agentDir = path.join(worldDir, 'agents', 'alice');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'profile.json'),
    JSON.stringify({ name: 'Alice', description: 'A test character.' }),
  );
});

afterEach(() => {
  fs.rmSync(worldDir, { recursive: true, force: true });
});

function fakeClient(replyText = 'Hello there.') {
  return {
    calls: [],
    async chatCompletion({ system, messages, maxTokens }) {
      this.calls.push({ system, messages, maxTokens });
      return replyText;
    },
  };
}

function makeRunner(overrides = {}) {
  const store = new EventStore(openDb(':memory:'));
  const agentRegistry = new AgentRegistry(worldDir);
  const locationRegistry = new LocationRegistry(path.join(worldDir, 'locations.json'));
  const runner = new TurnRunner({
    store,
    llmClient: null,
    agentRegistry,
    worldDir,
    locationRegistry,
    summarizeEveryNTurns: 1, // fire a summarization (utility) call after every turn, so we can observe routing
    summaryWords: 50,
    ...overrides,
  });
  return { runner, store, locationRegistry };
}

describe('TurnRunner client routing (character vs utility)', () => {
  test('dialogue call uses llmClient; utility calls (state extraction + summarization) use utilityLlmClient when both are given', async () => {
    const dialogueClient = fakeClient('In character reply.');
    const utilityClient = fakeClient('A short summary.');
    const { runner } = makeRunner();

    const result = await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: utilityClient });
    // State extraction + summarization now run in the background (see runTurn) — await it before
    // checking anything they produce.
    const bg = await result.backgroundTask;

    assert.equal(dialogueClient.calls.length, 1);
    assert.equal(utilityClient.calls.length, 2, 'state extraction + summarization both go through utilClient');
    assert.equal(result.dialogueText, 'In character reply.');
    assert.equal(bg.summarized, true);
  });

  test('utility calls fall back to llmClient when no utilityLlmClient is given at all', async () => {
    const soleClient = fakeClient('Only one client in play.');
    const { runner } = makeRunner();

    const result = await runner.runTurn('alice', { llmClient: soleClient });
    await result.backgroundTask;

    // Dialogue + state extraction + summarization all landed on the same client.
    assert.equal(soleClient.calls.length, 3);
  });

  test('a constructor-level utilityLlmClient is used when runTurn does not override it per-call', async () => {
    const dialogueClient = fakeClient('Dialogue via per-call client.');
    const constructorUtilityClient = fakeClient('Summary via constructor client.');
    const { runner } = makeRunner({ utilityLlmClient: constructorUtilityClient });

    const result = await runner.runTurn('alice', { llmClient: dialogueClient });
    await result.backgroundTask;

    assert.equal(dialogueClient.calls.length, 1);
    assert.equal(constructorUtilityClient.calls.length, 2);
  });

  test('a per-call utilityLlmClient overrides the constructor-level one', async () => {
    const dialogueClient = fakeClient('Dialogue.');
    const constructorUtilityClient = fakeClient('Should not be used.');
    const perCallUtilityClient = fakeClient('Should be used.');
    const { runner } = makeRunner({ utilityLlmClient: constructorUtilityClient });

    const result = await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: perCallUtilityClient });
    await result.backgroundTask;

    assert.equal(constructorUtilityClient.calls.length, 0);
    assert.equal(perCallUtilityClient.calls.length, 2);
  });

  test('CLI/batch style call (no llmClient/utilityLlmClient overrides at all) uses the constructor client for everything', async () => {
    const soleClient = fakeClient('Batch mode reply.');
    const { runner } = makeRunner({ llmClient: soleClient });

    const result = await runner.runTurn('alice');
    await result.backgroundTask;

    assert.equal(soleClient.calls.length, 3);
  });
});

/** Distinguishes the state-extraction call from the (also utility-routed) summarization call by prompt content. */
function scriptedUtilClient(stateJsonPerCall) {
  let stateCallIndex = 0;
  return {
    calls: [],
    async chatCompletion({ system, messages, maxTokens }) {
      this.calls.push({ system, messages, maxTokens });
      if (system.includes('silent state-tracking module')) {
        const payload = Array.isArray(stateJsonPerCall) ? stateJsonPerCall[stateCallIndex++] : stateJsonPerCall;
        return JSON.stringify(payload);
      }
      return 'a rolling summary'; // summarizer call, if summarizeEveryNTurns is enabled
    },
  };
}

describe('TurnRunner state extraction integration', () => {
  test('writes mood/action/location/relationship facts from the dedicated state-extraction call', async () => {
    const dialogueClient = fakeClient('Alice nods slowly.');
    const utilClient = scriptedUtilClient({
      mood: 'wary',
      action: 'wiping a glass',
      location: 'tavern',
      relationships: [{ with: 'bob', affinityDelta: 2, trustDelta: 1, note: 'first meeting' }],
    });
    const { runner, store, locationRegistry } = makeRunner({ summarizeEveryNTurns: 0 });

    const result = await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: utilClient });
    await result.backgroundTask;

    assert.equal(store.getFact('alice', 'mood').content, 'wary');
    assert.equal(store.getFact('alice', 'action').content, 'wiping a glass');
    assert.equal(store.getFact('alice', 'location').content, 'tavern', 'canonical id (slugify("tavern") === "tavern")');
    assert.equal(store.getFact('alice', 'location_detail').content, 'tavern', 'free-text detail, private-only');
    assert.equal(locationRegistry.get('tavern')?.name, 'tavern', 'auto-registered into the location registry');
    assert.deepEqual(store.getFact('alice', 'relationship').data, {
      bob: { affinity: 2, trust: 1, notes: 'first meeting' },
    });

    const state = JSON.parse(fs.readFileSync(path.join(worldDir, 'agents', 'alice', 'state.json'), 'utf8'));
    assert.equal(state.mood, 'wary');
    assert.equal(state.location, 'tavern');
    assert.equal(state.location_detail, 'tavern');
    assert.deepEqual(state.relationship, { bob: { affinity: 2, trust: 1, notes: 'first meeting' } });
  });

  test('resolves a free-text location against an existing registry entry rather than splitting it', async () => {
    const dialogueClient = fakeClient('...');
    const { runner, store, locationRegistry } = makeRunner({ summarizeEveryNTurns: 0 });
    const tavern = locationRegistry.create({ name: 'Rusty Anchor Tavern' });

    const utilClient = scriptedUtilClient({ location: 'rusty anchor tavern' }); // same words, different case
    const result = await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: utilClient });
    await result.backgroundTask;

    assert.equal(store.getFact('alice', 'location').content, tavern.id);
    assert.equal(locationRegistry.list().length, 2, 'Start + the pre-created tavern, no 3rd entry — matched by name');
  });

  test('documented residual-drift tradeoff: two different phrasings for the same place across turns produce two distinct canonical locations', async () => {
    const dialogueClient = fakeClient('...');
    const { runner, store, locationRegistry } = makeRunner({ summarizeEveryNTurns: 0 });
    const utilClient = scriptedUtilClient([{ location: 'tavern' }, { location: 'Rust Anchor Tavern bar' }]);

    const result1 = await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: utilClient });
    await result1.backgroundTask;
    const firstLocation = store.getFact('alice', 'location').content;
    const result2 = await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: utilClient });
    await result2.backgroundTask;
    const secondLocation = store.getFact('alice', 'location').content;

    assert.notEqual(firstLocation, secondLocation);
    assert.equal(locationRegistry.list().length, 3, 'Start + both distinct phrasings registered separately');
  });

  test('merges relationship deltas across turns instead of overwriting the map', async () => {
    const dialogueClient = fakeClient('...');
    const utilClient = scriptedUtilClient([
      { relationships: [{ with: 'bob', affinityDelta: 2, trustDelta: 1, note: 'first meeting' }] },
      { relationships: [{ with: 'bob', affinityDelta: -1, trustDelta: 0 }, { with: 'carol', affinityDelta: 3, trustDelta: 2, note: 'new arrival' }] },
    ]);
    const { runner, store } = makeRunner({ summarizeEveryNTurns: 0 });

    const r1 = await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: utilClient });
    await r1.backgroundTask;
    const r2 = await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: utilClient });
    await r2.backgroundTask;

    const relationship = store.getFact('alice', 'relationship').data;
    assert.deepEqual(relationship, {
      bob: { affinity: 1, trust: 1, notes: 'first meeting' }, // 2-1=1 affinity, note preserved (2nd delta had no note)
      carol: { affinity: 3, trust: 2, notes: 'new arrival' },
    });
  });

  test('a malformed state-extraction response degrades to no state change, without losing the dialogue turn', async () => {
    const dialogueClient = fakeClient('Alice says something in character.');
    const utilClient = fakeClient('not json'); // triggers graceful degrade in parseStateExtraction
    const { runner, store } = makeRunner({ summarizeEveryNTurns: 0 });

    const result = await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: utilClient });
    const bg = await result.backgroundTask;

    assert.equal(result.dialogueText, 'Alice says something in character.');
    assert.match(bg.stateResult.parseError, /invalid JSON/);
    assert.equal(store.getFact('alice', 'mood'), undefined);
    assert.equal(store.getFact('alice', 'location'), undefined);
  });

  test('writes addressedTo as a separate fact once the state-extraction call names a target', async () => {
    const dialogueClient = fakeClient('Bob, that ale sounds great.');
    const utilClient = scriptedUtilClient({ addressedTo: 'Bob' });
    const { runner, store } = makeRunner({ summarizeEveryNTurns: 0 });
    // Seed a prior line from "bob" so he's a knownOtherId the state extraction can resolve
    // addressedTo's display name ("Bob") back against.
    store.append({ type: 'dialogue', actor: 'bob', subject: 'bob', content: 'Hey there.' }, ['global']);

    const result = await runner.runTurn('alice', {
      llmClient: dialogueClient,
      utilityLlmClient: utilClient,
      resolveName: (id) => (id === 'bob' ? 'Bob' : id),
    });
    await result.backgroundTask;

    // Persisted in the background, after the dialogue event — display name resolved back to the
    // canonical id, same as relationships[].with.
    assert.equal(store.getFact('alice', 'addressedTo')?.content, 'bob');
  });
});

describe('TurnRunner silence handling ([[SILENT]] marker)', () => {
  test('an agent that outputs the silence marker produces no dialogue event and skips state extraction', async () => {
    const dialogueClient = fakeClient('[[SILENT]]');
    const utilClient = fakeClient('should never be called');
    const { runner, store } = makeRunner({ summarizeEveryNTurns: 0 });

    const result = await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: utilClient });

    assert.equal(result.silent, true);
    assert.equal(result.dialogueText, null);
    assert.equal(utilClient.calls.length, 0, 'state extraction/summarization never fire for a silent turn');
    assert.equal(store.getRecentEvents(10).filter((e) => e.type === 'dialogue').length, 0);
  });

  test('roster, when provided, is threaded into the dialogue call system prompt', async () => {
    const dialogueClient = fakeClient('Hello!');
    const { runner } = makeRunner({ summarizeEveryNTurns: 0 });

    await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: fakeClient(), roster: ['Player', 'Bob'] });

    assert.match(dialogueClient.calls[0].system, /Player, Bob/);
    assert.match(dialogueClient.calls[0].system, /multi-party scene/);
  });

  test("resolves the agent's own location fact to a display name and grounds the system prompt in it", async () => {
    const dialogueClient = fakeClient('Hello!');
    const { runner, store, locationRegistry } = makeRunner({ summarizeEveryNTurns: 0 });
    const tavern = locationRegistry.create({ name: 'Rusty Anchor Tavern' });
    store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: tavern.id }, []);

    await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: fakeClient() });

    assert.match(dialogueClient.calls[0].system, /You are currently at: Rusty Anchor Tavern/);
  });

  test('omits the location line entirely when the agent has no location fact yet', async () => {
    const dialogueClient = fakeClient('Hello!');
    const { runner } = makeRunner({ summarizeEveryNTurns: 0 });

    await runner.runTurn('alice', { llmClient: dialogueClient, utilityLlmClient: fakeClient() });

    assert.doesNotMatch(dialogueClient.calls[0].system, /You are currently at/);
  });

  test('tags the dialogue event with one private:<id> per witness, in addition to the usual local/private:{self} tags', async () => {
    const dialogueClient = fakeClient('Hello!');
    const { runner, store } = makeRunner({ summarizeEveryNTurns: 0 });
    store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: 'start' }, []);

    const result = await runner.runTurn('alice', {
      llmClient: dialogueClient,
      utilityLlmClient: fakeClient(),
      witnessIds: ['player1', 'bob'],
    });

    const dialogueEvent = store.getRecentEvents(10).filter((e) => e.type === 'dialogue').at(-1);
    const tags = store.getTagsForEvent(dialogueEvent.id).sort();
    assert.deepEqual(tags, ['local:start', 'private:alice', 'private:bob', 'private:player1']);
    // Sanity: this doesn't change return shape or block the rest of the turn.
    assert.equal(result.dialogueText, 'Hello!');
  });
});
