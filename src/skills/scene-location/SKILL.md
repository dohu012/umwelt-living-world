---
name: scene-location
description: >-
  Holistically resolve where every participant (player + present agents) ends up
  after a scene, so a party that leaves together lands in one canonical room.
  Owns location on the interactive path; replaces per-agent location extraction.
---

# Scene Location（整场地点解算）— Hook G

## Hook

**Hook G** — `RoomManager._concludeScene`，在 Hook C–F（scene-image）之后、`scene_done` 之前。
代码入口：`agents/scene/locationResolveRunner.js` → `runSceneLocationResolve`。

## 为什么需要它

location 原本是每个角色各自 state-extraction 的一个字段：各写各的、时机不同、目的地字符串不归一。
表现出来的 bug：玩家说“Bob 跟我去教堂”，只有玩家到了，Bob 留在原地；即使都动了，“church”和
“教堂”还可能解析成两个房间。Hook G 用**一次**调用整场解算，把“一起走的人放进同一个房间”变成硬保证。

## 输入

```json
{
  "participants": [
    { "id": "<player id>", "name": "旅人", "location": "outside-the-bar" },
    { "id": "bob", "name": "Bob", "location": "outside-the-bar" },
    { "id": "alice", "name": "Alice", "location": "start" }
  ],
  "transcript": "[旅人]: bob，我们去教堂\n[Bob]: 走！",
  "locationRegistry": "<LocationRegistry>"
}
```

`participants` = 玩家 + 本场景在场的 agent（`presentIds`），各带当前 canonical location。

## 输出（parse 后）

```json
[
  { "id": "<player id>", "locationId": "教堂", "locationText": "教堂" },
  { "id": "bob", "locationId": "教堂", "locationText": "教堂" }
]
```

只返回**真正换了 canonical 地点**的参与者。LLM 被要求：一起移动的人必须输出**逐字相同**的地点字符串；
`runSceneLocationResolve` 再把每个字符串经 `locationRegistry.ensure()` 归一（并在本次调用内按字符串缓存
→ id），因此相同目的地折叠成同一个房间。网络/解析失败一律降级为“无人移动”。

## 应用（RoomManager）

- NPC 的移动立即 `setSubjectLocation` 写入（`scene_done` 前，面板刷新即可见）。
- 玩家的移动延后到玩家自己的 state-extraction 之后再应用（`setSubjectLocation` + `moveSocket` +
  `location_changed`）—— 保证玩家在换房间前还能收到旧房间 NPC 的最后一句回应。

## 边界

- CLI 批处理路径**不挂** Hook G，仍由 `TurnRunner`（`applyTurnLocation:true`）逐角色写 location。
- Registry 的同义词去重仍是已知局限（跨回合不同措辞可能拆成两个条目）；Hook G 只保证**同一次解算内**
  相同字符串归一。
