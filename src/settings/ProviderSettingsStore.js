import { randomUUID } from 'node:crypto';
import { JsonFileStore } from './JsonFileStore.js';

const EMPTY_DATA = { providers: {}, activeId: null, roleActiveIds: {} };

/**
 * Each provider entry is one purpose (kind). Multiple kinds can be enabled at once;
 * within a kind, only one provider is active.
 *
 * User-facing kinds are dialogue / image / imageEdit. `utility` is an optional internal
 * pin (state extraction); if unset, RoomManager falls back to dialogue — do not surface it in UI.
 */
export const USER_KINDS = ['dialogue', 'image', 'imageEdit'];
export const KINDS = [...USER_KINDS, 'utility'];

/** @deprecated use KINDS — kept for older role-query callers */
export const ROLES = KINDS;

export const KIND_LABELS = {
  dialogue: '对话',
  image: '生图',
  imageEdit: '改图',
  utility: '工具/状态',
};

export const DEFAULT_MODELS = {
  dialogue: 'step-3.7-flash',
  // step-3.7-flash is a reasoning model — it burns real completion tokens on hidden chain-of-
  // thought before it writes anything, a largely fixed per-call cost independent of prompt size
  // (measured ~25s for the state-extraction/location-resolve utility calls regardless of how
  // short their prompt was). step-3.5-flash isn't a reasoning model, cutting that to ~10s for the
  // same calls — use it for utility so the invisible "场景结算中" tail after dialogue is shorter.
  utility: 'step-3.5-flash',
  // step-2x-large (classic text-to-image) isn't available on the subscription-plan account this
  // was seeded against — confirmed via /v1/models. step-image-edit-2 covers both kinds: it does
  // plain text-to-image via /images/generations (no source image) as well as true edits.
  image: 'step-image-edit-2',
  imageEdit: 'step-image-edit-2',
};

function mask(profile) {
  const { apiKey, ...rest } = profile;
  return {
    ...rest,
    hasApiKey: Boolean(apiKey),
    apiKeyPreview: apiKey ? `••••${apiKey.slice(-4)}` : null,
  };
}

function normalizeKind(kind) {
  if (KINDS.includes(kind)) return kind;
  // Legacy aliases
  if (kind === 'character') return 'dialogue';
  return null;
}

/**
 * Named provider profiles: one kind + one model per entry.
 * Persistence: data/settings/providers.json
 * Activation: roleActiveIds[kind] = providerId (multi-kind concurrent enable).
 * apiKey is masked in list()/getMasked; only get()/getActive* return the real key.
 */
export class ProviderSettingsStore {
  constructor(filePath) {
    this._store = new JsonFileStore(filePath);
    this._data = null;
  }

  _load() {
    if (!this._data) {
      this._data = this._store.load(EMPTY_DATA);
      this._data.roleActiveIds ??= {};
      this._migrateLegacy();
    }
    return this._data;
  }

  /**
   * Old shape bundled dialogue+image+imageEdit on one profile with a single activeId.
   * Split into one entry per kind so users can enable them independently.
   */
  _migrateLegacy() {
    const data = this._data;
    let dirty = false;
    const extras = [];

    for (const profile of Object.values(data.providers || {})) {
      if (profile.kind && KINDS.includes(profile.kind)) {
        // Drop obsolete bundled fields if still present
        if ('imageModel' in profile || 'imageEditModel' in profile) {
          delete profile.imageModel;
          delete profile.imageEditModel;
          dirty = true;
        }
        continue;
      }

      // Legacy / untyped → dialogue
      const wasActive = data.activeId === profile.id;
      profile.kind = 'dialogue';
      dirty = true;

      const imageModel = profile.imageModel;
      const imageEditModel = profile.imageEditModel;
      delete profile.imageModel;
      delete profile.imageEditModel;

      if (imageModel) {
        const imageId = randomUUID();
        extras.push({
          id: imageId,
          name: profile.name || 'Provider',
          baseUrl: profile.baseUrl,
          model: imageModel,
          apiKey: profile.apiKey ?? null,
          temperature: profile.temperature ?? 0.8,
          maxTokens: profile.maxTokens ?? 900,
          reasoningEffort: null,
          extraBody: null,
          kind: 'image',
        });
        if (wasActive) data.roleActiveIds.image = imageId;
      }
      if (imageEditModel) {
        const editId = randomUUID();
        extras.push({
          id: editId,
          name: profile.name || 'Provider',
          baseUrl: profile.baseUrl,
          model: imageEditModel,
          apiKey: profile.apiKey ?? null,
          temperature: profile.temperature ?? 0.8,
          maxTokens: profile.maxTokens ?? 900,
          reasoningEffort: null,
          extraBody: null,
          kind: 'imageEdit',
        });
        if (wasActive) data.roleActiveIds.imageEdit = editId;
      }

      if (wasActive) {
        data.roleActiveIds.dialogue = profile.id;
        // Keep activeId as dialogue pointer for older getActive() callers
        data.activeId = profile.id;
      }
    }

    for (const extra of extras) {
      data.providers[extra.id] = extra;
    }

    // Ensure activeId points at an enabled dialogue if possible
    if (!data.roleActiveIds.dialogue && data.activeId && data.providers[data.activeId]?.kind === 'dialogue') {
      data.roleActiveIds.dialogue = data.activeId;
      dirty = true;
    }

    if (dirty || extras.length) this._save();
  }

  _save() {
    this._store.save(this._data);
  }

  list() {
    const { providers } = this._load();
    return Object.values(providers).map(mask);
  }

  /** Map of kind → enabled provider id (user-facing kinds only). */
  getActiveByKind() {
    const out = {};
    for (const kind of USER_KINDS) {
      const id = this.getActiveIdForKind(kind);
      if (id) out[kind] = id;
    }
    return out;
  }

  /** Internal — includes the real apiKey. */
  get(id) {
    return this._load().providers[id];
  }

  getMasked(id) {
    const profile = this.get(id);
    return profile ? mask(profile) : undefined;
  }

  /** @deprecated prefer getActiveIdForKind('dialogue') */
  getActiveId() {
    return this.getActiveIdForKind('dialogue');
  }

  /** Internal — dialogue provider (compat). */
  getActive() {
    return this.getActiveForKind('dialogue');
  }

  getActiveIdForKind(kind) {
    const normalized = normalizeKind(kind) ?? kind;
    const { roleActiveIds, activeId, providers } = this._load();
    if (roleActiveIds[normalized]) return roleActiveIds[normalized];
    // Legacy fallback: global activeId only counts if that profile's kind matches
    if (activeId && providers[activeId]?.kind === normalized) return activeId;
    // Pre-migration files: untyped activeId treated as dialogue
    if (normalized === 'dialogue' && activeId && providers[activeId] && !providers[activeId].kind) {
      return activeId;
    }
    return null;
  }

  /** @deprecated alias */
  getActiveIdForRole(role) {
    return this.getActiveIdForKind(role);
  }

  getActiveForKind(kind) {
    const { providers } = this._load();
    const id = this.getActiveIdForKind(kind);
    return id ? providers[id] : undefined;
  }

  /** @deprecated alias */
  getActiveForRole(role) {
    return this.getActiveForKind(role);
  }

  /**
   * Enable this provider for its own kind. Other kinds stay enabled.
   * Enabling another provider of the same kind replaces the previous one.
   */
  setActive(id) {
    const data = this._load();
    const profile = data.providers[id];
    if (!profile) throw new Error(`no provider profile "${id}"`);
    const kind = normalizeKind(profile.kind) || 'dialogue';
    profile.kind = kind;
    data.roleActiveIds[kind] = id;
    if (kind === 'dialogue') data.activeId = id;
    this._save();
    return this.getMasked(id);
  }

  setActiveForRole(role, id) {
    const data = this._load();
    const profile = data.providers[id];
    if (!profile) throw new Error(`no provider profile "${id}"`);
    const kind = normalizeKind(role);
    if (!kind) throw new Error(`unknown kind "${role}", expected one of ${KINDS.join(', ')}`);
    profile.kind = kind;
    data.roleActiveIds[kind] = id;
    if (kind === 'dialogue') data.activeId = id;
    this._save();
    return this.getMasked(id);
  }

  deactivate(id) {
    const data = this._load();
    const profile = data.providers[id];
    if (!profile) throw new Error(`no provider profile "${id}"`);
    const kind = normalizeKind(profile.kind) || 'dialogue';
    if (data.roleActiveIds[kind] === id) delete data.roleActiveIds[kind];
    if (data.activeId === id) {
      data.activeId = data.roleActiveIds.dialogue ?? null;
    }
    this._save();
    return this.getMasked(id);
  }

  create({
    name,
    baseUrl,
    model,
    kind = 'dialogue',
    apiKey = null,
    temperature = 0.8,
    maxTokens = 900,
    reasoningEffort = null,
    extraBody = null,
  }) {
    const normalized = normalizeKind(kind) || 'dialogue';
    const data = this._load();
    const id = randomUUID();
    data.providers[id] = {
      id,
      name,
      baseUrl,
      model: model || DEFAULT_MODELS[normalized],
      apiKey,
      temperature,
      maxTokens,
      reasoningEffort,
      extraBody,
      kind: normalized,
    };
    // First provider of a kind auto-enables that kind (empty env users get a working slot).
    if (!this.getActiveIdForKind(normalized)) {
      data.roleActiveIds[normalized] = id;
      if (normalized === 'dialogue') data.activeId = id;
    }
    this._save();
    return this.getMasked(id);
  }

  /**
   * patch.apiKey === undefined leaves the stored key untouched; '' clears it; any other string
   * replaces it.
   */
  update(id, patch) {
    const data = this._load();
    const existing = data.providers[id];
    if (!existing) throw new Error(`no provider profile "${id}"`);

    const apiKey = patch.apiKey === undefined ? existing.apiKey : patch.apiKey || null;
    const next = { ...existing, ...patch, id, apiKey };
    if (patch.kind != null) {
      const kind = normalizeKind(patch.kind);
      if (!kind) throw new Error(`unknown kind "${patch.kind}", expected one of ${KINDS.join(', ')}`);
      next.kind = kind;
    }
    // Never persist obsolete bundled fields
    delete next.imageModel;
    delete next.imageEditModel;

    const prevKind = existing.kind;
    data.providers[id] = next;

    // If kind changed while this id was active for the old kind, move the pin.
    if (prevKind && next.kind !== prevKind && data.roleActiveIds[prevKind] === id) {
      delete data.roleActiveIds[prevKind];
      data.roleActiveIds[next.kind] = id;
      if (next.kind === 'dialogue') data.activeId = id;
      else if (data.activeId === id) data.activeId = data.roleActiveIds.dialogue ?? null;
    }

    this._save();
    return this.getMasked(id);
  }

  remove(id) {
    const data = this._load();
    delete data.providers[id];
    if (data.activeId === id) {
      data.activeId = Object.values(data.providers).find((p) => p.kind === 'dialogue')?.id ?? null;
    }
    for (const role of Object.keys(data.roleActiveIds)) {
      if (data.roleActiveIds[role] === id) delete data.roleActiveIds[role];
    }
    this._save();
  }

  /**
   * First-boot: if env has keys, seed one entry per available purpose.
   * Empty env → no-op (users add only the kinds they have).
   */
  seedFromEnv(fallbackNimConfig) {
    const data = this._load();
    if (Object.keys(data.providers).length > 0) return;

    const baseUrl = process.env.STEPFUN_BASE_URL || process.env.STEP_BASE_URL || 'https://api.stepfun.com/step_plan';
    const apiKey = process.env.STEPFUN_API_KEY || process.env.STEP_API_KEY || null;

    if (apiKey) {
      // Same display name for all three — kind badge distinguishes purpose.
      const name = 'StepFun';
      this.create({
        name,
        baseUrl,
        model: process.env.STEPFUN_MODEL || DEFAULT_MODELS.dialogue,
        kind: 'dialogue',
        apiKey,
        reasoningEffort: process.env.STEPFUN_REASONING_EFFORT || 'low',
        maxTokens: 8000,
      });
      this.create({
        name,
        baseUrl,
        model: process.env.STEP_IMAGE_MODEL || DEFAULT_MODELS.image,
        kind: 'image',
        apiKey,
      });
      this.create({
        name,
        baseUrl,
        model: process.env.STEP_IMAGE_EDIT_MODEL || DEFAULT_MODELS.imageEdit,
        kind: 'imageEdit',
        apiKey,
      });
      this.create({
        name,
        baseUrl,
        model: process.env.STEPFUN_UTILITY_MODEL || DEFAULT_MODELS.utility,
        kind: 'utility',
        apiKey,
      });
      return;
    }

    if (fallbackNimConfig) {
      this.create({
        name: 'Default',
        baseUrl: fallbackNimConfig.baseUrl,
        model: fallbackNimConfig.model,
        kind: 'dialogue',
        apiKey: fallbackNimConfig.apiKey ?? null,
        temperature: fallbackNimConfig.temperature ?? 0.8,
        maxTokens: fallbackNimConfig.maxTokens ?? 300,
      });
    }
  }
}
