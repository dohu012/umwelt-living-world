import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ProviderSettingsStore } from '../src/settings/ProviderSettingsStore.js';

let scratchDir;
let filePath;

beforeEach(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'umwelt-provider-store-'));
  filePath = path.join(scratchDir, 'providers.json');
});

afterEach(() => {
  fs.rmSync(scratchDir, { recursive: true, force: true });
});

describe('ProviderSettingsStore', () => {
  test('create + list masks the apiKey', () => {
    const store = new ProviderSettingsStore(filePath);
    store.create({ name: 'Test', baseUrl: 'https://x', model: 'm', apiKey: 'sk-abcd1234', kind: 'dialogue' });

    const [listed] = store.list();
    assert.equal(listed.apiKey, undefined);
    assert.equal(listed.hasApiKey, true);
    assert.equal(listed.apiKeyPreview, '••••1234');
    assert.equal(listed.kind, 'dialogue');
  });

  test('first created profile of a kind auto-enables that kind', () => {
    const store = new ProviderSettingsStore(filePath);
    const created = store.create({ name: 'Test', baseUrl: 'https://x', model: 'm', kind: 'dialogue' });
    assert.equal(store.getActiveIdForKind('dialogue'), created.id);
    assert.equal(store.getActiveId(), created.id);
  });

  test('different kinds can be enabled at the same time', () => {
    const store = new ProviderSettingsStore(filePath);
    const dialogue = store.create({ name: 'Chat', baseUrl: 'https://x', model: 'chat-m', kind: 'dialogue' });
    const image = store.create({ name: 'Gen', baseUrl: 'https://x', model: 'gen-m', kind: 'image' });
    const edit = store.create({ name: 'Edit', baseUrl: 'https://x', model: 'edit-m', kind: 'imageEdit' });

    assert.equal(store.getActiveIdForKind('dialogue'), dialogue.id);
    assert.equal(store.getActiveIdForKind('image'), image.id);
    assert.equal(store.getActiveIdForKind('imageEdit'), edit.id);
    assert.deepEqual(store.getActiveByKind(), {
      dialogue: dialogue.id,
      image: image.id,
      imageEdit: edit.id,
    });
  });

  test('enabling another provider of the same kind replaces the previous one', () => {
    const store = new ProviderSettingsStore(filePath);
    const a = store.create({ name: 'A', baseUrl: 'https://x', model: 'm', kind: 'image' });
    const b = store.create({ name: 'B', baseUrl: 'https://y', model: 'm2', kind: 'image' });
    assert.equal(store.getActiveIdForKind('image'), a.id);

    store.setActive(b.id);
    assert.equal(store.getActiveIdForKind('image'), b.id);
  });

  test('deactivate clears only that kind', () => {
    const store = new ProviderSettingsStore(filePath);
    const dialogue = store.create({ name: 'Chat', baseUrl: 'https://x', model: 'm', kind: 'dialogue' });
    const image = store.create({ name: 'Gen', baseUrl: 'https://x', model: 'g', kind: 'image' });

    store.deactivate(image.id);
    assert.equal(store.getActiveIdForKind('image'), null);
    assert.equal(store.getActiveIdForKind('dialogue'), dialogue.id);
  });

  test('update without apiKey preserves the stored key', () => {
    const store = new ProviderSettingsStore(filePath);
    const { id } = store.create({ name: 'Test', baseUrl: 'https://x', model: 'm', apiKey: 'sk-keep-me' });

    store.update(id, { name: 'Renamed' });

    assert.equal(store.get(id).apiKey, 'sk-keep-me');
    assert.equal(store.get(id).name, 'Renamed');
  });

  test('update with empty-string apiKey clears the stored key', () => {
    const store = new ProviderSettingsStore(filePath);
    const { id } = store.create({ name: 'Test', baseUrl: 'https://x', model: 'm', apiKey: 'sk-clear-me' });

    store.update(id, { apiKey: '' });

    assert.equal(store.get(id).apiKey, null);
  });

  test('update with a new apiKey replaces the stored key', () => {
    const store = new ProviderSettingsStore(filePath);
    const { id } = store.create({ name: 'Test', baseUrl: 'https://x', model: 'm', apiKey: 'sk-old' });

    store.update(id, { apiKey: 'sk-new' });

    assert.equal(store.get(id).apiKey, 'sk-new');
  });

  test('remove falls back activeId to another dialogue, or null if none left', () => {
    const store = new ProviderSettingsStore(filePath);
    const a = store.create({ name: 'A', baseUrl: 'https://x', model: 'm', kind: 'dialogue' });

    store.remove(a.id);

    assert.equal(store.getActiveId(), null);
  });

  test('seedFromEnv creates separate kind entries from env vars when present', () => {
    const originalKey = process.env.STEPFUN_API_KEY;
    process.env.STEPFUN_API_KEY = 'sk-env-test';
    try {
      const store = new ProviderSettingsStore(filePath);
      store.seedFromEnv({ baseUrl: 'https://fallback', model: 'fallback-model' });

      const names = [...new Set(store.list().map((p) => p.name))];
      assert.deepEqual(names, ['StepFun']);
      const kinds = store.list().map((p) => p.kind).sort();
      assert.deepEqual(kinds, ['dialogue', 'image', 'imageEdit', 'utility']);
      assert.equal(store.getActiveForKind('dialogue').apiKey, 'sk-env-test');
      assert.equal(store.getActiveForKind('utility').apiKey, 'sk-env-test');
    } finally {
      if (originalKey === undefined) delete process.env.STEPFUN_API_KEY;
      else process.env.STEPFUN_API_KEY = originalKey;
    }
  });

  test('seedFromEnv falls back to config.nim when no STEPFUN_API_KEY is set', () => {
    const originalKey = process.env.STEPFUN_API_KEY;
    const originalStep = process.env.STEP_API_KEY;
    delete process.env.STEPFUN_API_KEY;
    delete process.env.STEP_API_KEY;
    try {
      const store = new ProviderSettingsStore(filePath);
      store.seedFromEnv({ baseUrl: 'https://fallback', model: 'fallback-model' });

      const [profile] = store.list();
      assert.equal(profile.baseUrl, 'https://fallback');
      assert.equal(profile.model, 'fallback-model');
      assert.equal(profile.kind, 'dialogue');
    } finally {
      if (originalKey !== undefined) process.env.STEPFUN_API_KEY = originalKey;
      if (originalStep !== undefined) process.env.STEP_API_KEY = originalStep;
    }
  });

  test('seedFromEnv is a no-op when providers already exist', () => {
    const store = new ProviderSettingsStore(filePath);
    store.create({ name: 'Existing', baseUrl: 'https://x', model: 'm' });

    store.seedFromEnv({ baseUrl: 'https://fallback', model: 'fallback-model' });

    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].name, 'Existing');
  });

  test('persists across store instances via the same file', () => {
    const store1 = new ProviderSettingsStore(filePath);
    const created = store1.create({ name: 'Persisted', baseUrl: 'https://x', model: 'm' });

    const store2 = new ProviderSettingsStore(filePath);
    assert.deepEqual(store2.getMasked(created.id), created);
  });

  test('migrates legacy bundled imageModel/imageEditModel into separate kind entries', () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        providers: {
          p1: {
            id: 'p1',
            name: 'Legacy',
            baseUrl: 'https://api.stepfun.com',
            model: 'step-3.7-flash',
            apiKey: 'sk-x',
            imageModel: 'step-2x-large',
            imageEditModel: 'step-image-edit-2',
          },
        },
        activeId: 'p1',
      }),
    );

    const store = new ProviderSettingsStore(filePath);
    const list = store.list();
    assert.equal(list.length, 3);
    assert.equal(store.get('p1').kind, 'dialogue');
    assert.equal(store.getActiveIdForKind('dialogue'), 'p1');
    assert.equal(store.getActiveForKind('image').model, 'step-2x-large');
    assert.equal(store.getActiveForKind('imageEdit').model, 'step-image-edit-2');
    assert.equal(store.get('p1').imageModel, undefined);
  });

  describe('role-scoped providers (character/utility aliases)', () => {
    test('getActiveIdForRole falls back for dialogue via character alias', () => {
      const store = new ProviderSettingsStore(filePath);
      const a = store.create({ name: 'A', baseUrl: 'https://x', model: 'm', kind: 'dialogue' });

      assert.equal(store.getActiveIdForRole('dialogue'), a.id);
      assert.equal(store.getActiveIdForRole('character'), a.id);
    });

    test('setActiveForRole pins a kind independently', () => {
      const store = new ProviderSettingsStore(filePath);
      const a = store.create({ name: 'A', baseUrl: 'https://x', model: 'm', kind: 'dialogue' });
      const b = store.create({ name: 'B', baseUrl: 'https://y', model: 'm', kind: 'utility' });

      store.setActiveForRole('utility', b.id);

      assert.equal(store.getActiveIdForRole('utility'), b.id);
      assert.equal(store.getActiveIdForRole('dialogue'), a.id);
    });

    test('setActiveForRole throws for an unknown provider id', () => {
      const store = new ProviderSettingsStore(filePath);
      assert.throws(() => store.setActiveForRole('utility', 'does-not-exist'));
    });

    test('remove() clears any kind pin pointing at the removed provider', () => {
      const store = new ProviderSettingsStore(filePath);
      const a = store.create({ name: 'A', baseUrl: 'https://x', model: 'm', kind: 'dialogue' });
      const b = store.create({ name: 'B', baseUrl: 'https://y', model: 'm', kind: 'utility' });
      store.setActiveForRole('utility', b.id);

      store.remove(b.id);

      assert.equal(store.getActiveIdForRole('utility'), null);
      assert.equal(store.getActiveIdForRole('dialogue'), a.id);
    });
  });
});
