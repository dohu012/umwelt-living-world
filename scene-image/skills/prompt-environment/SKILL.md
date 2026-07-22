---
name: prompt-environment
description: >-
  Turn a SceneCard into a StepFun-ready prompt for game environment
  backgrounds (背景). Use when image_types includes environment.
---

# Prompt Environment（背景）

## Goal

把 `SceneCard` 转成 **无人物或弱人物** 的场景背景 prompt，适合作为游戏对话 UI 底板。

## Input

`SceneCard` JSON（见 `summarize-visual-context`）。

## Output（必须是 JSON）

```json
{
  "image_type": "environment",
  "prompt": "anime background art, high school rooftop, golden hour sunset, clear sky light breeze, warm orange side light, quiet nostalgic mood, chain-link fence, water tower, distant city skyline, wide establishing shot, empty scene, no people, no characters, cinematic composition, high detail",
  "negative_prompt": "people, characters, portrait, face, text, watermark, blurry, low quality, oversaturated, cluttered UI",
  "size": "1280x800",
  "language": "en",
  "notes": "landscape background, no characters"
}
```

## Prompt 组装顺序

1. 风格锚点：`anime background art` 或卡片 `art_style`
2. 地点 `location`
3. 时段 `time_of_day`、天气 `weather`、光照 `lighting`
4. 情绪 `mood`
5. 关键道具 `key_props`（3–6 个）
6. 镜头 `camera`（默认 `wide establishing shot`）
7. 若 `no_characters: true`：强制加 `empty scene, no people, no characters`
8. 短质量词：`cinematic composition, high detail`

## Size

- 默认横图：`1280x800`
- `step-image-edit-2` 可改用 `1360x768`（按其文档 height×width 核对）

## Rules

- 背景以环境为主，不要写具体角色名字或立绘服装
- 对话里没提的建筑/道具不要编
- 需要给立绘留合成空间时，可加 `ample negative space in the center`（可选）

## Do not

- 不要调用生图 API
- 不要生成角色立绘
