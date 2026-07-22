import { SILENT_MARKER } from '../llm/promptBuilder.js';

/** Not a character — no profile, no state extraction, no memory. A thin, stateless third-person voice
 * that only fires when nobody else responded this round (see RoomManager._runScene): either because
 * no NPC was present, or because every present NPC chose to stay silent (see TurnRunner's SILENT_MARKER
 * handling). Deliberately reuses the flat, non-chat-role transcript style from stateExtractor.js rather
 * than promptBuilder.js's assistant/user split — the narrator isn't "replying" to anyone, so that
 * framing would be misleading here.
 */
const NARRATOR_ACTOR = 'narrator';

function buildNarratorPrompt({ locationName, recentEvents, resolveName }) {
  const system = [
    'You are an objective third-person scene narrator/environment voice. You do not roleplay or ' +
      'speak as any character, and you never invent dialogue or reactions for anyone.',
    `Describe, briefly and in third person, what happens at ${locationName || 'this location'} as a ` +
      'result of what was just said or done — atmosphere, the environment, or the natural, impersonal ' +
      "consequence of the moment. No one else is present to react, so don't attribute a reaction to " +
      'any character.',
    `If there is genuinely nothing worth describing, output exactly ${SILENT_MARKER} and nothing else.`,
    'Output only the narration text itself (or the silence marker) — no labels, no quotation marks, no meta-commentary.',
    'Write the narration in Chinese (中文).',
  ].join('\n\n');

  const transcript = recentEvents
    .filter((e) => e.content && (e.type === 'dialogue' || e.type === 'action' || e.type === 'narration'))
    .map((e) => `[${resolveName(e.actor)}]: ${e.content}`)
    .join('\n');

  return {
    system,
    messages: [{ role: 'user', content: transcript || '(nothing has happened yet)' }],
  };
}

/**
 * One LLM call, no persistence beyond the narration event itself. Returns null when the narrator
 * declined to speak (SILENT_MARKER) or the call failed — callers treat both the same as "no narration
 * this round," mirroring runStateExtraction's graceful-degrade contract.
 */
export async function runNarratorTurn({ store, locationRegistry, location, utilityLlmClient, resolveName = (id) => id, witnessIds = [] }) {
  const locationName = locationRegistry?.get(location)?.name ?? location;
  const recentEvents = store.queryVisible({ allow: ['global', `local:${location}`] }, { limit: 30 });
  const { system, messages } = buildNarratorPrompt({ locationName, recentEvents, resolveName });

  let rawText;
  try {
    rawText = await utilityLlmClient.chatCompletion({ system, messages });
  } catch {
    return null;
  }

  const text = rawText.trim();
  if (!text || text === SILENT_MARKER) return null;

  // local:<location> only — a narration describing this room shouldn't bleed into another room's
  // context just because 'global' would make it universally visible (see the tavern/back-alley bug
  // this fixed: Bob was reading narration about a scene he was never in). private:<id> per witness
  // (player + whoever was present) so this stays in each of THEIR own memories permanently too,
  // same as an ordinary dialogue line — everyone here experienced this moment together.
  const event = store.append(
    { type: 'narration', actor: NARRATOR_ACTOR, subject: null, content: text },
    [`local:${location}`, ...witnessIds.map((id) => `private:${id}`)],
  );
  return { content: text, event };
}
