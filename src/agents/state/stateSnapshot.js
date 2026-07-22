/** Flattens a subject's facts_current rows into a plain {key: value} map (data wins over content, e.g. relationship's map). */
export function readStateSnapshot(store, subjectId) {
  const facts = store.getFactsForSubject(subjectId);
  const state = {};
  for (const f of facts) {
    state[f.key] = f.data ?? f.content;
  }
  return state;
}

/** Shapes a raw state snapshot into the {location, locationName, mood, action, relationship} view the frontend renders. */
export function summarizeState(state, locationRegistry) {
  const locationId = state.location ?? null;
  return {
    location: locationId,
    locationName: locationId ? locationRegistry?.get(locationId)?.name ?? locationId : null,
    mood: state.mood ?? null,
    action: state.action ?? null,
    relationship: state.relationship ?? {},
  };
}
