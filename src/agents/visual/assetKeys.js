import { createHash } from 'node:crypto';
import { slugify } from '../../util/slugify.js';

function sha1(text) {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

/**
 * Content key for a character's portrait: changes only when the parts of the profile that can
 * affect how the character *looks* change. Editing `first_mes` or `system_prompt` must not
 * invalidate an existing portrait — regenerating costs an API call and, worse, hands the player a
 * different face for the same character.
 */
export function portraitKey(profile = {}) {
  const material = JSON.stringify([
    profile.name ?? '',
    profile.description ?? '',
    profile.personality ?? '',
    profile.scenario ?? '',
    [...(profile.tags ?? [])].sort(),
  ]);
  return sha1(material).slice(0, 8);
}

/**
 * Deterministic seed derived from an id, so re-rendering the same subject keeps the same face /
 * layout. StepFun takes a 32-bit-ish integer, so we fold the hash down rather than passing it raw.
 */
export function stableSeed(id) {
  return parseInt(sha1(id).slice(0, 8), 16) % 2_000_000_000;
}

/**
 * Collapse near-synonyms before they become separate cache entries. Without this, "sunset",
 * "golden hour" and "dusk" are three backgrounds of the same alley at the same time of day — three
 * API calls and three visibly different rooms for what the story treats as one moment.
 *
 * Order matters: the first pattern that matches wins, so put the specific ahead of the general.
 */
const NORMALIZERS = {
  time_of_day: [
    [/dawn|sunrise|daybreak|early morning|清晨|黎明|日出/i, 'dawn'],
    [/morning|上午|早晨/i, 'morning'],
    [/noon|midday|正午|中午/i, 'noon'],
    [/afternoon|下午|午后/i, 'afternoon'],
    [/sunset|dusk|golden hour|twilight|evening|黄昏|日落|傍晚|夕阳/i, 'dusk'],
    [/midnight|late night|深夜|午夜/i, 'night'],
    [/night|夜/i, 'night'],
  ],
  weather: [
    [/storm|thunder|暴雨|雷/i, 'storm'],
    [/rain|drizzle|downpour|wet|雨/i, 'rain'],
    [/snow|blizzard|雪/i, 'snow'],
    [/fog|mist|haze|雾|霾/i, 'fog'],
    [/overcast|cloudy|阴/i, 'overcast'],
    [/clear|sunny|fair|晴/i, 'clear'],
  ],
  mood: [
    [/tense|hostile|dangerous|threat|紧张|危险|敌意/i, 'tense'],
    [/romantic|intimate|tender|浪漫|亲密|温情/i, 'romantic'],
    [/melanchol|nostalg|lonely|somber|sad|怀旧|寂寞|忧郁|伤感/i, 'melancholy'],
    [/warm|cozy|peaceful|calm|quiet|gentle|温暖|平静|安宁|安静/i, 'calm'],
    [/lively|bustling|festive|cheerful|热闹|欢快/i, 'lively'],
    [/eerie|ominous|unsettling|诡异|阴森|不祥/i, 'eerie'],
  ],
};

function normalizeField(field, value) {
  const text = (value ?? '').trim();
  if (!text) return '';
  for (const [pattern, canonical] of NORMALIZERS[field] ?? []) {
    if (pattern.test(text)) return canonical;
  }
  // Unrecognised but non-empty: keep a slug so a genuinely novel condition still gets its own
  // background rather than silently reusing the default one.
  return slugify(text, { fallback: '' }).split('-').slice(0, 2).join('-');
}

/**
 * Cache key for one background variant of a location: same place, different time / weather / mood
 * gets its own image, but only along those three axes so the variant count per location stays
 * bounded no matter how floridly the model describes the room.
 */
export function backgroundVariantKey(sceneCard = {}) {
  const parts = ['time_of_day', 'weather', 'mood'].map((field) =>
    normalizeField(field, sceneCard[field]),
  );
  return parts.every((p) => !p) ? 'default' : parts.map((p) => p || 'any').join('-');
}

export const portraitFileName = (key) => `portrait-${key}.png`;
export const backgroundFileName = (variantKey) => `bg-${variantKey}.png`;
