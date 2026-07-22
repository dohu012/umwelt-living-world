import { buildSummaryPrompt } from './summarizer.js';

/**
 * Fires a quiet LLM call every N completed turns to roll the agent's own
 * visible history (since its last summary) into an updated summary, stored
 * back as a tagged type='memory' event — private:{self} by default, per the
 * plan doc, so a summary could later be tagged to deliberately leak.
 *
 * Runs off the *same* store.queryVisible({afterEventId}) mechanism as
 * everything else, bounded by the agent's own last memory event id — this is
 * the actual answer to "what happens when context fills up" that Phase 2
 * deliberately deferred: cursor/id-bounding exists for this, not for
 * per-turn context assembly.
 */
export async function maybeSummarize({ agentId, store, llmClient, policy, everyNTurns, words = 200, resolveName = (id) => id }) {
  if (!everyNTurns || everyNTurns <= 0) return null;

  const turnCount = store.countCompletedTurns(agentId);
  if (turnCount === 0 || turnCount % everyNTurns !== 0) return null;

  const previous = store.getLatestMemory(agentId);
  const events = store.queryVisible(policy, { afterEventId: previous?.id ?? 0 });

  const { system, messages } = buildSummaryPrompt({
    previousSummary: previous?.content ?? null,
    events,
    words,
    resolveName,
  });
  const summaryText = await llmClient.chatCompletion({ system, messages, maxTokens: Math.ceil(words * 2) });
  if (!summaryText?.trim()) return null;

  return store.append(
    {
      type: 'memory',
      actor: agentId,
      subject: agentId,
      content: summaryText.trim(),
    },
    [`private:${agentId}`],
  );
}
