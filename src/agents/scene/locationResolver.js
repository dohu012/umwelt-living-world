import Ajv from 'ajv';

const ajv = new Ajv();
const validate = ajv.compile({
  type: 'object',
  properties: {
    moves: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          location: { type: ['string', 'null'] },
        },
      },
    },
  },
  required: ['moves'],
});

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

/**
 * Prompt for the holistic scene-location skill — the single authority over where every
 * participant ends up after a round. Deliberately separate from per-agent state extraction
 * (stateExtractor.js): that call reasons about one character's *subjective* mood/action/
 * relationships; this one reasons about the *whole scene's* spatial outcome at once, so a
 * shared destination resolves to one place for everyone rather than each character guessing
 * independently (which is what stranded a party member before this existed).
 *
 * participants: [{ id, name, location }] — every character (player + present agents) whose
 * position this round could change, with their current location name.
 */
export function buildLocationResolvePrompt({ participants, transcript, knownLocations = [], playerId = null }) {
  const roster = participants
    .map((p) => `- ${p.name} (id=${p.id})${p.id === playerId ? ' [the human player]' : ''} is currently at "${p.location}"`)
    .join('\n');
  const validIds = participants.map((p) => p.id);

  const system = [
    `You are a silent scene-location resolver. You do not roleplay, narrate, or speak as anyone — you only track where each character physically is.`,
    `The characters in this scene are:\n${roster}`,
    `Read the dialogue and actions below and decide where EACH character is once the scene settles. Output one entry for EVERY id listed above — for anyone who did not move, repeat their current location exactly.`,
    `CRITICAL — moving together: when the dialogue has characters go somewhere together (someone says "let's go to X" / "我们一起去X" / "come with me to X" / invites others along and they agree), then ALL of them end up at X — INCLUDING the person who proposed it. Never leave the proposer or the player behind when they clearly set off with the group.`,
    `Characters who end up in the same place MUST use the EXACT same location string, character-for-character identical, so they are grouped into one room. Someone merely talking about a place, or telling someone else to leave without going themselves, has not moved.`,
    knownLocations.length > 0
      ? `Known locations so far: ${knownLocations.map((l) => l.name).join(', ')}. If a character ends up at one of these, reuse its name exactly rather than inventing new phrasing for the same place.`
      : null,
    `Output strict JSON only, on one line, no markdown code fences, no text before or after. Shape: {"moves": [{"id": string, "location": string}]}. Every "id" must be exactly one of: ${validIds.join(', ')}.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages = [{ role: 'user', content: transcript || '(nothing has happened yet)' }];

  return { system, messages };
}

/**
 * Parses the resolver output. Mirrors parseStateExtraction's graceful-degrade contract: never
 * throws — a malformed body or an id outside `validIds` degrades to "no one moved" (or drops the
 * bad entry) rather than corrupting the scene's spatial state.
 */
export function parseLocationResolve(text, validIds = []) {
  const raw = FENCE_RE.exec(text)?.[1] ?? text;
  const allowed = new Set(validIds);

  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return [];
  }
  if (!validate(parsed)) return [];

  const seen = new Set();
  const moves = [];
  for (const move of parsed.moves) {
    const location = typeof move.location === 'string' ? move.location.trim() : '';
    if (!location) continue;
    if (allowed.size > 0 && !allowed.has(move.id)) continue;
    if (seen.has(move.id)) continue; // first mention wins per participant
    seen.add(move.id);
    moves.push({ id: move.id, location });
  }
  return moves;
}
