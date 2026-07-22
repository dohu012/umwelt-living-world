---
name: edit-image
description: >-
  Edit an existing scene image (portrait or background) with StepFun
  step-image-edit-2 via POST /v1/images/edits. Use when the user asks to
  modify a previously generated image rather than draw a new one.
---

# Edit Image（图像编辑）

## Hook

挂在 scene-image 流水线 **C–F** 内：当 `detect-need-image` 产出 `image_types: ["image_edit"]`
（或 umwelt 传入 `requestEdit: true`）时走本 skill，而不是文生图。

实现：

- 检测：`src/heuristics.py` → `detect_need_image` / `extract_edit_instruction`
- Prompt：`src/prompt_builders.py` → `build_image_edit_prompt`
- API：`src/stepfun_client.py` → `StepFunImageClient.edit` → `images.edit`

## When to use

- 用户说「改图 / 修图 / 编辑一下 / 把头发改成金色 / edit the portrait…」
- 已有一张可编辑的源图（本场或世界内最近一次出图）
- **不要**在没有源图时硬走 edit；应提示先生成立绘/背景，或回退文生图

## Input

```json
{
  "messages": [
    {"role": "user", "content": "把立绘头发改成金色短发，表情笑一点"}
  ],
  "source_image": "/abs/path/to/previous.png",
  "request_edit": true
}
```

- `source_image`：本地文件路径（umwelt 从最近 `type=image` 事件的 `data.path` 传入）
- 编辑说明优先取最近一条 user 消息，截断到 512 字符（StepFun 限制）

## Output

与文生图相同形状的 `ImagePrompt` / `GeneratedImage`，但：

```json
{
  "image_type": "image_edit",
  "prompt": "把立绘头发改成金色短发，表情笑一点",
  "negative_prompt": "extra fingers, deformed hands, blurry face, low quality, text, watermark, nsfw",
  "size": "1024x1024",
  "source_image": "/abs/path/to/previous.png",
  "notes": "StepFun images.edits"
}
```

注意：`size` 对 edit **无效**；API 返回与输入图同尺寸。

## Model / API

| 项 | 值 |
|----|-----|
| 模型 | `step-image-edit-2`（env: `STEP_IMAGE_EDIT_MODEL`） |
| 端点 | `POST /v1/images/edits` |
| 默认参数 | `cfg_scale=1.0`, `steps=8`, `response_format=b64_json` |

文生图仍用 `STEP_IMAGE_MODEL`（如 `step-2x-large`），与编辑模型分开配置。

## Decision rules

触发 `image_edit`：

- 改图、修图、编辑、把…改成/换成、edit/modify/change the image/portrait…

若同时像「新画一张」又像「改」——**优先 edit**（已有图时）。

## Do not

- 不要在没有 `source_image` 时调用 edit API
- 不要把完整文生图立绘 prompt 塞进 edit（用自然语言修改说明即可）
- 不要在 Node 里复制一份 API 封装；改协议时改本目录 Python
