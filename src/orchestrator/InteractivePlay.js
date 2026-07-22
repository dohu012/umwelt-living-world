/**
 * Tags the player's message exactly like TurnRunner tags an agent's own dialogue
 * (local:<location> + private:<personaId>), so agents perceive it through the existing,
 * unmodified Policy/ContextAssembler machinery — no visibility special-casing anywhere.
 *
 * witnessIds: everyone else present to hear this (agent ids, not the player's own — that's already
 * covered by private:<personaId>). Each gets their own private:<id> tag too, so this line stays in
 * their own memory permanently via their private:{self} policy entry, independent of where their
 * location fact points later — "present when it happened" rather than "currently in the room."
 */
export function appendPlayerMessage({ store, personaId, location, content, witnessIds = [] }) {
  return store.append(
    {
      type: 'dialogue',
      actor: personaId,
      subject: personaId,
      content,
    },
    [`local:${location}`, `private:${personaId}`, ...witnessIds.map((id) => `private:${id}`)],
  );
}

/** Reserved `action` values a character's own state-extraction call can set to opt out of responding this turn. */
const SILENT_ACTIONS = new Set(['asleep', 'left']);

/**
 * Agents whose current location fact matches, sorted alphabetically for determinism, minus
 * anyone whose own `action` state (set by the state-extraction call, see TurnRunner) currently
 * says they're not available to react — asleep, or having left the scene. Agents with no
 * location fact yet (never seeded) are excluded rather than erroring — a deliberate policy, not
 * an oversight. This is the cheap, zero-LLM-call "rule layer" stage of dispatch; a heavier
 * LLM-backed director decision is a deliberately deferred next increment, not built here.
 */
export function resolveResponders({ store, agentIds, location }) {
  return agentIds
    .filter((agentId) => store.getFact(agentId, 'location')?.content === location)
    .filter((agentId) => !SILENT_ACTIONS.has((store.getFact(agentId, 'action')?.content ?? '').trim().toLowerCase()))
    .sort();
}
