import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IMAGE_EXTENSIONS,
  backgroundCandidates,
  portraitCandidates,
} from '../frontend/src/features/assets/imageAssets.js';

test('generated PNG assets are probed before optional fallback formats', () => {
  assert.equal(IMAGE_EXTENSIONS[0], 'png');

  const portraits = portraitCandidates({
    worldId: '纠缠号',
    character: { id: 'dou' },
    emotion: 'neutral',
  });
  assert.match(portraits[0].src, /neutral\.png$/);

  const backgrounds = backgroundCandidates({
    worldId: '纠缠号',
    location: '食堂',
    messages: [],
  });
  assert.match(backgrounds[0].src, /background\.png$/);
});
