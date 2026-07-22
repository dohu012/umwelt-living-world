const PLACEHOLDER_RE = /\{([^}]+)\}/g;

/**
 * Interpolates {self}/{state.X} placeholders. Returns null (not a partially
 * resolved string) if any placeholder can't be resolved, so callers can
 * treat "this rule doesn't apply yet" (e.g. no location fact) as a no-op
 * rather than crashing or silently matching a literal "{state.location}".
 */
export function interpolateTag(pattern, { self, state } = {}) {
  let unresolved = false;
  const result = pattern.replace(PLACEHOLDER_RE, (_, expr) => {
    if (expr === 'self') {
      if (self === undefined || self === null) unresolved = true;
      return self ?? '';
    }
    if (expr.startsWith('state.')) {
      const key = expr.slice('state.'.length);
      const value = state?.[key];
      if (value === undefined || value === null) unresolved = true;
      return value ?? '';
    }
    unresolved = true;
    return '';
  });
  return unresolved ? null : result;
}

/** Exact match, or a 'prefix:*' glob (must have content after the prefix). */
export function matchTag(tag, pattern) {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return tag.startsWith(prefix) && tag.length > prefix.length;
  }
  return tag === pattern;
}

/** Infinity for an exact pattern, prefix length for a glob, 0 for bare '*'. */
export function specificity(pattern) {
  if (pattern === '*') return 0;
  if (pattern.endsWith('*')) return pattern.length - 1;
  return Infinity;
}

export function mostSpecificMatch(tag, patterns) {
  let best = null;
  let bestSpecificity = -1;
  for (const pattern of patterns) {
    if (!matchTag(tag, pattern)) continue;
    const s = specificity(pattern);
    if (s > bestSpecificity) {
      best = pattern;
      bestSpecificity = s;
    }
  }
  return best;
}

export function matchesAny(tag, patterns) {
  return mostSpecificMatch(tag, patterns) !== null;
}

/** Most-specific-match-wins; a tie in specificity favors deny (fail-closed). */
export function isVisible(tag, { allow, deny } = {}) {
  const allowMatch = mostSpecificMatch(tag, allow ?? []);
  if (!allowMatch) return false;
  const denyMatch = mostSpecificMatch(tag, deny ?? []);
  if (!denyMatch) return true;
  return specificity(allowMatch) > specificity(denyMatch);
}
