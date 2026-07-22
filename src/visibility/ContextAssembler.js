/**
 * Tag-filtered trailing window, not per-turn-cursor-bounded (see Phase 2's
 * "Context assembly window" decision — the per-agent turn cursor is
 * bookkeeping for event-driven scheduling, not this turn's boundary).
 *
 * It *is* bounded by the agent's latest memory checkpoint, once one exists:
 * everything the checkpoint already folded in is represented by
 * memorySummary instead of being replayed verbatim, so the raw transcript
 * shrinks back down after every summarization round rather than growing
 * forever with memorySummary just piled on top of it.
 */
export function assemble({ agentId, profile, store, policy, limit = 30 }) {
  const facts = store.getFactsForSubject(agentId);
  const stateSnapshot = Object.fromEntries(facts.map((f) => [f.key, f.content]));
  const latestMemory = store.getLatestMemory(agentId);
  const visibleEvents = store.queryVisible(policy, { limit, afterEventId: latestMemory?.id ?? 0 });

  return {
    profile,
    stateSnapshot,
    memorySummary: latestMemory?.content ?? null,
    visibleEvents,
    loreHits: [], // milestone 5
  };
}
