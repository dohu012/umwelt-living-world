# Scene Image Skills + StepFun API

本目录是 **场景视觉 / 立绘 / 背景** 技能与 StepFun 生图实现。多 Agent 运行时在 `umwelt/`；挂载点见：

**[`umwelt/src/skills/HOOKS.md`](../umwelt/src/skills/HOOKS.md)**（Hook C–F）

你负责：

1. **场景 Skill**：判断要不要画、从对话抽视觉信息、生成立绘 / 背景 prompt
2. **StepFun 图像 API**：把最终 prompt 打到阶跃生图模型并落盘

## 在 umwelt 里插在哪

```text
玩家发言 → intent-dispatch(A) → 各 agent runTurn(+ summarize-status B)
  → ★ 这里调用 scene-image pipeline (C→D→E→F)
  → scene_done
```

Node 侧入口：`umwelt/src/skills/hooks.js` → `runSceneImagePipeline`（当前为 stub，组装好 input 后应调本目录 `run_pipeline`）。

## 目录结构

```text
scene-image/
  skills/                      # Agent 可加载的 skill 说明（给 LLM / 编排层）
    detect-need-image/           Hook C
    summarize-visual-context/    Hook D
    prompt-character-portrait/   Hook E
    prompt-environment/          Hook E
    edit-image/                  Hook E/F（基于已有图的 StepFun edits）
  src/                         # Python：schema / prompt / StepFun / pipeline
  scripts/                     # 本地调试 CLI
  examples/
  output/
```

## 流水线

```text
对话消息 (+ 可选 umwelt agents[].state + source_image)
  → detect-need-image
  → 若 image_edit:
       extract_edit_instruction → StepFun images.edit (step-image-edit-2)
  → 否则:
       summarize-visual-context   # 可吸收 mood/action/location
       → prompt-character-portrait / prompt-environment
       → StepFun images.generate
```

## 快速开始

```bash
cd scene-image
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env，填入 STEP_API_KEY
```

```bash
python scripts/run_scene_pipeline.py --dialogue examples/dialogue_sample.json --dry-run
```

## 和环境的对接约定

| Skill | Hook | 输入 | 输出 |
|-------|------|------|------|
| `detect-need-image` | C | 最近对话 turns | `{need_image, image_types, reason}` |
| `summarize-visual-context` | D | 对话 + 可选角色设定 + umwelt state | `CharacterCard` / `SceneCard` |
| `prompt-character-portrait` | E | `CharacterCard` | `{prompt, negative_prompt, size}` |
| `prompt-environment` | E | `SceneCard` | `{prompt, negative_prompt, size}` |
| `edit-image` | E/F | 对话 + `source_image` | `{image_type:image_edit, prompt, source_image}` → `images.edit` |

Python 入口：`src.pipeline.run_pipeline`。

umwelt 额外字段（可选）：

- `location`, `persona_id`, `request_image`
- `agents[]`: `{ id, name, state: { mood, action, affinity, relationship, location }, profileHints }`

状态字段由 umwelt **Hook B `summarize-status`** 写入；本模块只消费，不维护好感度。

## 分工边界

- **本目录不做**：角色对话、多 Agent 调度、好感度/关系结算、前端
- **本目录做**：视觉触发、视觉摘要、立绘/背景 prompt、StepFun 调用与落盘
- **对接**：umwelt `RoomManager` 在场景结束后把 JSON 丢进 `run_pipeline`；图片路径回写 `type=image` 事件
