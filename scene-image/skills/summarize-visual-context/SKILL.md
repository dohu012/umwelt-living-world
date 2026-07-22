---
name: summarize-visual-context
description: >-
  Compress dialogue and character notes into structured CharacterCard and
  SceneCard for downstream portrait/background prompt skills. Use after
  detect-need-image returns need_image=true.
---

# Summarize Visual Context

## When to use

在 `detect-need-image` 判定需要出图之后、写 prompt 之前。把长对话压成固定字段卡片，供立绘 / 背景 skill 使用。

## Input

```json
{
  "messages": [{"role": "user", "content": "..."}],
  "image_types": ["character_portrait", "environment"],
  "known_character": null,
  "known_scene": null
}
```

`known_character` / `known_scene` 可为上一轮卡片；有则做增量合并，无冲突保留旧值，有新描述则覆盖。

## Output（必须是 JSON）

```json
{
  "character": {
    "name": "林晚",
    "gender_presentation": "female",
    "age_range": "teen",
    "hair": "long silver hair, side braid",
    "eyes": "pale blue eyes",
    "face": "soft features, light blush",
    "body": "slender",
    "outfit": "navy school uniform, red ribbon",
    "accessories": "small silver ear cuff",
    "expression": "gentle smile",
    "pose": "standing, three-quarter view",
    "personality_visual_cues": "shy, reserved posture",
    "art_style": "anime illustration",
    "extra": []
  },
  "scene": {
    "location": "rooftop of high school",
    "time_of_day": "golden hour sunset",
    "weather": "clear sky, light breeze",
    "lighting": "warm orange sunlight from the side",
    "mood": "quiet, nostalgic",
    "key_props": ["chain-link fence", "water tower", "distant city"],
    "camera": "wide establishing shot",
    "art_style": "anime background art",
    "no_characters": true,
    "extra": []
  }
}
```

规则：

- 若 `image_types` 不含 `character_portrait`，`character` 可为 `null`
- 若不含 `environment`，`scene` 可为 `null`
- 未知字段用 `""` 或 `[]`，**禁止臆造**对话未提及的细节
- `personality_visual_cues` 只保留能影响画面的气质（如含蓄、高傲），不要写剧情摘要
- `no_characters` 背景图默认 `true`，避免背景里再长出人物

## Do not

- 不要生成最终生图 prompt
- 不要调用 API
- 不要输出 Markdown 包裹；只输出 JSON
