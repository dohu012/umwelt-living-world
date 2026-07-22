/**
 * Lowercase, dash-separated id derived from free text, falling back to `fallback` if nothing
 * survives. Unicode letters and numbers are valid id characters, so names such as Chinese
 * character names can also be used as directory names.
 */
export function slugify(name, { fallback = 'item' } = {}) {
  const base = name
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return base || fallback;
}
