import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WorldWillAgent } from '../src/simulation/WorldWillAgent.js';

test('world will agent turns free-form intent into a scheduled executable plan', async () => {
  let scheduled;
  const agent = new WorldWillAgent({
    providerSettingsStore: { getActiveForKind: () => ({ model: 'planner' }) },
    worldEvents: { schedulePlan: (plan) => { scheduled = plan; return { event: { id: 7 }, plan }; } },
    agentRegistry: { listAgentIds: () => ['alice'], loadProfile: () => ({ name: '爱丽丝' }) },
    locationRegistry: { list: () => [{ id: 'bridge', name: '舰桥' }] },
    createClient: () => ({
      chatCompletion: async () => '```json\n{"title":"台风登陆","kind":"typhoon","scope":"world","intensity":0.9,"rationale":"先预警再登陆","timeline":[{"at":"2026-07-23T08:00:00.000Z","phase":"warning","description":"广播发布台风预警","effects":[{"scope":"world","key":"weather.alert","value":"typhoon"}]}]}\n```',
    }),
  });
  const result = await agent.planAndSchedule({ instruction: '明早八点发布台风预警', worldTime: '2026-07-22T12:00:00.000Z' });
  assert.equal(result.event.id, 7);
  assert.equal(scheduled.instruction, '明早八点发布台风预警');
  assert.equal(scheduled.timeline[0].phase, 'warning');
});

test('world will agent reports which configured model could not be reached', async () => {
  const agent = new WorldWillAgent({
    providerSettingsStore: { getActiveForKind: () => ({ name: 'Local', model: 'tiny', baseUrl: 'http://localhost:8000' }) },
    worldEvents: { schedulePlan: () => null },
    agentRegistry: { listAgentIds: () => [] },
    locationRegistry: { list: () => [] },
    createClient: () => ({ chatCompletion: async () => { throw new Error('connection refused'); } }),
  });
  await assert.rejects(
    () => agent.planAndSchedule({ instruction: '今晚停电', worldTime: '2026-07-22T12:00:00.000Z' }),
    /Local \/ tiny.*localhost:8000.*connection refused/,
  );
});
