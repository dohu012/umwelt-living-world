#!/usr/bin/env python3
"""Run detect → summarize → prompt → (optional) StepFun generate."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.pipeline import load_dialogue_file, run_pipeline
from src.schemas import CharacterCard, SceneCard


def main() -> None:
    parser = argparse.ArgumentParser(description="Scene image pipeline")
    parser.add_argument(
        "--dialogue",
        default=str(ROOT / "examples" / "dialogue_sample.json"),
        help="Path to dialogue JSON",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only build prompts; do not call StepFun",
    )
    parser.add_argument(
        "--force",
        nargs="+",
        choices=["character_portrait", "environment", "image_edit"],
        help="Force image types regardless of detector",
    )
    parser.add_argument(
        "--source-image",
        default="",
        help="Local path to source image (required for image_edit)",
    )
    parser.add_argument(
        "--edit",
        action="store_true",
        help="Force image_edit path (needs --source-image)",
    )
    parser.add_argument("--character", help="Optional CharacterCard JSON path")
    parser.add_argument("--scene", help="Optional SceneCard JSON path")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument(
        "--out-json",
        default="",
        help="Optional path to write full PipelineResult JSON",
    )
    args = parser.parse_args()

    messages = load_dialogue_file(args.dialogue)
    known_character = None
    known_scene = None
    if args.character:
        known_character = CharacterCard.model_validate_json(
            Path(args.character).read_text(encoding="utf-8")
        )
    if args.scene:
        known_scene = SceneCard.model_validate_json(
            Path(args.scene).read_text(encoding="utf-8")
        )

    result = run_pipeline(
        messages,
        dry_run=args.dry_run,
        force_types=args.force,
        known_character=known_character,
        known_scene=known_scene,
        seed=args.seed,
        request_edit=bool(args.edit),
        source_image=args.source_image,
    )

    payload = result.model_dump()
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    print(text)
    if args.out_json:
        out = Path(args.out_json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
