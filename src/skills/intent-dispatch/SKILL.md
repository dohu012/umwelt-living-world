---
name: intent-dispatch
description: >-
  Classify player intent and decide which agents should respond this scene
  (and in what order). Use in RoomManager before running agent turns; replaces
  naive same-location round-robin when ready.
---

# Intent Dispatch（意图识别 → 调度）

## Hook

**Hook A** — `RoomManager._runScene`，在 `appendPlayerMessage` 之后、循环 `runTurn` 之前。  
代码入口：`skills/hooks.js` → `runIntentDispatch`。

## When to use

- 每次玩家发言后，决定本场景谁开口
- 需要区分：闲聊 / 点名某角色 / 换地点 / 要求出图 / 只观察不说话 等

## Input

```json
{
  "worldId": "w1",
  "location": "tavern",
  "personaId": "player",
  "playerMessage": "Alice，你怎么看？",
  "candidates": [
    {
      "id": "alice",
      "name": "Alice",
      "state": {
        "location": "tavern",
        "mood": "dry",
        "action": "wiping the bar",
        "affinity": "20",
        "relationship": "bartender-customer"
      }
    }
  ]
}
```

`candidates` 默认是「location fact 匹配当前房间」的 agents（与现有 `resolveResponders` 相同过滤），skill 再在其中筛选/排序。

## Output（必须是 JSON）

```json
{
  "intent": "address_agent",
  "responderIds": ["alice"],
  "mode": "sequential",
  "notes": "玩家点名 Alice",
  "flags": {
    "requestImage": false,
    "requestEdit": false,
    "endScene": false
  }
}
```

字段：

| 字段 | 说明 |
|------|------|
| `intent` | 短标签：`chitchat` / `address_agent` / `request_image` / `observe` / `other` |
| `responderIds` | 本场景要跑 `runTurn` 的 agent id 列表（有序） |
| `mode` | `sequential`（当前唯一支持） |
| `flags.requestImage` | 可提示 Hook C 提高出图优先级 |
| `flags.requestEdit` | true 时走 StepFun 图像编辑（需已有源图） |
| `flags.endScene` | true 时跳过所有 agent 回合 |

> 地点/移动**不在这里**判断。location 由整场解算的 scene-location 技能（Hook G）统一负责，
> 所以这里没有 `move` intent，也没有 `sceneChange` flag。

## Decision rules（v1 启发式，可先不用 LLM）

1. 消息里点到某角色 `name` / `id` → 仅该角色（若在场）
2. 明确「都说说 / 你们怎么看」→ 全体 candidates
3. 「画 / 立绘 / 背景」→ `flags.requestImage=true`；仍可让在场角色短回或 `responderIds: []`
4. 「改图 / 修图 / 把…改成」→ `flags.requestEdit=true`（同时 `requestImage=true`）
5. 「别说话 / 只观察」→ `flags.endScene=true`，跳过所有 agent 回合
5. 否则 → 全体 candidates（兼容现状）

## Do not

- 不要写角色对话
- 不要直接改 EventStore（只返回调度结果；由 RoomManager 执行）
- 不要在这里生成立绘 prompt（那是 scene-image）
