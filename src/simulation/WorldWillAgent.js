import { createLLMClient } from '../llm/LLMClient.js';

function parseJsonObject(text) {
  const cleaned = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('世界意志 Agent 没有返回有效的 JSON 计划');
  }
}

export class WorldWillAgent {
  constructor({ providerSettingsStore, worldEvents, agentRegistry, locationRegistry, createClient = createLLMClient }) {
    this.providerSettingsStore = providerSettingsStore;
    this.worldEvents = worldEvents;
    this.agentRegistry = agentRegistry;
    this.locationRegistry = locationRegistry;
    this.createClient = createClient;
  }

  async planAndSchedule({ instruction, worldTime }) {
    if (!instruction?.trim()) throw new Error('请描述你希望发生的世界事件');
    const provider = this.providerSettingsStore?.getActiveForKind?.('utility')
      ?? this.providerSettingsStore?.getActiveForKind?.('dialogue')
      ?? this.providerSettingsStore?.getActive?.();
    if (!provider) throw new Error('世界意志 Agent 需要一个已启用的对话模型');

    const locations = this.locationRegistry.list().map((item) => ({ id: item.id, name: item.name }));
    const agents = this.agentRegistry.listAgentIds().map((id) => {
      try { return { id, name: this.agentRegistry.loadProfile(id)?.name ?? id }; }
      catch { return { id, name: id }; }
    });
    const system = [
      '你是独立的“世界意志 Agent”，负责把玩家的自然语言意图转换为可执行的世界事件时间线。',
      '你不扮演任何角色，也不和玩家闲聊。你要判断事件怎样合理发生、分成哪些时间节点，并给环境留下可被角色感知和响应的影响。',
      '只输出一个 JSON 对象，不要 Markdown。结构必须是：',
      '{"title":"事件名","kind":"简短英文类别","scope":"world或地点id","intensity":0到1,"rationale":"你的判断说明","timeline":[{"at":"ISO时间","phase":"英文阶段名","description":"该节点具体如何发生","effects":[{"scope":"world或地点id","key":"环境键","value":"任意JSON值"}]}]}',
      'timeline 必须有 1-8 个节点，按时间升序。用户给出明确时间时必须遵守；只有相对时间时，以当前世界时间推算。',
      '常用环境键包括 weather.current、weather.intensity、weather.alert、infrastructure.power、transport.status、danger.level、public.mood。',
      'description 要具体、可叙事，说明事件如何显现，而不只是重复标题。最后一个节点应描述稳定状态或余波。',
    ].join('\n');
    const client = this.createClient({ nim: provider });
    let raw;
    try {
      raw = await client.chatCompletion({
        system,
        messages: [{
          role: 'user',
          content: JSON.stringify({ currentWorldTime: worldTime, knownLocations: locations, knownAgents: agents, instruction: instruction.trim() }),
        }],
        temperature: 0.2,
        maxTokens: 1800,
      });
    } catch (error) {
      throw new Error(
        `世界意志 Agent 无法调用模型“${provider.name ?? '未命名'} / ${provider.model}”` +
        `（${provider.baseUrl}）：${error.message}`,
      );
    }
    const plan = parseJsonObject(raw);
    return this.worldEvents.schedulePlan({ ...plan, instruction: instruction.trim() });
  }
}
