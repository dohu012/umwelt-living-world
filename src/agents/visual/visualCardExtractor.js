/**
 * Field name → declared type, mirroring scene-image/src/schemas.py CharacterCard / SceneCard.
 * Keep the two in sync when either changes: these values are validated by pydantic on the Python
 * side, so a field arriving as the wrong type there aborts the whole generation.
 */
const CHARACTER_FIELDS = {
  name: 'string',
  gender_presentation: 'string',
  age_range: 'string',
  hair: 'string',
  eyes: 'string',
  face: 'string',
  body: 'string',
  outfit: 'string',
  accessories: 'string',
  expression: 'string',
  pose: 'string',
  personality_visual_cues: 'string',
  art_style: 'string',
  extra: 'list',
};

const SCENE_FIELDS = {
  location: 'string',
  time_of_day: 'string',
  weather: 'string',
  lighting: 'string',
  mood: 'string',
  key_props: 'list',
  camera: 'string',
  art_style: 'string',
  no_characters: 'boolean',
  extra: 'list',
};

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

function fieldList(fields) {
  return Object.keys(fields)
    .map((f) => `"${f}"`)
    .join(', ');
}

/**
 * Prompt for the visual-card sub-agent — the Hook C+D authority that turns a character sheet and
 * the round's dialogue into the structured cards scene-image's prompt builders consume.
 *
 * Deliberately one call for both cards: the portrait and the background are described by the same
 * transcript, and a single pass keeps them consistent (a character "soaked from the rain" and a
 * scene that is raining) while halving the latency.
 *
 * The full character profile goes in verbatim — this is the whole point of replacing the old regex
 * summarizer, which could only see a hardcoded word list and truncated `description` to 120 chars,
 * so anything the author wrote about a character's looks never reached the image model.
 */
export function buildVisualCardPrompt({
  needCharacter = false,
  needScene = false,
  transcript = '',
  profile = null,
  state = null,
  locationName = '',
  knownCharacter = null,
  knownScene = null,
} = {}) {
  const wanted = [];
  if (needCharacter) wanted.push(`"character": { ${fieldList(CHARACTER_FIELDS)} }`);
  if (needScene) wanted.push(`"scene": { ${fieldList(SCENE_FIELDS)} }`);

  const sheet = profile
    ? [
        profile.name ? `Name: ${profile.name}` : null,
        profile.description ? `Description: ${profile.description}` : null,
        profile.personality ? `Personality: ${profile.personality}` : null,
        profile.scenario ? `Scenario: ${profile.scenario}` : null,
        profile.tags?.length ? `Tags: ${profile.tags.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const status = state
    ? [
        state.mood ? `current mood: ${state.mood}` : null,
        state.action ? `current action: ${state.action}` : null,
      ]
        .filter(Boolean)
        .join('; ')
    : '';

  const system = [
    `You are a silent visual-context extractor for an illustrated chat game. You do not roleplay, narrate, or speak as anyone — you only compress what is described into structured visual fields.`,
    needCharacter && sheet
      ? `The character sheet you are describing:\n${sheet}`
      : null,
    needCharacter && status
      ? `That character's live status this round — map "current mood" onto "expression" and "current action" onto "pose": ${status}`
      : null,
    needScene && locationName
      ? `The scene takes place at: ${locationName}. Put that in "location", elaborated with whatever physical detail the dialogue gives you.`
      : null,
    knownCharacter
      ? `A previous card for this character (merge incrementally — keep old values unless the text below contradicts them):\n${JSON.stringify(knownCharacter)}`
      : null,
    knownScene
      ? `A previous card for this scene (merge incrementally):\n${JSON.stringify(knownScene)}`
      : null,
    `Write every field value in English — it feeds an image model that is most reliable in English — even when the source text is in another language.`,
    `CRITICAL — never invent. If the sheet and dialogue do not tell you a character's eye colour, leave "eyes" as "". An empty field is always correct; a guessed one puts something on screen the author never wrote. Same for scene props: do not add buildings or objects nobody mentioned.`,
    needCharacter
      ? `"personality_visual_cues" holds only traits that change how a body reads on screen (reserved posture, proud bearing) — never plot summary. "extra" is for leftover visual details that fit no other field.`
      : null,
    needCharacter
      ? `CRITICAL — the character card describes the PERSON ONLY, never their surroundings. No setting, no scenery, no time of day, and no environmental lighting in any field — "art_style" in particular means rendering technique ("anime, soft cel shading"), never "sunset lighting" or "on a rooftop". This portrait is cut out and composited over a separately generated background, so a baked-in setting makes it unusable.`
      : null,
    needScene
      ? `"no_characters" must be true: the background is a backdrop that portraits get composited onto, so it must not grow its own people.`
      : null,
    `Output strict JSON only, on one line, no markdown code fences, no text before or after. Shape: {${wanted.join(', ')}}. Use "" for unknown strings and [] for unknown lists.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages = [{ role: 'user', content: transcript || '(no dialogue yet — describe from the character sheet alone)' }];

  return { system, messages };
}

/**
 * Coerces each field to the type the Python schema declares, rather than rejecting the card when
 * one field arrives in the wrong shape.
 *
 * This tolerance is load-bearing, not defensive padding: models reliably return `"extra": ""` for
 * an empty list. Failing the whole card over that would throw away a perfectly good description of
 * the character and silently fall back to the regex summarizer — the exact failure this sub-agent
 * exists to eliminate.
 */
function coerceCard(source, fields) {
  const out = {};
  for (const [field, type] of Object.entries(fields)) {
    const value = source[field];
    if (value == null) continue;

    if (type === 'list') {
      const list = Array.isArray(value) ? value : [value];
      const cleaned = list.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
      if (cleaned.length) out[field] = cleaned;
    } else if (type === 'boolean') {
      if (typeof value === 'boolean') out[field] = value;
    } else if (typeof value === 'string' && value.trim()) {
      out[field] = value.trim();
    }
  }
  return out;
}

/**
 * Parses the sub-agent's output. Mirrors parseLocationResolve's graceful-degrade contract: never
 * throws — a malformed body degrades to `{character: null, scene: null}`, which callers treat as
 * "fall back to the Python regex summarizer" rather than as a hard failure.
 */
export function parseVisualCard(text) {
  const raw = FENCE_RE.exec(text)?.[1] ?? text;

  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return { character: null, scene: null };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { character: null, scene: null };
  }

  const isCard = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  const character = isCard(parsed.character) ? coerceCard(parsed.character, CHARACTER_FIELDS) : null;
  const scene = isCard(parsed.scene)
    ? { ...coerceCard(parsed.scene, SCENE_FIELDS), no_characters: true }
    : null;

  return { character, scene };
}
