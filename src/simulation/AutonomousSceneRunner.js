import { TurnRunner } from '../orchestrator/TurnRunner.js';
import { createLLMClient } from '../llm/LLMClient.js';

const ACTION_LABELS = {
  idle: '停留', work: '工作', inspect: '调查', eat: '进食', sleep: '休息',
  socialize: '想找人交流', shelter: '避难', deliberate: '思考抉择', confront: '质问', report: '报告',
};

export class AutonomousSceneRunner {
  constructor({
    store, agentRegistry, locationRegistry, worldDir, providerSettingsStore,
    summarizeEveryNTurns = 0, turnRunner = null, createClient = createLLMClient,
  }) {
    this.store = store;
    this.agentRegistry = agentRegistry;
    this.locationRegistry = locationRegistry;
    this.worldDir = worldDir;
    this.providerSettingsStore = providerSettingsStore;
    this.createClient = createClient;
    this.turnRunner = turnRunner ?? new TurnRunner({
      store,
      llmClient: null,
      agentRegistry,
      worldDir,
      locationRegistry,
      summarizeEveryNTurns,
      applyTurnLocation: false,
    });
  }

  _name(id) {
    try { return this.agentRegistry.loadProfile(id)?.name ?? id; } catch { return id; }
  }

  async run(payload, worldTime) {
    const location = payload?.location;
    const requested = payload?.participants ?? [];
    const participants = requested.filter(({ agentId }) =>
      this.store.getFact(agentId, 'location')?.content === location,
    );
    if (!location || participants.length < 2) return { status: 'skipped', reason: 'participants_moved' };

    const provider = this.providerSettingsStore?.getActiveForKind?.('dialogue')
      ?? this.providerSettingsStore?.getActive?.();
    if (!provider) return { status: 'skipped', reason: 'no_dialogue_provider' };

    const utilityProvider = this.providerSettingsStore?.getActiveForKind?.('utility') ?? provider;
    const llmClient = this.createClient({ nim: provider });
    const utilityLlmClient = this.createClient({ nim: utilityProvider });
    const agentIds = participants.map((item) => item.agentId);
    const names = agentIds.map((id) => this._name(id));
    const locationName = this.locationRegistry.get(location)?.name ?? location;
    const sceneId = `${location}:${payload.triggeredAt ?? worldTime}`;
    const tags = [`local:${location}`, 'system:autonomous', ...agentIds.map((id) => `private:${id}`)];
    const situation = participants
      .map(({ agentId, action }) => `${this._name(agentId)}正在${ACTION_LABELS[action] ?? action}`)
      .join('，');

    this.store.append({
      type: 'narration', actor: 'system', subject: location, key: 'autonomous_scene_started',
      content: `在${locationName}，${situation}。没有玩家介入，人物会依照自己的性格自然交流或行动。`,
      data: { autonomous: true, sceneId, location, participants: agentIds }, ts: worldTime,
    }, tags);

    const turns = [];
    for (const agentId of agentIds) {
      const result = await this.turnRunner.runTurn(agentId, {
        llmClient,
        utilityLlmClient,
        resolveName: (id) => id === 'system' ? '世界' : this._name(id),
        roster: names.filter((name) => name !== this._name(agentId)),
        witnessIds: agentIds,
        extraTags: ['system:autonomous'],
        eventData: { autonomous: true, sceneId, location },
        eventTs: worldTime,
      });
      if (!result.silent) turns.push({ agentId, dialogueText: result.dialogueText });
    }

    this.store.append({
      type: 'autonomous_scene', actor: 'system', subject: location, key: 'completed',
      content: `${names.join('、')}的自主场景结束。`,
      data: { autonomous: true, sceneId, location, participants: agentIds, turnCount: turns.length }, ts: worldTime,
    }, tags);
    return { status: 'completed', sceneId, location, turns };
  }
}
