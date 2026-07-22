import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../src/store/db.js';
import { EventStore } from '../src/store/EventStore.js';
import { buildSummaryPrompt } from '../src/agents/memory/summarizer.js';
import { maybeSummarize } from '../src/agents/memory/MemoryManager.js';

describe('summarizer: buildSummaryPrompt', () => {
  test('includes the ST-ported word-limit instruction', () => {
    const { system } = buildSummaryPrompt({ previousSummary: null, events: [], words: 150 });
    assert.match(system, /Limit the summary to 150 words or less/);
    assert.match(system, /use that as a base and expand with new facts/);
  });

  test('omits the existing-summary block when there is no previous summary', () => {
    const { messages } = buildSummaryPrompt({ previousSummary: null, events: [], words: 200 });
    assert.equal(messages.length, 1);
    assert.ok(!messages[0].content.includes('Existing summary'));
  });

  test('includes the existing-summary block when a previous summary is passed', () => {
    const { messages } = buildSummaryPrompt({ previousSummary: 'Alice met a stranger.', events: [], words: 200 });
    assert.match(messages[0].content, /\[Existing summary: Alice met a stranger\.\]/);
  });

  test('renders the new-events transcript', () => {
    const events = [{ actor: 'alice', content: 'Hello there.' }, { actor: 'bob', content: 'Hi Alice.' }];
    const { messages } = buildSummaryPrompt({ previousSummary: null, events, words: 200 });
    assert.match(messages[0].content, /alice: Hello there\./);
    assert.match(messages[0].content, /bob: Hi Alice\./);
  });
});

describe('MemoryManager.maybeSummarize', () => {
  function setup() {
    const db = openDb(':memory:');
    const store = new EventStore(db);
    const policy = { allow: ['private:alice'], deny: [] };
    const calls = [];
    const llmClient = {
      async chatCompletion({ system, messages }) {
        calls.push({ system, messages });
        return `Summary #${calls.length}`;
      },
    };
    return { store, policy, llmClient, calls };
  }

  function completeTurn(store, agentId, dialogue) {
    const turnId = store.startTurn(agentId, store.peekNextSeq());
    store.append({ type: 'dialogue', actor: agentId, subject: agentId, content: dialogue, turnId }, [
      `private:${agentId}`,
    ]);
    store.endTurn(turnId, 'ok');
  }

  test('does nothing when everyNTurns is 0/falsy', async () => {
    const { store, policy, llmClient } = setup();
    completeTurn(store, 'alice', 'line 1');
    const result = await maybeSummarize({ agentId: 'alice', store, llmClient, policy, everyNTurns: 0 });
    assert.equal(result, null);
  });

  test('does nothing until the turn count is a multiple of everyNTurns', async () => {
    const { store, policy, llmClient, calls } = setup();
    completeTurn(store, 'alice', 'line 1');
    completeTurn(store, 'alice', 'line 2');
    const result = await maybeSummarize({ agentId: 'alice', store, llmClient, policy, everyNTurns: 3 });
    assert.equal(result, null);
    assert.equal(calls.length, 0);
  });

  test('fires on the Nth turn and writes a tagged type=memory event', async () => {
    const { store, policy, llmClient } = setup();
    completeTurn(store, 'alice', 'line 1');
    completeTurn(store, 'alice', 'line 2');
    completeTurn(store, 'alice', 'line 3');

    const event = await maybeSummarize({ agentId: 'alice', store, llmClient, policy, everyNTurns: 3 });

    assert.ok(event);
    assert.equal(event.type, 'memory');
    assert.equal(event.subject, 'alice');
    assert.equal(event.content, 'Summary #1');
    assert.deepEqual(store.getTagsForEvent(event.id), ['private:alice']);
  });

  test('a second round only summarizes events since the first summary', async () => {
    const { store, policy, llmClient, calls } = setup();
    completeTurn(store, 'alice', 'ancient event before first summary');
    completeTurn(store, 'alice', 'line 2');
    completeTurn(store, 'alice', 'line 3');
    await maybeSummarize({ agentId: 'alice', store, llmClient, policy, everyNTurns: 3 });

    completeTurn(store, 'alice', 'line 4');
    completeTurn(store, 'alice', 'line 5');
    completeTurn(store, 'alice', 'line 6');
    await maybeSummarize({ agentId: 'alice', store, llmClient, policy, everyNTurns: 3 });

    const secondCallContent = calls[1].messages[0].content;
    assert.match(secondCallContent, /\[Existing summary: Summary #1\]/);
    assert.match(secondCallContent, /line 4/);
    assert.match(secondCallContent, /line 6/);
    assert.ok(
      !secondCallContent.includes('ancient event before first summary'),
      'events already folded into the previous summary should not be re-sent verbatim',
    );
  });

  test('getLatestMemory returns undefined before any summary exists', () => {
    const { store } = setup();
    assert.equal(store.getLatestMemory('alice'), undefined);
  });
});
