import { interpolateTag } from './tags.js';

const DEFAULT_POLICY = { allow: ['global', 'private:{self}'], deny: [] };

/**
 * conditionalAllow is parsed through but not evaluated in v1 (relationship-gated
 * visibility is deferred post-v1 per the plan doc) — kept in the returned shape
 * so a future implementation only needs to add an evaluation step here.
 */
export function resolve(agentId, profile, store) {
  const raw = profile.extensions?.visibility ?? DEFAULT_POLICY;
  const facts = store.getFactsForSubject(agentId);
  const state = Object.fromEntries(facts.map((f) => [f.key, f.content]));
  const ctx = { self: agentId, state };

  const allow = (raw.allow ?? []).map((p) => interpolateTag(p, ctx)).filter(Boolean);
  const deny = (raw.deny ?? []).map((p) => interpolateTag(p, ctx)).filter(Boolean);

  return { agentId, allow, deny, conditionalAllow: raw.conditionalAllow ?? [] };
}
