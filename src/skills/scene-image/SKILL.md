---
name: scene-image
description: >-
  Umwelt-side entry for the scene-image portrait/background/edit pipeline
  (detect → visual cards → prompts → StepFun generate or edits).
  Implementation lives in ../../../../scene-image/; this skill documents
  Hook C–F contracts only.
---

# Scene Image（立绘 / 背景）— Umwelt 侧入口

详细协议与 Python 实现见仓库根目录：

- `scene-image/README.md`
- `scene-image/skills/*/SKILL.md`
- `scene-image/src/pipeline.py` → `run_pipeline`

## Hooks

| 步骤 | Skill（scene-image） | Hook |
|------|----------------------|------|
| 是否出图/改图 | `detect-need-image` | **C** |
| 视觉摘要 | `summarize-visual-context` | **D** |
| 立绘 prompt | `prompt-character-portrait` | **E** |
| 背景 prompt | `prompt-environment` | **E** |
| 图像编辑 | `edit-image` | **E/F**（`images.edit`） |
| 调 API 落盘 | `StepFunImageClient` | **F**（runtime） |

代码入口：`umwelt/src/skills/hooks.js` → `runSceneImagePipeline`。

调用位置：`RoomManager._runScene`，**全部 agent 回合结束之后**、`scene_done` 之前。

另：**换地点现生成** — 玩家因 Hook G 或 UI 传送到达新地点时，`RoomManager._generateEnvironmentForLocation` 强制 `forceTypes: ['environment']`，落盘 `data/world/<worldId>/images/`，事件 tag `local:<新地点>`。

另：**新建角色立绘** — `POST /api/worlds/:worldId/characters` 创建成功后异步调用 `scene-image/scripts/generate_agent_portraits.py`，按 profile 文案生成 `agents/<id>/portraits/{emotion}.png`（及缺省 avatar）。

## Umwelt → pipeline 输入

除 dialogue `messages` 外，附带本场景状态（供启发式与后续 LLM skill 使用）：

```json
{
  "messages": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "[alice]: …" }],
  "location": "tavern",
  "personaId": "player",
  "forceTypes": null,
  "requestImage": false,
  "requestEdit": false,
  "sourceImage": null,
  "agents": [
    {
      "id": "alice",
      "name": "Alice",
      "state": {
        "mood": "wary",
        "action": "wiping a glass",
        "affinity": "12",
        "relationship": "regular",
        "location": "tavern"
      },
      "profileHints": {
        "description": "evening bartender…",
        "personality": "Sarcastic but warm…"
      }
    }
  ]
}
```

映射建议：

- `state.action` / `state.mood` → CharacterCard `pose` / `expression`
- `state.location` + 近期 system/dialogue → SceneCard `location` / `mood`
- Hook A 的 `flags.requestImage` → `requestImage: true`（可 `forceTypes` 或提高 detect 灵敏度）
- Hook A 的 `flags.requestEdit` → `requestEdit: true` + 最近 `type=image` 的 `data.path` → `sourceImage`

## Output 回写 umwelt

成功出图后应由 hooks 写入 EventStore（尚未在 stub 中落库，仅广播）：

```json
{
  "type": "image",
  "actor": "system",
  "content": "character_portrait",
  "data": { "path": "…", "url": "…", "prompt": { } },
  "tags": ["local:<location>", "global"]
}
```

文件目录约定：`data/world/<worldId>/images/`（已在根 `.gitignore`）。

## Do not

- 不要在 Node 里复制一份 prompt 规则；改协议时改 `scene-image/skills/`
- 不要在 agent 的 in-character 回合里同步阻塞超长生图（可先 broadcast `image_pending`，再 `image_ready`）
