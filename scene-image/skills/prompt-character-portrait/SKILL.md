---
name: prompt-character-portrait
description: >-
  Turn a CharacterCard into a StepFun-ready prompt for standing character
  portraits (立绘). Use when image_types includes character_portrait.
---

# Prompt Character Portrait（立绘）

## Goal

把 `CharacterCard` 转成适合阶跃文生图的 **全身/半身立绘** prompt，默认纯白背景（生成后会抠成透明 PNG），便于叠到游戏场景 UI。

## Input

`CharacterCard` JSON（见 `summarize-visual-context`）。

## Output（必须是 JSON）

```json
{
  "image_type": "character_portrait",
  "prompt": "anime character portrait, 1girl, teen, long silver hair with side braid, pale blue eyes, soft features, slender, navy school uniform with red ribbon, small silver ear cuff, gentle smile, standing three-quarter view, shy reserved posture, solid pure white background, isolated character cutout, full body, high detail",
  "negative_prompt": "extra fingers, deformed hands, blurry face, low quality, text, watermark, crowded background, multiple people, nsfw",
  "size": "800x1280",
  "language": "en",
  "notes": "portrait orientation for 立绘"
}
```

## Prompt 组装顺序（保持稳定）

1. 类型锚点：`anime character portrait` / 或卡片里的 `art_style`
2. 人数：`1girl` / `1boy` / `1person`（由 `gender_presentation` 推断）
3. 年龄感、发型、瞳色、面部、体型
4. 服装、配饰
5. 表情、姿态、气质线索
6. 构图：`standing`、`three-quarter view` 或卡片 `pose`；优先 `full body`，信息不足用 `upper body`
7. 背景：`solid pure white background` + `isolated character cutout`（便于后续抠透明；不要复杂场景）
8. 质量词：短即可，如 `high detail`

## Size

- 默认竖图：`800x1280`（兼容 step-1x / step-2x 文档中的矩形档）
- 若模型为 `step-image-edit-2`，改用其支持的竖图（如 `768x1360`，注意文档为 height×width）

## Rules

- prompt 建议英文（StepFun 中英均可；比赛联调时英文更稳）
- 总长控制在模型限制内（常见上限约 512 chars 时需压缩，优先保外貌与服装）
- `cfg_scale > 1` 时 `negative_prompt` 才生效；默认仍输出负向词
- 不要在立绘 prompt 里塞完整场景地名（那是背景 skill 的事）

## Do not

- 不要调用生图 API（交给 `src.stepfun_client`）
- 不要输出多张候选 unless 上层明确要求
