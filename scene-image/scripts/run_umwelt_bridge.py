#!/usr/bin/env python3
"""stdin JSON bridge for umwelt Hook C–F → scene-image run_pipeline → stdout JSON."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.pipeline import run_asset_pipeline, run_pipeline  # noqa: E402


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"error": "empty stdin"}, ensure_ascii=False))
        sys.exit(1)

    payload = json.loads(raw)

    # Asset mode (the normal path): umwelt's visual sub-agent already produced the card, so we
    # only do Hook E+F. Dialogue mode below is the fallback for when that LLM call failed.
    card = payload.get("character_card") or payload.get("scene_card")
    if card:
        result = run_asset_pipeline(
            image_type=(
                "character_portrait" if payload.get("character_card") else "environment"
            ),
            card=card,
            seed=int(payload.get("seed") or 0),
            filename=payload.get("output_filename"),
            dry_run=bool(payload.get("dry_run", False)),
        )
        print(json.dumps(result.model_dump(), ensure_ascii=False))
        return

    messages = payload.get("messages") or []
    result = run_pipeline(
        messages,
        dry_run=bool(payload.get("dry_run", False)),
        force_types=payload.get("forceTypes") or payload.get("force_types"),
        location=payload.get("location") or "",
        persona_id=payload.get("personaId") or payload.get("persona_id") or "",
        request_image=bool(payload.get("requestImage") or payload.get("request_image")),
        request_edit=bool(payload.get("requestEdit") or payload.get("request_edit")),
        source_image=payload.get("sourceImage") or payload.get("source_image") or "",
        agents=payload.get("agents") or [],
        seed=int(payload.get("seed") or 1),
    )
    print(json.dumps(result.model_dump(), ensure_ascii=False))


if __name__ == "__main__":
    main()
