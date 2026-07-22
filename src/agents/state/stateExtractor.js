/**
 * Builds the prompt for the dedicated, silent state-extraction call — deliberately separate from
 * the in-character dialogue call (promptBuilder.js) so neither prompt has to compromise for the
 * other: this one reasons in a flat, structured, non-roleplay voice, and never contributes text
 * that ends up in the character's own spoken voice.
 *
 * knownOtherIds is derived from this agent's own visibility-filtered recentEvents (the actors that
 * actually appear in it), not from a full agent roster — an agent should never be told about, or
 * asked to track a relationship with, someone it couldn't actually perceive this turn.
 */
export function buildStateExtractionPrompt({
  profile,
  agentId,
  recentEvents,
  dialogueText,
  knownOtherIds,
  knownLocations = [],
  resolveName = (id) => id,
  stateSnapshot = null,
}) {
  const name = profile.name;

  // Explicit baseline so the model judges "what changed" against a stated prior value instead of
  // having to re-infer it from a long transcript — this is what lets the transcript below only
  // cover events since ${name}'s own last turn rather than a large trailing window.
  const relationshipSummary = stateSnapshot?.relationship?.trim();
  const currentStateLine = stateSnapshot
    ? `${name}'s state going into this turn — mood: ${stateSnapshot.mood || '(none yet)'}; action: ${stateSnapshot.action || '(none yet)'}; relationships: ${relationshipSummary || '(none yet)'}. Only report a field below if THIS turn actually moved it from that baseline.`
    : null;

  const system = [
    `You are a silent state-tracking module for the character ${name}. You do not roleplay or speak as ${name} — you never produce dialogue, narration, or commentary.`,
    `Given only what ${name} could perceive (the events below, already filtered to ${name}'s own point of view) and the line ${name} just delivered, decide how ${name}'s internal mood, current action, location, and relationships change as a result of this turn — and only this turn.`,
    currentStateLine,
    `Output strict JSON only, on one line, no markdown code fences, no text before or after the JSON. Shape: {"mood": string|null, "action": string|null, "location": string|null, "addressedTo": string|null, "relationships": [{"with": string, "affinityDelta": number, "trustDelta": number, "note": string|null, "label": string|null}]}.`,
    `Only set a field to a non-null value if it actually changed this turn — most turns should change little or nothing. affinityDelta/trustDelta are small increments (typically -3 to 3), not absolute scores.`,
    `"addressedTo" is who the line ${name} just delivered was actually directed at, if anyone in particular — must be exactly one of the known names below, using the name exactly as written. Set it to null if ${name} was speaking to the whole group, to no one in particular, or if it's ambiguous — do not guess.`,
    `"label" is a short relationship stage/描述 from ${name}'s point of view toward that character — how ${name} currently regards them as a whole (e.g. "陌生人", "点头之交", "朋友", "挚友", "萍水相逢的旅伴", "警惕的对手", "酒馆常客"). Give a 2–6 字 label that fits the whole relationship so far, not just this turn; set it to null only when it genuinely hasn't shifted. Write labels in Chinese (中文).`,
    knownOtherIds.length > 0
      ? `"relationships"[].with and "addressedTo" must each be exactly one of these names: ${knownOtherIds.map(resolveName).join(', ')} — use the name exactly as written, and never invent a name that isn't in this list.`
      : `No other characters are visible to ${name} this turn — "relationships" must be an empty array and "addressedTo" must be null.`,
    knownLocations.length > 0
      ? `Known locations so far: ${knownLocations.map((l) => l.name).join(', ')}. If ${name} is already at one of these, reuse its name exactly rather than inventing new phrasing for the same place — only describe somewhere new if it genuinely isn't on this list.`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const transcript = recentEvents
    .filter((e) => e.content && (e.type === 'dialogue' || e.type === 'action' || e.type === 'system' || e.type === 'narration'))
    .map((e) => `[${resolveName(e.actor)}]: ${e.content}`)
    .join('\n');

  const messages = [
    {
      role: 'user',
      content: [transcript || '(nothing has happened yet)', `[${name}, just now]: ${dialogueText}`].join('\n'),
    },
  ];

  return { system, messages };
}

/**
 * Read-modify-write merge for the relationship map: facts_current overwrites the whole `data`
 * blob per (subject,key), so a partial delta must be merged against the current full map here at
 * the application layer before being written back as a new event's data — never write a bare delta.
 */
export function mergeRelationshipDeltas(existingMap, deltas) {
  const merged = { ...existingMap };
  for (const delta of deltas) {
    const prev = merged[delta.with] ?? { affinity: 0, trust: 0, notes: null };
    const next = {
      affinity: prev.affinity + (delta.affinityDelta ?? 0),
      trust: prev.trust + (delta.trustDelta ?? 0),
      notes: delta.note ?? prev.notes,
    };
    // `label` is a full value (latest non-null wins), not a delta. Only attach the key once a label
    // exists, so relationships that never got one keep the original {affinity,trust,notes} shape.
    const label = delta.label ?? prev.label;
    if (label != null) next.label = label;
    merged[delta.with] = next;
  }
  return merged;
}

/** Short human-readable summary for the relationship fact's `content` column (data carries the real map). */
export function summarizeRelationshipMap(map) {
  const entries = Object.entries(map);
  if (entries.length === 0) return '';
  return entries
    .map(([id, r]) => `${id}: affinity ${r.affinity}, trust ${r.trust}${r.label ? ` (${r.label})` : ''}`)
    .join('; ');
}
