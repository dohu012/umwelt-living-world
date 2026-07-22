import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import { AgentRegistry } from '../src/agents/AgentRegistry.js';
import { LocationRegistry } from '../src/settings/LocationRegistry.js';
import { resolvePersonaLocation } from '../src/agents/seedLocation.js';
import { RoomManager } from '../src/server/RoomManager.js';

const FAKE_PROVIDER = { baseUrl: 'http://fake-llm.test', model: 'fake-model', apiKey: null };

let worldDir;
let originalFetch;

beforeEach(() => {
  worldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-roommanager-'));
  fs.mkdirSync(path.join(worldDir, 'agents'), { recursive: true }); // zero agents — NPC dispatch loop is out of scope here
  originalFetch = global.fetch;
});

afterEach(() => {
  fs.rmSync(worldDir, { recursive: true, force: true });
  global.fetch = originalFetch;
});

function jsonResponse(obj) {
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) };
}

/** RoomManager always passes onToken for in-character dialogue calls, so NimClient requests
 * stream:true and reads the response as SSE (res.body.getReader()) — a plain res.json() mock
 * won't do for those. One chunk containing the whole reply, then [DONE], is enough for a test. */
function sseResponseFor(text) {
  const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  const bytes = new TextEncoder().encode(payload);
  let served = false;
  return {
    ok: true,
    body: {
      getReader: () => ({
        async read() {
          if (served) return { done: true, value: undefined };
          served = true;
          return { done: false, value: bytes };
        },
      }),
    },
  };
}

/**
 * Distinguishes the call kinds by system-prompt content:
 *  - scene-location resolver ("silent scene-location resolver") → `movesJson` ({ moves: [{id, location}] }),
 *    the holistic authority over where the cast ends up;
 *  - per-subject state extraction ("silent state-tracking module for the character <name>") →
 *    `stateJsonFor(name)` (mood/action/relationships only — location is owned by the resolver now);
 *  - the narrator ("third-person scene narrator") → `narratorReply`, a plain (non-streamed) reply,
 *    default `[[SILENT]]` so existing zero-agent scenes stay narration-free unless a test opts in;
 *  - anything else = an in-character dialogue call → a streamed `dialogueReply`.
 */
function mockFetchScene({
  dialogueReply = 'A reply.',
  stateJsonFor = () => ({}),
  movesJson = { moves: [] },
  narratorReply = '[[SILENT]]',
} = {}) {
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const sysText = body.messages[0].content;
    if (sysText.includes('silent scene-location resolver')) return jsonResponse(movesJson);
    const match = sysText.match(/silent state-tracking module for the character ([^.]+)/);
    if (match) return jsonResponse(stateJsonFor(match[1]));
    if (sysText.includes('third-person scene narrator')) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: narratorReply } }] }) };
    }
    return sseResponseFor(dialogueReply);
  };
}

function createNpcAgent(worldDir, agentId, { name, location }, store) {
  const agentDir = path.join(worldDir, 'agents', agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'profile.json'),
    JSON.stringify({
      name,
      description: 'A test NPC.',
      system_prompt: 'Stay in character.',
      extensions: {
        visibility: { allow: ['global', 'private:{self}', 'local:{state.location}'], deny: ['private:*'] },
      },
    }),
  );
  store.append({ type: 'state', actor: 'system', subject: agentId, key: 'location', content: location }, []);
}

function makeWorldRegistry() {
  const store = new EventStore(openDb(':memory:'));
  const agentRegistry = new AgentRegistry(worldDir);
  const locationRegistry = new LocationRegistry(path.join(worldDir, 'locations.json'));
  const world = { worldId: 'w1', worldDir, store, agentRegistry, locationRegistry };
  return {
    worldExists: () => true,
    getWorld: () => world,
  };
}

function fakeWs() {
  return {
    sent: [],
    readyState: 1,
    OPEN: 1,
    umweltRoom: null,
    send(json) {
      this.sent.push(JSON.parse(json));
    },
  };
}

function makeRoomManager() {
  const worldRegistry = makeWorldRegistry();
  const providerSettingsStore = {
    getActive: () => FAKE_PROVIDER,
    getActiveForRole: () => FAKE_PROVIDER,
    getActiveForKind: () => FAKE_PROVIDER,
  };
  const personaStore = { get: (id) => ({ id, name: 'Tester' }) };
  const roomManager = new RoomManager({ worldRegistry, providerSettingsStore, personaStore, summarizeEveryNTurns: 0 });
  return { roomManager, worldRegistry };
}

describe('RoomManager player-location symmetry', () => {
  test('a player message that implies relocation moves their socket and notifies only them', async () => {
    const { roomManager, worldRegistry } = makeRoomManager();
    const { store, locationRegistry } = worldRegistry.getWorld();
    const personaId = 'persona-1';
    const startId = resolvePersonaLocation({ store, personaId, locationRegistry });

    const mover = fakeWs();
    roomManager.join(mover, { worldId: 'w1', location: startId, personaId });
    const bystander = fakeWs();
    roomManager.join(bystander, { worldId: 'w1', location: startId, personaId: 'persona-2' });

    // The holistic scene-location resolver is what moves the player now.
    mockFetchScene({ movesJson: { moves: [{ id: personaId, location: 'Market' }] } });

    await roomManager.handlePlayerMessage({ ws: mover, content: 'I walk to the market.' });

    assert.equal(store.getFact(personaId, 'location').content, 'market');
    assert.equal(mover.umweltRoom.location, 'market', 'socket moved to the new room');
    assert.ok(
      mover.sent.some((m) => m.type === 'location_changed' && m.location === 'market' && m.locationName === 'Market'),
      'the moving socket was told directly',
    );
    assert.ok(
      !bystander.sent.some((m) => m.type === 'location_changed'),
      'location_changed is never broadcast to the room, only sent to the mover',
    );
  });

  test('the player message is tagged with the pre-move room even when the resolver relocates them', async () => {
    const { roomManager, worldRegistry } = makeRoomManager();
    const { store, agentRegistry, locationRegistry } = worldRegistry.getWorld();
    const personaId = 'persona-1';
    const startId = resolvePersonaLocation({ store, personaId, locationRegistry });

    // An NPC "alice" already at the start location — with zero agent dirs, resolveResponders
    // would find her via her location fact regardless of AgentRegistry.listAgentIds(), so seed
    // that fact directly to isolate this assertion from needing a real character profile.
    store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: startId }, []);

    const ws = fakeWs();
    roomManager.join(ws, { worldId: 'w1', location: startId, personaId });
    mockFetchScene({ movesJson: { moves: [{ id: personaId, location: 'Market' }] } });

    await roomManager.handlePlayerMessage({ ws, content: 'I leave.' });

    // The player's own location fact did move...
    assert.equal(store.getFact(personaId, 'location').content, 'market');
    // ...but the player's message itself was tagged local:<startId>, still perceivable by alice.
    const visibleToAlice = store.queryVisible({ allow: [`local:${startId}`], deny: [] });
    assert.ok(visibleToAlice.some((e) => e.content === 'I leave.'));
    assert.ok(!agentRegistry.listAgentIds().includes('alice')); // confirms this scenario used zero real agent dirs
  });

  test('regression: the mover still receives the old room\'s NPC reply before their socket is moved away', async () => {
    // Bug caught via live/manual testing: moving the socket before the NPC dispatch loop meant the
    // player's own broadcast-to-old-room reply (from an NPC reacting to their parting words) never
    // reached them, because their socket had already left that room's broadcast set.
    const { roomManager, worldRegistry } = makeRoomManager();
    const { store, locationRegistry } = worldRegistry.getWorld();
    const personaId = 'persona-1';
    const startId = resolvePersonaLocation({ store, personaId, locationRegistry });
    createNpcAgent(worldDir, 'alice', { name: 'Alice', location: startId }, store);

    const mover = fakeWs();
    roomManager.join(mover, { worldId: 'w1', location: startId, personaId });
    mockFetchScene({
      dialogueReply: 'Safe travels!',
      movesJson: { moves: [{ id: personaId, location: 'Market' }] }, // only the player leaves
    });

    await roomManager.handlePlayerMessage({ ws: mover, content: 'Heading to the market, bye!' });

    const types = mover.sent.map((m) => m.type);
    assert.ok(types.includes('agent_message'), "mover received Alice's reply");
    assert.ok(types.includes('location_changed'), 'mover was still told about the move');
    assert.ok(
      types.indexOf('agent_message') < types.indexOf('location_changed'),
      "Alice's reply must arrive before the room move, not after",
    );
    assert.equal(mover.umweltRoom.location, 'market', 'the socket still ends up in the new room');
  });

  test('a party told to move together lands in one canonical room; an uninvolved agent stays put', async () => {
    const { roomManager, worldRegistry } = makeRoomManager();
    const { store, locationRegistry } = worldRegistry.getWorld();
    const personaId = 'persona-1';
    const startId = resolvePersonaLocation({ store, personaId, locationRegistry });
    createNpcAgent(worldDir, 'bob', { name: 'Bob', location: startId }, store);
    createNpcAgent(worldDir, 'carol', { name: 'Carol', location: startId }, store);

    const ws = fakeWs();
    roomManager.join(ws, { worldId: 'w1', location: startId, personaId });
    mockFetchScene({
      dialogueReply: 'Sure, let us go!',
      // Player + Bob both told to the EXACT same place; Carol is uninvolved and unmentioned.
      movesJson: { moves: [{ id: personaId, location: 'The Church' }, { id: 'bob', location: 'The Church' }] },
    });

    await roomManager.handlePlayerMessage({ ws, content: 'bob, come to the church with me' });

    const playerLoc = store.getFact(personaId, 'location').content;
    const bobLoc = store.getFact('bob', 'location').content;
    assert.equal(playerLoc, bobLoc, 'player and Bob end up in the same canonical room');
    assert.ok(locationRegistry.get(playerLoc), 'the shared destination was registered');
    assert.notEqual(playerLoc, startId, 'the party actually moved');
    assert.equal(store.getFact('carol', 'location').content, startId, 'the uninvolved agent stayed put');
  });

  test("tags the player's message and the NPC's reply with each other's id, so both remember this after moving apart", async () => {
    const { roomManager, worldRegistry } = makeRoomManager();
    const { store, locationRegistry } = worldRegistry.getWorld();
    const personaId = 'persona-1';
    const startId = resolvePersonaLocation({ store, personaId, locationRegistry });
    createNpcAgent(worldDir, 'bob', { name: 'Bob', location: startId }, store);

    const ws = fakeWs();
    roomManager.join(ws, { worldId: 'w1', location: startId, personaId });
    mockFetchScene({ dialogueReply: 'Hey there!' });

    await roomManager.handlePlayerMessage({ ws, content: 'Hi Bob' });

    const playerEvent = store.getRecentEvents(20).find((e) => e.content === 'Hi Bob');
    const bobEvent = store.getRecentEvents(20).find((e) => e.content === 'Hey there!');
    assert.ok(store.getTagsForEvent(playerEvent.id).includes('private:bob'), "Bob witnessed the player's line");
    assert.ok(store.getTagsForEvent(bobEvent.id).includes(`private:${personaId}`), "the player witnessed Bob's reply");

    // Bob's own policy (deny: ['private:*'], allow: ['private:{self}', ...]) must still resolve his
    // own private:bob tag despite that blanket deny — proves the multi-witness tagging doesn't get
    // blocked by an NPC's existing "don't leak others' private stuff to me" rule.
    const bobVisible = store.queryVisible(
      { allow: ['global', 'private:bob', `local:${startId}`], deny: ['private:*'] },
      {},
    );
    assert.ok(bobVisible.some((e) => e.content === 'Hi Bob'));
  });

  test('scene_image is also sent directly to the mover, since _concludeScene may relocate their socket before the broadcast to the old room lands', async () => {
    const { roomManager, worldRegistry } = makeRoomManager();
    const { store, locationRegistry } = worldRegistry.getWorld();
    const personaId = 'persona-1';
    const startId = resolvePersonaLocation({ store, personaId, locationRegistry });

    const ws = fakeWs();
    roomManager.join(ws, { worldId: 'w1', location: startId, personaId });
    mockFetchScene({ movesJson: { moves: [{ id: personaId, location: 'Market' }] } });

    await roomManager.handlePlayerMessage({ ws, content: 'I walk to the market and take a photo.' });

    assert.ok(ws.sent.some((m) => m.type === 'scene_image'), 'delivered straight to the mover, not just broadcast to the room they left');
    assert.equal(ws.umweltRoom.location, 'market');
  });

  test('no location signal in the message leaves the socket in its current room', async () => {
    const { roomManager, worldRegistry } = makeRoomManager();
    const { store, locationRegistry } = worldRegistry.getWorld();
    const personaId = 'persona-1';
    const startId = resolvePersonaLocation({ store, personaId, locationRegistry });

    const ws = fakeWs();
    roomManager.join(ws, { worldId: 'w1', location: startId, personaId });
    mockFetchScene({ movesJson: { moves: [] } }); // resolver reports no one moved

    await roomManager.handlePlayerMessage({ ws, content: 'Hello!' });

    assert.equal(ws.umweltRoom.location, startId);
    assert.ok(!ws.sent.some((m) => m.type === 'location_changed'));
  });
});

describe('RoomManager.moveSocket', () => {
  test('moves a socket between room entries and updates its umweltRoom', () => {
    const { roomManager } = makeRoomManager();
    const ws = fakeWs();
    roomManager.join(ws, { worldId: 'w1', location: 'start', personaId: 'p1' });

    roomManager.moveSocket(ws, 'market');

    assert.equal(ws.umweltRoom.location, 'market');
    assert.ok(!roomManager._rooms.get('w1:start')?.has(ws));
    assert.ok(roomManager._rooms.get('w1:market')?.has(ws));
  });
});
