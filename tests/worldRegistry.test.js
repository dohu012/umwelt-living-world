import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { WorldRegistry } from '../src/server/WorldRegistry.js';

let tmp;
let reg;

const PROFILE = {
  name: 'Alice',
  description: 'A test bartender.',
  extensions: { visibility: { allow: ['global', 'private:{self}', 'local:{state.location}'], deny: ['private:*'] } },
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-worldreg-'));
  reg = new WorldRegistry({ projectRoot: tmp, dataDir: 'world' });

  // Source world "src" with one character card and some played-out context.
  const agentDir = path.join(tmp, 'world', 'src', 'agents', 'alice');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'profile.json'), JSON.stringify(PROFILE));

  const src = reg.getWorld('src');
  const tavern = src.locationRegistry.ensure('Tavern'); // registers a non-default location
  src.store.append({ type: 'dialogue', actor: 'alice', subject: 'alice', content: 'Evening.' }, ['local:start', 'private:alice']);
  src.store.append({ type: 'state', actor: 'system', subject: 'alice', key: 'location', content: tavern.id }, ['private:alice']);
  src.store.append({ type: 'fact', actor: 'alice', subject: 'alice', key: 'mood', content: 'wry' }, ['private:alice']);
});

afterEach(() => {
  reg.closeAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('WorldRegistry.copyWorld', () => {
  test('keepContext clones the full event log, locations and agent state', async () => {
    const srcEvents = reg.getWorld('src').store.getEventsWithTags().length;

    const id = await reg.copyWorld('src', { name: 'kept', keepContext: true });
    assert.equal(id, 'kept');

    const copy = reg.getWorld(id);
    assert.deepEqual(copy.agentRegistry.listAgentIds(), ['alice'], 'character card copied');
    assert.equal(copy.store.getEventsWithTags().length, srcEvents, 'full event history carried over');
    assert.equal(copy.store.getFact('alice', 'location').content, 'tavern', 'position preserved');
    assert.equal(copy.store.getFact('alice', 'mood').content, 'wry', 'mood/state preserved');
    assert.ok(copy.locationRegistry.get('tavern'), 'the Tavern location travelled with the clone');
  });

  test('clearContext keeps only the characters — fresh event store, reset state and locations', async () => {
    const id = await reg.copyWorld('src', { name: 'cleared', keepContext: false });
    assert.equal(id, 'cleared');

    const copy = reg.getWorld(id);
    assert.deepEqual(copy.agentRegistry.listAgentIds(), ['alice'], 'character card copied unchanged');

    // Only the fresh seed location fact exists — no dialogue, no mood.
    assert.equal(copy.store.getFact('alice', 'mood'), undefined, 'mood reset');
    assert.equal(copy.store.getFact('alice', 'location').content, 'start', 're-seeded to Start');
    assert.ok(!copy.locationRegistry.get('tavern'), 'played-in locations are gone');
    assert.deepEqual(copy.locationRegistry.list().map((l) => l.id), ['start'], 'location map reset to just Start');
    assert.equal(copy.store.getEventsWithTags().some((e) => e.content === 'Evening.'), false, 'no prior dialogue');
  });

  test('names collide-safely (appends a suffix)', async () => {
    const a = await reg.copyWorld('src', { name: 'dup', keepContext: false });
    const b = await reg.copyWorld('src', { name: 'dup', keepContext: false });
    assert.equal(a, 'dup');
    assert.equal(b, 'dup-2');
  });
});

describe('WorldRegistry.createFromTemplate', () => {
  test('creates a clean world from a template with locations, metadata and seeded agents', () => {
    const templatesRoot = path.join(tmp, 'data', 'templates', '纠缠号');
    fs.mkdirSync(path.join(templatesRoot, 'agents', 'he'), { recursive: true });
    fs.writeFileSync(
      path.join(templatesRoot, 'agents', 'he', 'profile.json'),
      JSON.stringify({ name: '赫', description: 'Captain', first_mes: '巡视员，你终于来了。' }),
    );
    fs.writeFileSync(
      path.join(templatesRoot, 'locations.json'),
      JSON.stringify({
        startId: '食堂',
        locations: { 食堂: { id: '食堂', name: '食堂', description: 'mess hall' } },
      }),
    );
    fs.writeFileSync(
      path.join(templatesRoot, 'world.json'),
      JSON.stringify({
        name: '纠缠号',
        subtitle: '退相干之夜',
        intro: { version: 1, openingNarration: '舱门闭合。', openingAgentId: 'he' },
      }),
    );

    const world = reg.createFromTemplate('纠缠号', { name: '纠缠号' });
    assert.equal(world.worldId, '纠缠号');
    assert.deepEqual(world.agentRegistry.listAgentIds(), ['he']);
    assert.equal(world.locationRegistry.getStartId(), '食堂');
    assert.equal(world.store.getFact('he', 'location').content, '食堂');
    assert.equal(world.metadata?.intro?.version, 1);
    assert.equal(world.store.getEventsWithTags().length, 1, 'only seed location fact');
  });
});

describe('WorldRegistry.deleteWorld', () => {
  test('removes the world directory and drops it from the registry', () => {
    reg.getWorld('src'); // ensure it's opened/cached first
    assert.ok(reg.worldExists('src'));

    reg.deleteWorld('src');

    assert.ok(!reg.worldExists('src'), 'directory gone');
    assert.ok(!reg.listWorldIds().includes('src'), 'no longer listed');
    assert.ok(!fs.existsSync(path.join(tmp, 'world', 'src')));
  });

  test('throws for an unknown world', () => {
    assert.throws(() => reg.deleteWorld('nope'), /not found/);
  });
});
