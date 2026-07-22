import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgentPortraitGeneration, scheduleAgentPortraitGeneration } from '../src/skills/portraitGenerate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENE_IMAGE_ROOT = path.resolve(__dirname, '../scene-image');

describe('portraitGenerate', () => {
  test('runAgentPortraitGeneration requires agentDir', async () => {
    const result = await runAgentPortraitGeneration({});
    assert.equal(result.ok, false);
    assert.match(result.error, /agentDir/);
  });

  test('portrait script exists for on-create generation', () => {
    const script = path.join(SCENE_IMAGE_ROOT, 'scripts', 'generate_agent_portraits.py');
    assert.ok(fs.existsSync(script), script);
  });

  test('scheduleAgentPortraitGeneration is non-blocking', async () => {
    let done = false;
    let resolveDone;
    const completed = new Promise((resolve) => { resolveDone = resolve; });
    scheduleAgentPortraitGeneration(
      { agentDir: '/tmp/umwelt-missing-agent-dir-for-test', agentId: 'missing' },
      {
        onDone: () => {
          done = true;
          resolveDone();
        },
      },
    );
    assert.equal(done, false);
    await Promise.race([
      completed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('portrait callback timed out')), 5_000)),
    ]);
    assert.equal(done, true);
  });
});
