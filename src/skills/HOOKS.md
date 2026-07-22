# Umwelt Skill 挂载点（基于 fix 分支）

运行时入口：`hooks.js`。状态抽取 **不在本目录实现**，使用 fix 自带的 `agents/state/stateExtractionRunner.js`。

## 一次玩家发言

```text
玩家发消息
  → appendPlayerMessage (local:<当前房间>)
  → ★ Hook A: intent-dispatch          谁回、是否出图
  → for responders: TurnRunner
       → 对话 LLM
       → ★ Hook B: stateExtraction     心情/动作/关系（interactive 路径下不写 location）
  → ★ Hook C–F: scene-image            立绘/背景（玩家主动要图/改图）
  → ★ Hook G: scene-location           整场解算所有人下一步在哪个地点
  → ★ 换地点现生成（若玩家移动）       强制 environment → images/，tag local:<新地点>
  → scene_done
  → 玩家自己的 stateExtraction（心情/动作/关系，不含 location）
  → 应用玩家移动（socket 换房间 + location_changed）
```

UI 点击地点「进入」时：`ws join` 传送后由 `RoomManager.scheduleEnvironmentOnArrival` 异步跑同一套换地点现生成。

| Hook | 实现 | 位置 |
|------|------|------|
| **A** | `skills/hooks.js` → `runIntentDispatch` | `RoomManager._runScene`，`resolveResponders` 之后 |
| **B** | `runStateExtraction` / `applyStateExtraction` | `TurnRunner` + 玩家收尾（`applyLocation:false`，interactive 路径） |
| **C–F** | `skills/hooks.js` → `runSceneImagePipeline` → `scene-image/`（含 `edit-image` / StepFun `images.edit`） | 全员回合结束后、`scene_done` 前 |
| **G** | `agents/scene/locationResolveRunner.js` → `runSceneLocationResolve` | `RoomManager._concludeScene`，`scene_image` 之后 |
| **换地点现生成** | `RoomManager._generateEnvironmentForLocation`（`buildLocationChangeImageInput` → force `environment`） | Hook G 判定玩家移动后、`scene_done` 前；以及 UI join 传送后 |

**Hook G（scene-location）为什么单独存在**：location 曾是 Hook B 的一个字段，由每个角色各自的抽取调用独立决定 —— 结果玩家和被带走的 NPC 各写各的，常常玩家走了、NPC 留在原地，甚至“教堂/church”解析成两个房间。Hook G 用一次调用整场解算所有人的去向，同一目的地字符串经同一 registry 归一到同一个 canonical id，从而“一起走的人落在同一个房间”。CLI 批处理路径不挂 Hook G，仍由 Hook B 逐角色写 location（`TurnRunner` 的 `applyTurnLocation` 默认 `true`）。详见 `scene-location/SKILL.md`。

立绘协议与 Python 实现：仓库根目录 `scene-image/`。
