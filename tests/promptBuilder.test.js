import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt, SILENT_MARKER } from '../src/llm/promptBuilder.js';

const profile = { name: 'Alice', description: 'A test character.' };

function ev({ id, actor, content, tags }) {
  return { id, actor, type: 'dialogue', content, tags };
}

describe('buildPrompt scene-change markers', () => {
  test('no marker and no explanation when every event happened in the same place', () => {
    const { system, messages } = buildPrompt({
      profile,
      agentId: 'alice',
      recentEvents: [
        ev({ id: 1, actor: 'bob', content: 'Hi.', tags: ['local:tavern', 'private:bob'] }),
        ev({ id: 2, actor: 'alice', content: 'Hey.', tags: ['local:tavern', 'private:alice'] }),
      ],
      resolveLocationName: (id) => (id === 'tavern' ? 'The Rusty Anchor' : id),
    });

    assert.ok(!messages.some((m) => m.content.includes('场景切换')));
    assert.doesNotMatch(system, /场景切换/);
  });

  test('inserts a [场景切换：X] marker exactly where the location changes, and explains the convention', () => {
    const { system, messages } = buildPrompt({
      profile,
      agentId: 'alice',
      recentEvents: [
        ev({ id: 1, actor: 'bob', content: 'Hi at the tavern.', tags: ['local:tavern', 'private:bob'] }),
        ev({ id: 2, actor: 'bob', content: 'Follow me outside.', tags: ['local:outside', 'private:bob'] }),
      ],
      resolveLocationName: (id) => (id === 'outside' ? '外面' : id),
    });

    const combined = messages.map((m) => m.content).join('\n');
    assert.match(combined, /\[场景切换：外面\]/);
    // Only ever one marker for this transcript — the first event never gets one (nothing to
    // transition from yet), only the second (outside) does.
    assert.equal(combined.match(/场景切换/g)?.length, 1);
    assert.match(system, /may span more than one place/);
  });

  test('never marks the very first event, even when its location differs from "current"', () => {
    const { messages } = buildPrompt({
      profile,
      agentId: 'alice',
      recentEvents: [ev({ id: 1, actor: 'bob', content: 'Hi.', tags: ['local:tavern', 'private:bob'] })],
      resolveLocationName: (id) => id,
    });

    assert.ok(!messages.some((m) => m.content.includes('场景切换')));
  });

  test('events with no local: tag are handled gracefully (no marker, no crash)', () => {
    const { messages } = buildPrompt({
      profile,
      agentId: 'alice',
      recentEvents: [
        ev({ id: 1, actor: 'bob', content: 'Hi.', tags: ['local:tavern', 'private:bob'] }),
        ev({ id: 2, actor: 'narrator', content: 'Ambient narration.', tags: undefined }),
      ],
      resolveLocationName: (id) => id,
    });

    assert.ok(!messages.some((m) => m.content.includes('场景切换')));
    assert.ok(messages.some((m) => m.content.includes('Ambient narration.')));
  });

  test('resolveLocationName defaults to identity when not provided', () => {
    const { messages } = buildPrompt({
      profile,
      agentId: 'alice',
      recentEvents: [
        ev({ id: 1, actor: 'bob', content: 'Hi.', tags: ['local:tavern', 'private:bob'] }),
        ev({ id: 2, actor: 'bob', content: 'Come on.', tags: ['local:market', 'private:bob'] }),
      ],
    });

    const combined = messages.map((m) => m.content).join('\n');
    assert.match(combined, /\[场景切换：market\]/);
  });
});

describe('buildPrompt end-of-prompt location reminder', () => {
  test('restates the current location as the very last message, closest to generation', () => {
    const { messages } = buildPrompt({
      profile,
      agentId: 'alice',
      recentEvents: [
        ev({ id: 1, actor: 'bob', content: 'Hi.', tags: ['local:tavern', 'private:bob'] }),
        ev({ id: 2, actor: 'bob', content: 'Come outside.', tags: ['local:outside', 'private:bob'] }),
      ],
      locationName: '外面',
      resolveLocationName: (id) => (id === 'outside' ? '外面' : id),
    });

    const last = messages.at(-1);
    assert.match(last.content, /提醒：你现在身处「外面」/);
    // Coalesced into the same trailing user turn as the actual last line, not a separate message.
    assert.match(last.content, /Come outside\./);
  });

  test('omits the reminder entirely when there is no current location to state', () => {
    const { messages } = buildPrompt({
      profile,
      agentId: 'alice',
      recentEvents: [ev({ id: 1, actor: 'bob', content: 'Hi.', tags: ['local:tavern', 'private:bob'] })],
    });

    assert.ok(!messages.some((m) => m.content.includes('提醒：你现在身处')));
  });
});

describe('buildPrompt location grounding + silence, sanity (regression guard)', () => {
  test('locationLine and groupSceneInstruction still compose alongside scene markers', () => {
    const { system } = buildPrompt({
      profile,
      agentId: 'alice',
      recentEvents: [
        ev({ id: 1, actor: 'bob', content: 'Hi.', tags: ['local:tavern', 'private:bob'] }),
        ev({ id: 2, actor: 'bob', content: 'Outside.', tags: ['local:outside', 'private:bob'] }),
      ],
      roster: ['Player', 'Bob'],
      locationName: '外面',
      resolveLocationName: (id) => (id === 'outside' ? '外面' : id),
    });

    assert.match(system, /You are currently at: 外面/);
    assert.match(system, /multi-party scene/);
    assert.match(system, /场景切换/);
    assert.ok(system.includes(SILENT_MARKER));
  });
});

test('world-will events enter agent context so characters can react to executed changes', () => {
  const { messages } = buildPrompt({
    profile,
    agentId: 'alice',
    recentEvents: [{
      id: 1,
      actor: 'world-will-agent',
      type: 'world_event',
      content: '舰桥主照明熄灭，应急灯亮起。',
      tags: ['global', 'system:world-event'],
    }],
    resolveName: (id) => id === 'world-will-agent' ? '世界意志' : id,
  });
  assert.match(messages[0].content, /世界意志/);
  assert.match(messages[0].content, /应急灯亮起/);
});
