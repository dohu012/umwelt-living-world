---
name: summarize-status
description: >-
  DEPRECATED on the fix branch. Status (mood/action/location/relationships) is
  owned by umwelt/src/agents/state/stateExtractionRunner.js. Keep this skill
  only as documentation of the old Hook B contract.
---

# Summarize Status — superseded by fix-branch state extraction

Do **not** wire this skill into `TurnRunner` on `skill-on-fix` / `fix`.

Use instead:

- `umwelt/src/agents/state/stateExtractor.js`
- `umwelt/src/agents/state/stateExtractionRunner.js`
- `umwelt/src/llm/stateExtractionParser.js`

Those modules already produce mood / action / location / relationships via a silent utility LLM call, integrated with `LocationRegistry`.
