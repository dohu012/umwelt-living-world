/**
 * Ported from st/public/scripts/extensions/memory/index.js (defaultPrompt/defaultTemplate),
 * the "rolling/incremental summary" pattern: the existing summary (if any) is fed back in as
 * context and the model is told to expand it with new facts, rather than starting from scratch
 * each time. ST injects the prior summary via a persistent extension prompt and asks a separate
 * quiet generation to update it; we do the equivalent in one self-contained call since our
 * "quiet" calls aren't threaded through an ongoing chat UI.
 */
const SUMMARY_TEMPLATE = (summary) => `[Existing summary: ${summary}]`;

function summaryInstruction(words) {
  return (
    'Ignore previous instructions. Summarize the most important facts and events in the story so far. ' +
    'If a summary already exists in your memory, use that as a base and expand with new facts. ' +
    `Limit the summary to ${words} words or less. Your response should include nothing but the summary.`
  );
}

/**
 * events: rows with {actor, content} — the agent's own visible history since the last summary.
 * previousSummary: string | null.
 * resolveName: (actorId) => display name, so the stored summary reads in names not ids. Identity by default.
 */
export function buildSummaryPrompt({ previousSummary, events, words = 200, resolveName = (id) => id }) {
  const transcript = events
    .filter((e) => e.content)
    .map((e) => `${resolveName(e.actor)}: ${e.content}`)
    .join('\n');

  const parts = [];
  if (previousSummary) parts.push(SUMMARY_TEMPLATE(previousSummary));
  parts.push(`[New events]\n${transcript || '(none)'}`);

  return {
    system: summaryInstruction(words),
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  };
}
