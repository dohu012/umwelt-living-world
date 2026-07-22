#!/usr/bin/env python3
"""Smoke-test StepFun text-to-image with a fixed prompt."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.schemas import ImagePrompt
from src.stepfun_client import StepFunImageClient


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate one image via StepFun API")
    parser.add_argument("--prompt", required=True, help="Text prompt")
    parser.add_argument(
        "--negative",
        default="low quality, blurry, text, watermark",
        help="Negative prompt",
    )
    parser.add_argument("--size", default="1024x1024")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--steps", type=int, default=50)
    parser.add_argument("--cfg-scale", type=float, default=7.5)
    parser.add_argument("--model", default=None, help="Override STEP_IMAGE_MODEL")
    args = parser.parse_args()

    client = StepFunImageClient(model=args.model)
    prompt = ImagePrompt(
        image_type="character_portrait",
        prompt=args.prompt,
        negative_prompt=args.negative,
        size=args.size,
    )
    path, url, seed = client.generate(
        prompt,
        seed=args.seed,
        steps=args.steps,
        cfg_scale=args.cfg_scale,
        filename_prefix="smoke",
    )
    print(f"model={client.model}")
    print(f"saved={path}")
    if url:
        print(f"url={url}")
    print(f"seed={seed}")


if __name__ == "__main__":
    main()
