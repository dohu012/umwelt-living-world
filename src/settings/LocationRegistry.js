import { JsonFileStore } from './JsonFileStore.js';
import { slugify } from '../util/slugify.js';

const EMPTY_DATA = { startId: null, locations: {} };

/**
 * Per-world canonical location registry (data/world/<world>/locations.json). The model may
 * freely propose new locations via `ensure()` — there is no approval gate, by design (a known
 * accepted tradeoff: two characters describing "the same place" in different words can still
 * split into two registry entries; this registry only nudges reuse, it doesn't guarantee dedup).
 */
export class LocationRegistry {
  constructor(filePath) {
    this._store = new JsonFileStore(filePath);
    this._data = null;
  }

  _load() {
    if (!this._data) {
      this._data = this._store.load(EMPTY_DATA);
      if (Object.keys(this._data.locations).length === 0 && !this._data.startId) {
        // First-boot convenience, mirrors ProviderSettingsStore.seedFromEnv: a world should
        // never be without at least one known location to fall back to.
        const start = this._create(this._data, { name: 'Start' });
        this._data.startId = start.id;
        this._save();
      }
    }
    return this._data;
  }

  _save() {
    this._store.save(this._data);
  }

  list() {
    return Object.values(this._load().locations);
  }

  get(id) {
    return this._load().locations[id];
  }

  getStartId() {
    return this._load().startId;
  }

  getStart() {
    const data = this._load();
    return data.startId ? data.locations[data.startId] : undefined;
  }

  setStart(id) {
    const data = this._load();
    if (!data.locations[id]) throw new Error(`no location "${id}"`);
    data.startId = id;
    this._save();
  }

  /**
   * Records a generated background variant for a location. `backgrounds` and `currentVariant` are
   * optional fields absent from every entry `_create` has ever written, so older locations.json
   * files need no migration — they simply have no backgrounds until one is generated.
   */
  setBackground(id, variantKey, meta) {
    const data = this._load();
    const entry = data.locations[id];
    if (!entry) return null;
    entry.backgrounds ??= {};
    entry.backgrounds[variantKey] = { ...meta, createdAt: new Date().toISOString() };
    entry.currentVariant = variantKey;
    this._save();
    return entry.backgrounds[variantKey];
  }

  /** The named variant, or the location's most recently generated one when `variantKey` is omitted. */
  getBackground(id, variantKey = null) {
    const entry = this._load().locations[id];
    if (!entry?.backgrounds) return null;
    const key = variantKey ?? entry.currentVariant;
    return key ? (entry.backgrounds[key] ?? null) : null;
  }

  _create(data, { name, description = null }) {
    const base = slugify(name, { fallback: 'place' });
    let candidate = base;
    let n = 2;
    while (data.locations[candidate]) candidate = `${base}-${n++}`;
    const entry = { id: candidate, name, description };
    data.locations[candidate] = entry;
    return entry;
  }

  create({ name, description = null }) {
    const data = this._load();
    const entry = this._create(data, { name, description });
    this._save();
    return entry;
  }

  /**
   * Auto-registration primitive: reuse an existing entry if `rawText` slug- or name-matches one,
   * otherwise register a brand-new one from it. Returns null for empty/blank input (treated the
   * same as "no location signal" by callers, matching the state-extraction parser's null idiom).
   */
  ensure(rawText) {
    const trimmed = rawText?.trim();
    if (!trimmed) return null;

    const data = this._load();
    const slug = slugify(trimmed, { fallback: 'place' });
    if (data.locations[slug]) return data.locations[slug];

    const lower = trimmed.toLowerCase();
    const byName = Object.values(data.locations).find((loc) => loc.name.toLowerCase() === lower);
    if (byName) return byName;

    const entry = this._create(data, { name: trimmed });
    this._save();
    return entry;
  }
}
