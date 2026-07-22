import { parseStateExtraction } from '../../llm/stateExtractionParser.js';
import { buildStateExtractionPrompt, mergeRelationshipDeltas, summarizeRelationshipMap } from './stateExtractor.js';

/**
 * The task is explicitly "what changed this turn" (see the prompt's own "and only this turn" /
 * "most turns should change little or nothing"), so the model only needs whatever happened since
 * this subject's own last line — not the full up-to-30-event window ContextAssembler hands back
 * for dialogue purposes. Falls back to the full window when the subject never spoke within it
 * (their first turn, or a window that starts after their last summarization checkpoint) — there's
 * no "since" boundary to cut at, and that case is naturally small anyway.
 */
function eventsSinceOwnLastTurn(recentEvents, subjectId) {
  for (let i = recentEvents.length - 1; i >= 0; i--) {
    if (recentEvents[i].actor === subjectId) return recentEvents.slice(i + 1);
  }
  return recentEvents;
}

/**
 * Runs the dedicated, silent state-extraction call for one subject (an NPC agent or the player's
 * own persona — both are just a `subjectId` here, no agent-specific assumptions). Pure computation
 * + one LLM call; never touches the store, so it's safe to call before, outside of, or unrelated to
 * any turn/transaction bookkeeping. A network/parse failure degrades to "no state change this
 * turn" rather than throwing, mirroring parseStateExtraction's own graceful-degrade contract.
 *
 * `stateSnapshot` (subject's current mood/action/relationship facts, already computed by
 * ContextAssembler for the caller's own dialogue prompt — free to pass along here) gives the model
 * an explicit baseline instead of making it re-infer "what was true before" purely by re-reading a
 * long transcript, which is what let the transcript window shrink to just this-turn's events.
 */
export async function runStateExtraction({ utilClient, profile, subjectId, recentEvents, dialogueText, locationRegistry, resolveName = (id) => id, stateSnapshot = null }) {
  const sinceLastTurn = eventsSinceOwnLastTurn(recentEvents, subjectId);
  // 'narrator' is a scene-description voice, not a character — never a valid relationship/addressee target.
  const knownOtherIds = [...new Set(sinceLastTurn.map((e) => e.actor))].filter((id) => id !== subjectId && id !== 'narrator');
  const knownLocations = locationRegistry?.list() ?? [];

  try {
    const { system, messages } = buildStateExtractionPrompt({
      profile,
      agentId: subjectId,
      recentEvents: sinceLastTurn,
      dialogueText,
      knownOtherIds,
      knownLocations,
      resolveName,
      stateSnapshot,
    });
    // Do not impose a small token budget here. Reasoning-capable providers may spend the whole
    // allowance before emitting the JSON payload (StepFun step-3.7-flash did this with 300
    // tokens), which silently degrades every update to null. Let the utility provider's own
    // maxTokens setting control the budget instead.
    const rawText = await utilClient.chatCompletion({ system, messages });
    const result = parseStateExtraction(rawText);
    // The model refers to others by display name (so ids never leak into its free text); translate
    // relationship targets back to canonical ids for storage. Lenient: an unrecognized value is
    // kept as-is (covers a model that echoed an id, or identity resolveName).
    const nameToId = new Map(knownOtherIds.map((id) => [resolveName(id), id]));
    if (result.relationships?.length) {
      result.relationships = result.relationships.map((r) => ({ ...r, with: nameToId.get(r.with) ?? r.with }));
    }
    if (result.addressedTo != null) {
      result.addressedTo = nameToId.get(result.addressedTo) ?? result.addressedTo;
    }
    return result;
  } catch (err) {
    return {
      mood: null,
      action: null,
      location: null,
      addressedTo: null,
      relationships: [],
      parseError: `state extraction call failed: ${err.message}`,
    };
  }
}

/**
 * Writes the fact events a state-extraction result implies. Assumes the caller has already opened
 * `store.db.transaction(...)` — this never opens its own, so it commits atomically alongside
 * whatever dialogue/message event the caller is also writing this turn.
 *
 * location is resolved through the registry into a canonical id (drives the `local:*` tag / room
 * grouping) plus a separate, private-only `location_detail` fact carrying the model's free text —
 * the split `umwelt-plan.md` originally called for and never implemented. Without a
 * locationRegistry, location facts are skipped entirely rather than writing an unresolved raw
 * string back in.
 *
 * `applyLocation` (default true) lets a caller suppress location writes entirely: the interactive
 * server sets it false because the holistic scene-location skill (agents/scene/) is the sole
 * authority over where the cast ends up there, so a party leaving together stays in one room
 * instead of each character's own extraction guessing independently. The CLI batch path keeps the
 * default so its per-agent location tracking is unchanged.
 */
export function applyStateExtraction({ store, subjectId, stateResult, locationRegistry, turnId = null, applyLocation = true }) {
  let lastEventId = null;
  const selfTags = [`private:${subjectId}`];
  let locationChanged = false;
  let newLocationId = null;

  const append = (fields) => {
    lastEventId = store.append({ type: 'fact', actor: subjectId, subject: subjectId, turnId, ...fields }, selfTags).id;
  };

  if (stateResult.mood != null) {
    append({ key: 'mood', content: stateResult.mood });
  }
  if (stateResult.action != null) {
    append({ key: 'action', content: stateResult.action });
  }
  if (applyLocation && stateResult.location != null && locationRegistry) {
    const previousLocationId = store.getFact(subjectId, 'location')?.content ?? null;
    const resolved = locationRegistry.ensure(stateResult.location);
    if (resolved) {
      append({ key: 'location', content: resolved.id });
      append({ key: 'location_detail', content: stateResult.location });
      newLocationId = resolved.id;
      locationChanged = resolved.id !== previousLocationId;
    }
  }
  if (stateResult.relationships.length > 0) {
    const existingMap = store.getFact(subjectId, 'relationship')?.data ?? {};
    const mergedMap = mergeRelationshipDeltas(existingMap, stateResult.relationships);
    append({ key: 'relationship', content: summarizeRelationshipMap(mergedMap), data: mergedMap });
  }

  return { lastEventId, locationChanged, newLocationId };
}
