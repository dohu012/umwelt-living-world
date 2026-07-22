import { randomUUID } from 'node:crypto';
import { JsonFileStore } from './JsonFileStore.js';

const EMPTY_DATA = { personas: {} };

/** The human player's own display identity — name + optional avatar. Same JSON-file pattern as ProviderSettingsStore. */
export class PersonaStore {
  constructor(filePath) {
    this._store = new JsonFileStore(filePath);
    this._data = null;
  }

  _load() {
    if (!this._data) this._data = this._store.load(EMPTY_DATA);
    return this._data;
  }

  _save() {
    this._store.save(this._data);
  }

  list() {
    return Object.values(this._load().personas);
  }

  get(id) {
    return this._load().personas[id];
  }

  create({ name, avatar = null }) {
    const data = this._load();
    const id = randomUUID();
    data.personas[id] = { id, name, avatar };
    this._save();
    return data.personas[id];
  }

  update(id, patch) {
    const data = this._load();
    if (!data.personas[id]) throw new Error(`no persona "${id}"`);
    data.personas[id] = { ...data.personas[id], ...patch, id };
    this._save();
    return data.personas[id];
  }

  remove(id) {
    const data = this._load();
    delete data.personas[id];
    this._save();
  }

  setAvatar(id, filename) {
    return this.update(id, { avatar: filename });
  }
}
