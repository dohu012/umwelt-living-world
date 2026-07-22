import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseStateExtraction } from '../src/llm/stateExtractionParser.js';

describe('parseStateExtraction', () => {
  test('parses a fully-populated response', () => {
    const text = JSON.stringify({
      mood: 'wary',
      action: 'wiping down glasses',
      location: 'tavern',
      relationships: [{ with: 'bob', affinityDelta: 1, trustDelta: -1, note: 'still annoyed' }],
    });
    const result = parseStateExtraction(text);
    assert.equal(result.mood, 'wary');
    assert.equal(result.action, 'wiping down glasses');
    assert.equal(result.location, 'tavern');
    assert.deepEqual(result.relationships, [{ with: 'bob', affinityDelta: 1, trustDelta: -1, note: 'still annoyed' }]);
    assert.equal(result.parseError, null);
  });

  test('accepts a relationship label field', () => {
    const text = JSON.stringify({
      relationships: [{ with: 'bob', affinityDelta: 2, trustDelta: 1, note: 'shared a drink', label: '朋友' }],
    });
    const result = parseStateExtraction(text);
    assert.equal(result.parseError, null);
    assert.equal(result.relationships[0].label, '朋友');
  });

  test('all fields optional/null means "no change this turn"', () => {
    const result = parseStateExtraction(JSON.stringify({}));
    assert.equal(result.mood, null);
    assert.equal(result.action, null);
    assert.equal(result.location, null);
    assert.deepEqual(result.relationships, []);
    assert.equal(result.parseError, null);
  });

  test('tolerates a ```json fenced response despite instructions not to fence', () => {
    const text = '```json\n{"mood": "curious"}\n```';
    const result = parseStateExtraction(text);
    assert.equal(result.mood, 'curious');
    assert.equal(result.parseError, null);
  });

  test('degrades gracefully on invalid JSON — never throws, dialogue-safe', () => {
    const result = parseStateExtraction('not json at all');
    assert.deepEqual(result, { mood: null, action: null, location: null, addressedTo: null, relationships: [], parseError: result.parseError });
    assert.match(result.parseError, /invalid JSON/);
  });

  test('degrades gracefully when relationships[].with is missing (schema violation)', () => {
    const result = parseStateExtraction(JSON.stringify({ relationships: [{ affinityDelta: 1 }] }));
    assert.equal(result.mood, null);
    assert.deepEqual(result.relationships, []);
    assert.match(result.parseError, /schema validation failed/);
  });

  test('degrades gracefully when a field has the wrong type', () => {
    const result = parseStateExtraction(JSON.stringify({ mood: 42 }));
    assert.match(result.parseError, /schema validation failed/);
  });
});
