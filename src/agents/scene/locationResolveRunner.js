import { buildLocationResolvePrompt, parseLocationResolve } from './locationResolver.js';

/**
 * Runs the holistic scene-location resolution: one silent utility LLM call that decides where the
 * whole cast ends up after a round, then resolves each free-text destination through the location
 * registry into a canonical id. This is the single authority over location changes on the
 * interactive path (per-agent state extraction no longer writes location there) — so a party that
 * leaves together lands in ONE room instead of each character guessing independently.
 *
 * participants: [{ id, name, location }] where `location` is the current canonical id.
 * Returns [{ id, locationId, locationText }] for participants who actually moved to a *different*
 * canonical location. Never throws — a network/parse failure degrades to "no one moved".
 */
export async function runSceneLocationResolve({ utilClient, participants, transcript, locationRegistry, playerId = null }) {
  if (!participants?.length) return [];

  const currentById = new Map(participants.map((p) => [p.id, p.location]));
  const named = participants.map((p) => ({
    id: p.id,
    name: p.name ?? p.id,
    location: locationRegistry?.get(p.location)?.name ?? p.location ?? 'unknown',
  }));

  let parsed;
  try {
    const { system, messages } = buildLocationResolvePrompt({
      participants: named,
      transcript,
      knownLocations: locationRegistry?.list() ?? [],
      playerId,
    });
    const rawText = await utilClient.chatCompletion({ system, messages });
    parsed = parseLocationResolve(rawText, participants.map((p) => p.id));
  } catch {
    return [];
  }

  // Resolve every destination once, caching by raw text so two participants told to go to the
  // identical place collapse to the same canonical id even if the registry hasn't seen it yet.
  const idByText = new Map();
  const resolved = [];
  for (const move of parsed) {
    if (!locationRegistry) continue;
    let locationId = idByText.get(move.location);
    if (!locationId) {
      locationId = locationRegistry.ensure(move.location)?.id;
      if (!locationId) continue;
      idByText.set(move.location, locationId);
    }
    if (locationId === currentById.get(move.id)) continue; // no actual change
    resolved.push({ id: move.id, locationId, locationText: move.location });
  }
  return resolved;
}
