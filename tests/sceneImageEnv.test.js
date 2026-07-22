import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadSceneImageEnv, sceneImageProvidersFromStore } from '../src/skills/sceneImageEnv.js';

describe('loadSceneImageEnv', () => {
  test('UI provider apiKey overrides env aliases for image client', () => {
    const prevStep = process.env.STEP_API_KEY;
    const prevFun = process.env.STEPFUN_API_KEY;
    try {
      process.env.STEP_API_KEY = 'from-env-step';
      process.env.STEPFUN_API_KEY = 'from-env-fun';

      const env = loadSceneImageEnv({ apiKey: 'from-ui', baseUrl: 'https://api.stepfun.com' });

      assert.equal(env.STEP_API_KEY, 'from-ui');
      assert.equal(env.STEPFUN_API_KEY, 'from-ui');
      assert.equal(env.STEP_BASE_URL, 'https://api.stepfun.com/v1');
    } finally {
      if (prevStep === undefined) delete process.env.STEP_API_KEY;
      else process.env.STEP_API_KEY = prevStep;
      if (prevFun === undefined) delete process.env.STEPFUN_API_KEY;
      else process.env.STEPFUN_API_KEY = prevFun;
    }
  });

  test('normalizes provider baseUrl with /v1 for image client', () => {
    const env = loadSceneImageEnv({ apiKey: 'ui-key', baseUrl: 'https://api.stepfun.com/' });
    assert.equal(env.STEP_BASE_URL, 'https://api.stepfun.com/v1');
    assert.equal(env.STEP_API_KEY, 'ui-key');
  });

  test('split image / imageEdit providers set distinct STEP_IMAGE_* models', () => {
    const prevGen = process.env.STEP_IMAGE_MODEL;
    const prevEdit = process.env.STEP_IMAGE_EDIT_MODEL;
    try {
      process.env.STEP_IMAGE_MODEL = 'from-env-gen';
      process.env.STEP_IMAGE_EDIT_MODEL = 'from-env-edit';

      const env = loadSceneImageEnv({
        image: { apiKey: 'img-key', baseUrl: 'https://api.stepfun.com', model: 'step-2x-large' },
        imageEdit: { apiKey: 'edit-key', baseUrl: 'https://api.stepfun.com', model: 'step-image-edit-2' },
        fallback: null,
      });

      assert.equal(env.STEP_IMAGE_MODEL, 'step-2x-large');
      assert.equal(env.STEP_IMAGE_EDIT_MODEL, 'step-image-edit-2');
      assert.equal(env.STEP_API_KEY, 'img-key');
    } finally {
      if (prevGen === undefined) delete process.env.STEP_IMAGE_MODEL;
      else process.env.STEP_IMAGE_MODEL = prevGen;
      if (prevEdit === undefined) delete process.env.STEP_IMAGE_EDIT_MODEL;
      else process.env.STEP_IMAGE_EDIT_MODEL = prevEdit;
    }
  });

  test('UI step_plan baseUrl and model override .env defaults', () => {
    const prevBase = process.env.STEP_BASE_URL;
    const prevGen = process.env.STEP_IMAGE_MODEL;
    try {
      process.env.STEP_BASE_URL = 'https://api.stepfun.com/v1';
      process.env.STEP_IMAGE_MODEL = 'step-2x-large';

      const env = loadSceneImageEnv({
        image: {
          apiKey: 'ui-key',
          baseUrl: 'https://api.stepfun.com/step_plan/v1',
          model: 'step-image-edit-2',
        },
        imageEdit: null,
        fallback: null,
      });

      assert.equal(env.STEP_BASE_URL, 'https://api.stepfun.com/step_plan/v1');
      assert.equal(env.STEP_IMAGE_MODEL, 'step-image-edit-2');
      assert.equal(env.STEP_API_KEY, 'ui-key');
    } finally {
      if (prevBase === undefined) delete process.env.STEP_BASE_URL;
      else process.env.STEP_BASE_URL = prevBase;
      if (prevGen === undefined) delete process.env.STEP_IMAGE_MODEL;
      else process.env.STEP_IMAGE_MODEL = prevGen;
    }
  });

  test('sceneImageProvidersFromStore reads per-kind actives', () => {
    const store = {
      getActiveForKind(kind) {
        if (kind === 'image') return { model: 'gen' };
        if (kind === 'imageEdit') return { model: 'edit' };
        if (kind === 'dialogue') return { model: 'chat' };
        return null;
      },
    };
    assert.deepEqual(sceneImageProvidersFromStore(store), {
      image: { model: 'gen' },
      imageEdit: { model: 'edit' },
      fallback: { model: 'chat' },
    });
  });
});
