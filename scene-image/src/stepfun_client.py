from __future__ import annotations

import base64
import os
import re
from pathlib import Path
from typing import Optional, Tuple, Union

import httpx
from dotenv import load_dotenv
from openai import OpenAI

from .schemas import ImagePrompt

load_dotenv()

DEFAULT_BASE_URL = "https://api.stepfun.com/step_plan/v1"
# step-2x-large / step-1x-medium (classic text-to-image) are not available on this account's
# subscription plan (confirmed via /v1/models — only step-image-edit-2 is listed). That model
# also handles pure text-to-image generation (no source image) via /images/generations, as long
# as the requested size is one of its supported presets — see prompt_builders.py's DEFAULT_*_SIZE.
DEFAULT_MODEL = "step-image-edit-2"
DEFAULT_EDIT_MODEL = "step-image-edit-2"


def _slug(text: str, max_len: int = 40) -> str:
    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", text.strip())[:max_len].strip("-")
    return s or "image"


# Model-specific size allow-lists for /images/generations.
_SIZES_STEP2X = frozenset(
    {"256x256", "512x512", "768x768", "1024x1024", "1280x800", "800x1280"}
)
_SIZES_EDIT2 = frozenset(
    {"1024x1024", "768x1360", "896x1184", "1360x768", "1184x896"}
)


def _normalize_size(model: str, size: str, *, landscape: bool = False) -> str:
    """Map a requested size onto one the active model accepts."""
    requested = (size or "").strip()
    name = (model or "").lower()
    if "image-edit-2" in name or "step-image-edit" in name:
        allowed = _SIZES_EDIT2
        fallback = "1360x768" if landscape else "768x1360"
    else:
        # step-2x-large / step-1x-* and unknown OpenAI-compatible image models
        allowed = _SIZES_STEP2X
        fallback = "1280x800" if landscape else "800x1280"
    if requested in allowed:
        return requested
    return fallback


class StepFunImageClient:
    """Thin OpenAI-compatible wrapper around StepFun image generation."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        edit_model: Optional[str] = None,
        output_dir: Optional[Union[str, Path]] = None,
    ) -> None:
        self.api_key = api_key or os.getenv("STEP_API_KEY", "")
        self.base_url = (base_url or os.getenv("STEP_BASE_URL") or DEFAULT_BASE_URL).rstrip(
            "/"
        )
        self.model = model or os.getenv("STEP_IMAGE_MODEL") or DEFAULT_MODEL
        self.edit_model = (
            edit_model or os.getenv("STEP_IMAGE_EDIT_MODEL") or DEFAULT_EDIT_MODEL
        )
        self.output_dir = Path(
            output_dir or os.getenv("SCENE_IMAGE_OUTPUT_DIR") or "output"
        )
        self.output_dir.mkdir(parents=True, exist_ok=True)

        if not self.api_key:
            raise ValueError(
                "STEP_API_KEY is missing. Configure it in 模型服务 settings, "
                "or set STEP_API_KEY / STEPFUN_API_KEY in .env."
            )

        self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)

    def _save_result(
        self,
        item: object,
        *,
        prefix: str,
        seed: int,
        filename: Optional[str] = None,
    ) -> Tuple[Path, Optional[str], int]:
        url = getattr(item, "url", None)
        b64 = getattr(item, "b64_json", None)
        if filename:
            path = self.output_dir / Path(filename).name
            if path.suffix.lower() != ".png":
                path = path.with_suffix(".png")
        else:
            path = self.output_dir / f"{prefix}-{seed or 'rand'}.png"

        if b64:
            path.write_bytes(base64.b64decode(b64))
        elif url:
            with httpx.Client(timeout=120.0) as http:
                resp = http.get(url)
                resp.raise_for_status()
                path.write_bytes(resp.content)
        else:
            raise RuntimeError("StepFun response contained neither b64_json nor url")

        return path, url, seed

    def generate(
        self,
        image_prompt: ImagePrompt,
        *,
        seed: int = 0,
        steps: int = 50,
        cfg_scale: float = 7.5,
        response_format: str = "b64_json",
        filename_prefix: Optional[str] = None,
        filename: Optional[str] = None,
    ) -> Tuple[Path, Optional[str], int]:
        """Generate one image and save it under output_dir.

        `filename` pins the exact output name (asset layer content keys);
        `filename_prefix` keeps the older ``<prefix>-<seed>.png`` behaviour.

        Returns (local_path, url_or_none, seed).
        """
        extra_body = {
            "cfg_scale": cfg_scale,
            "seed": seed,
            "steps": steps,
        }
        if image_prompt.negative_prompt and cfg_scale > 1.0:
            extra_body["negative_prompt"] = image_prompt.negative_prompt

        landscape = image_prompt.image_type == "environment"
        size = _normalize_size(self.model, image_prompt.size, landscape=landscape)

        result = self.client.images.generate(
            model=self.model,
            prompt=image_prompt.prompt,
            size=size,
            n=1,
            response_format=response_format,  # type: ignore[arg-type]
            extra_body=extra_body,
        )
        prefix = filename_prefix or _slug(image_prompt.image_type)
        return self._save_result(
            result.data[0], prefix=prefix, seed=seed, filename=filename
        )

    def edit(
        self,
        image_prompt: ImagePrompt,
        *,
        source_image: Optional[Union[str, Path]] = None,
        seed: int = 0,
        steps: int = 8,
        cfg_scale: float = 1.0,
        response_format: str = "b64_json",
        filename_prefix: Optional[str] = None,
        text_mode: bool = False,
    ) -> Tuple[Path, Optional[str], int]:
        """Edit an existing image via StepFun POST /v1/images/edits (step-image-edit-2).

        Returns (local_path, url_or_none, seed). Output size matches the input image.
        """
        src = Path(source_image or image_prompt.source_image or "")
        if not src.is_file():
            raise FileNotFoundError(f"source image not found: {src}")

        extra_body = {
            "cfg_scale": cfg_scale,
            "seed": seed,
            "steps": steps,
            "text_mode": text_mode,
        }
        if image_prompt.negative_prompt and cfg_scale > 1.0:
            extra_body["negative_prompt"] = image_prompt.negative_prompt

        with src.open("rb") as fh:
            result = self.client.images.edit(
                model=self.edit_model,
                image=fh,
                prompt=image_prompt.prompt,
                response_format=response_format,  # type: ignore[arg-type]
                extra_body=extra_body,
            )

        prefix = filename_prefix or _slug(f"edit-{image_prompt.image_type}")
        return self._save_result(result.data[0], prefix=prefix, seed=seed)
