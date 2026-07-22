import * as Policy from './Policy.js';
import * as ContextAssembler from './ContextAssembler.js';
import { mostSpecificMatch, specificity } from './tags.js';

export function explainDenial(tags, policy) {
  const reasons = [];
  for (const tag of tags) {
    const allowMatch = mostSpecificMatch(tag, policy.allow);
    if (!allowMatch) {
      reasons.push(`'${tag}': no allow pattern matches`);
      continue;
    }
    const denyMatch = mostSpecificMatch(tag, policy.deny);
    if (denyMatch && specificity(denyMatch) >= specificity(allowMatch)) {
      reasons.push(
        `'${tag}': matched allow '${allowMatch}' but overridden by more-specific (or tied) deny '${denyMatch}'`,
      );
    }
  }
  return reasons;
}

/**
 * "What does agent X currently see, and why" — the shared core behind both the inspect.js CLI
 * and the God View debug tab's API route. Never used to build an agent's actual LLM context
 * (that's ContextAssembler.assemble called directly from TurnRunner); this is read-only tooling.
 */
export function buildInspectionReport({ agentId, worldId, store, agentRegistry, limit = 30, showDenied = false }) {
  const profile = agentRegistry.loadProfile(agentId);
  const policy = Policy.resolve(agentId, profile, store);
  const context = ContextAssembler.assemble({ agentId, profile, store, policy, limit });
  const cursor = store.getCursor(agentId);

  const report = {
    agent: agentId,
    agentName: profile.name,
    world: worldId,
    cursor,
    policy: { allow: policy.allow, deny: policy.deny, conditionalAllow: policy.conditionalAllow.length },
    stateSnapshot: context.stateSnapshot,
    visibleEvents: context.visibleEvents.map((e) => ({
      id: e.id,
      seq: e.seq,
      type: e.type,
      actor: e.actor,
      content: e.content,
      tags: e.tags,
    })),
  };

  if (showDenied) {
    const all = store.getEventsWithTags();
    const visibleIds = new Set(context.visibleEvents.map((e) => e.id));
    report.denied = all
      .filter((e) => !visibleIds.has(e.id))
      .map((e) => ({
        id: e.id,
        seq: e.seq,
        type: e.type,
        actor: e.actor,
        content: e.content,
        tags: e.tags,
        reasons: explainDenial(e.tags, policy),
      }))
      .filter((e) => e.reasons.length > 0);
  }

  return report;
}
