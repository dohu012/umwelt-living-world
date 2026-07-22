---
name: detect-need-image
description: >-
  Decide whether the current game/dialogue turn needs image generation
  (character portrait, environment background) or image editing of an
  existing image. Use when new visual descriptions appear, the user asks
  to draw/edit, or scene/character look changes.
---

# Detect Need Image

## When to use

- 用户明确要求画图、立绘、场景、背景
- 用户要求改图 / 修图 / 编辑已有立绘或背景（产出 `image_edit`）
- 角色外貌 / 服装首次出现或发生明显变化
- 场景地点、时段、氛围切换，且会影响背景图
- 不要在纯剧情闲聊、无视觉信息时触发

## Input

```json
{
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ],
  "lookback": 8
}
```

只看最近 `lookback` 轮（默认 8）。

## Output（必须是 JSON）

```json
{
  "need_image": true,
  "image_types": ["character_portrait", "environment"],
  "reason": "用户要求生成角色立绘，且首次描述了银发与校服",
  "priority": "character_portrait"
}
```

字段约定：

- `need_image`: bool
- `image_types`: 子集，取自 `character_portrait` | `environment` | `image_edit`
- `reason`: 一句话中文原因
- `priority`: 若两者都需要，先出哪张；否则等于唯一类型或 `null`

## Decision rules

触发 `image_edit`（优先于新画）：

- 用户说「改图 / 修图 / 编辑 / 把…改成 / edit the portrait」
- 需要上层提供 `source_image`；本 skill 只判定类型

触发 `character_portrait`：

- 出现外貌、发型、瞳色、服装、体型、表情、姿态等
- 用户说「立绘 / 角色图 / 画一下她 / portrait」

触发 `environment`：

- 出现地点、天气、时段、光影、室内外、氛围道具
- 用户说「背景 / 场景图 / 换个场景」

同时满足可两者都给；纯对话情绪而无新视觉信息 → `need_image: false`。

## Do not

- 不要写 prompt
- 不要调用生图 API
- 不要编造对话里没有的外貌 / 场景细节
