import Ajv from 'ajv';

const ajv = new Ajv();
const validate = ajv.compile({
  type: 'object',
  properties: {
    mood: { type: ['string', 'null'] },
    action: { type: ['string', 'null'] },
    location: { type: ['string', 'null'] },
    addressedTo: { type: ['string', 'null'] },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        required: ['with'],
        properties: {
          with: { type: 'string' },
          affinityDelta: { type: 'number' },
          trustDelta: { type: 'number' },
          note: { type: ['string', 'null'] },
          label: { type: ['string', 'null'] },
        },
      },
    },
  },
});

const EMPTY_RESULT = { mood: null, action: null, location: null, addressedTo: null, relationships: [] };

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

/**
 * Parses the state-extraction call's output. Mirrors responseParser.parseResponse's graceful-
 * degrade idiom: never throws — a malformed or missing JSON body degrades to "no state change
 * this turn" rather than losing the (already-written) dialogue event for the turn.
 */
export function parseStateExtraction(text) {
  const raw = FENCE_RE.exec(text)?.[1] ?? text;

  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch (err) {
    return { ...EMPTY_RESULT, parseError: `invalid JSON: ${err.message}` };
  }

  if (!validate(parsed)) {
    return { ...EMPTY_RESULT, parseError: `schema validation failed: ${ajv.errorsText(validate.errors)}` };
  }

  return {
    mood: parsed.mood ?? null,
    action: parsed.action ?? null,
    location: parsed.location ?? null,
    addressedTo: parsed.addressedTo ?? null,
    relationships: parsed.relationships ?? [],
    parseError: null,
  };
}
