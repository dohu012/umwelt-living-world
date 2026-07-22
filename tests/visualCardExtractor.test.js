import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVisualCardPrompt,
  parseVisualCard,
} from '../src/agents/visual/visualCardExtractor.js';

describe('buildVisualCardPrompt', () => {
  test('passes the character sheet through in full', () => {
    // The whole point of replacing the regex summarizer: everything the author wrote about how a
    // character looks must reach the model, not a 120-char truncation of it.
    const description = 'a'.repeat(400) + ' long silver hair down to her waist';
    const { system } = buildVisualCardPrompt({
      needCharacter: true,
      profile: { name: '林晚', description, personality: 'reserved', tags: ['student'] },
    });
    assert.ok(system.includes(description), 'description must not be truncated');
    assert.ok(system.includes('林晚'));
    assert.ok(system.includes('reserved'));
    assert.ok(system.includes('student'));
  });

  test('asks only for the cards the caller needs', () => {
    const charOnly = buildVisualCardPrompt({ needCharacter: true }).system;
    assert.ok(charOnly.includes('"character"'));
    assert.ok(!charOnly.includes('"scene"'));

    const sceneOnly = buildVisualCardPrompt({ needScene: true }).system;
    assert.ok(sceneOnly.includes('"scene"'));
    assert.ok(!sceneOnly.includes('"character"'));
  });

  test('maps live status onto the visual fields it drives', () => {
    const { system } = buildVisualCardPrompt({
      needCharacter: true,
      profile: { name: 'Alice' },
      state: { mood: 'wary', action: 'wiping a glass' },
    });
    assert.match(system, /wary/);
    assert.match(system, /wiping a glass/);
    assert.match(system, /expression/);
    assert.match(system, /pose/);
  });
});

describe('parseVisualCard', () => {
  test('parses a well-formed response', () => {
    const { character, scene } = parseVisualCard(
      JSON.stringify({
        character: { name: '林晚', hair: 'long silver hair', eyes: 'pale blue eyes' },
        scene: { location: 'rooftop', time_of_day: 'sunset', key_props: ['fence'] },
      }),
    );
    assert.equal(character.hair, 'long silver hair');
    assert.equal(scene.location, 'rooftop');
    assert.deepEqual(scene.key_props, ['fence']);
  });

  test('strips markdown fences the model adds anyway', () => {
    const { character } = parseVisualCard('```json\n{"character":{"name":"Bob"}}\n```');
    assert.equal(character.name, 'Bob');
  });

  test('forces no_characters on scene cards', () => {
    // A backdrop that grows its own people breaks portrait compositing, so this is not the
    // model's decision to make.
    const { scene } = parseVisualCard('{"scene":{"location":"tavern","no_characters":false}}');
    assert.equal(scene.no_characters, true);
  });

  test('tolerates a list field returned as an empty string', () => {
    // Observed from step-3.7-flash on the very first live call: it renders empty lists as "".
    // Rejecting the card over this threw away a complete, correct character description and fell
    // back to the regex summarizer — the failure this sub-agent exists to eliminate.
    const { character, scene } = parseVisualCard(
      '{"character":{"hair":"silver","extra":""},"scene":{"location":"rooftop","key_props":"","extra":""}}',
    );
    assert.equal(character.hair, 'silver');
    assert.equal(character.extra, undefined, 'an empty list must be omitted, not kept as ""');
    assert.equal(scene.location, 'rooftop');
    assert.equal(scene.key_props, undefined);
  });

  test('wraps a bare string into a list field', () => {
    const { scene } = parseVisualCard('{"scene":{"key_props":"a single wooden bench"}}');
    assert.deepEqual(scene.key_props, ['a single wooden bench']);
  });

  test('degrades to nulls instead of throwing', () => {
    for (const bad of ['not json at all', '', '{"character":', 'null', '[1,2,3]', '{"character":"a string"}']) {
      const result = parseVisualCard(bad);
      assert.deepEqual(result, { character: null, scene: null }, `input: ${bad}`);
    }
  });

  test('drops fields that are not part of the card schema', () => {
    const { character } = parseVisualCard(
      '{"character":{"name":"Bob","backstory":"long plot summary","hair":"black"}}',
    );
    assert.equal(character.name, 'Bob');
    assert.equal(character.hair, 'black');
    assert.equal(character.backstory, undefined);
  });
});
