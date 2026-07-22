/**
 * Seeds an agent's initial `location` fact if it doesn't have one yet — idempotent, safe to call
 * on an already-seeded agent (no-op). Shared by seed-world.js and the character-create route so
 * a freshly created character is immediately playable without a separate manual seeding step.
 */
export function seedInitialLocation(store, agentId, location) {
  const existing = store.getFact(agentId, 'location');
  if (existing) return existing;

  return store.append(
    { type: 'state', actor: 'system', subject: agentId, key: 'location', content: location },
    [`local:${location}`, `private:${agentId}`],
  );
}

/**
 * Same idempotent get-or-seed as seedInitialLocation, but for a persona entering a world for the
 * first time: falls back to the world's registered start location rather than a caller-supplied
 * one. Returns the canonical location id either way.
 */
export function resolvePersonaLocation({ store, personaId, locationRegistry }) {
  const existing = store.getFact(personaId, 'location');
  if (existing) return existing.content;

  const start = locationRegistry.getStart();
  seedInitialLocation(store, personaId, start.id);
  return start.id;
}

/**
 * Writes a subject's canonical `location` fact (idempotent — a no-op if already there). Subject-
 * agnostic: works for the player's persona or any NPC agent. Used both for explicit user-driven
 * moves and by the holistic scene-location skill to relocate whoever it resolved as having moved.
 */
export function setSubjectLocation({ store, subjectId, locationId }) {
  const existing = store.getFact(subjectId, 'location');
  if (existing?.content === locationId) return { location: locationId, changed: false };

  store.append(
    { type: 'state', actor: subjectId, subject: subjectId, key: 'location', content: locationId },
    [`local:${locationId}`, `private:${subjectId}`],
  );
  return { location: locationId, changed: true };
}

/** Explicit user-driven relocation to an already-registered canonical location. Thin persona-named alias. */
export function movePersonaToLocation({ store, personaId, locationId }) {
  return setSubjectLocation({ store, subjectId: personaId, locationId });
}
