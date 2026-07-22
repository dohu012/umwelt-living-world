"""Shared agent portrait generation for preload + on-create flows.

Writes frontend-probed paths under agents/<id>/:
  portraits/{neutral,happy,angry,sad,fear}.png
  portraits/manifest.json
  avatar.png (optional)
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any, Mapping, Optional

from .bg_remove import remove_background
from .prompt_builders import (
    build_character_portrait_prompt,
    build_image_edit_prompt,
)
from .schemas import CharacterCard
from .stepfun_client import StepFunImageClient

EMOTIONS = ("neutral", "happy", "angry", "sad", "fear")

EMOTION_EDIT = {
    "happy": "Change only the facial expression to a warm genuine smile; keep identity, outfit, pose, and composition identical",
    "angry": "Change only the facial expression to angry and stern; keep identity, outfit, pose, and composition identical",
    "sad": "Change only the facial expression to sad and downcast; keep identity, outfit, pose, and composition identical",
    "fear": "Change only the facial expression to fearful and wary; keep identity, outfit, pose, and composition identical",
}


def _copy(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)


def _infer_gender(text: str) -> str:
    t = text or ""
    if re.search(r"(她|女孩|少女|女|woman|girl|female)", t, re.I):
        return "female"
    if re.search(r"(他|男孩|少年|男|man|boy|male)", t, re.I):
        return "male"
    return ""


def card_from_profile(profile: Mapping[str, Any], *, agent_id: str = "") -> CharacterCard:
    """Build a CharacterCard from an umwelt agent profile.json."""
    name = str(profile.get("name") or agent_id or "character").strip()
    description = str(profile.get("description") or "").strip()
    personality = str(profile.get("personality") or "").strip()
    scenario = str(profile.get("scenario") or "").strip()
    blob = " ".join(p for p in (description, personality, scenario) if p)

    extras = []
    if description:
        extras.append(description[:280])
    if scenario:
        extras.append(scenario[:160])
    extras.extend(["single character portrait", "solid pure white background"])

    return CharacterCard(
        name=name,
        gender_presentation=_infer_gender(blob),
        age_range="young adult",
        expression="calm neutral expression",
        pose="standing, three-quarter view",
        personality_visual_cues=personality[:200],
        art_style="anime illustration",
        extra=extras,
    )


def generate_agent_portraits(
    client: StepFunImageClient,
    *,
    agent_dir: Path,
    agent_id: str,
    card: CharacterCard,
    seed: int = 42,
    skip_existing: bool = False,
    write_avatar: bool = True,
) -> dict:
    """Generate emotion portraits into agent_dir/portraits/. Returns a small status dict."""
    agent_dir = Path(agent_dir)
    portraits_dir = agent_dir / "portraits"
    portraits_dir.mkdir(parents=True, exist_ok=True)

    generated = []
    skipped = []

    neutral_path = portraits_dir / "neutral.png"
    if skip_existing and neutral_path.is_file():
        skipped.append("neutral")
    else:
        prompt = build_character_portrait_prompt(card)
        path, _, _ = client.generate(
            prompt,
            seed=seed,
            filename_prefix=f"agent-{agent_id}-neutral",
        )
        _copy(path, neutral_path)
        remove_background(neutral_path)
        generated.append("neutral")

    for emotion, instruction in EMOTION_EDIT.items():
        out = portraits_dir / f"{emotion}.png"
        if skip_existing and out.is_file():
            skipped.append(emotion)
            continue
        if not neutral_path.is_file():
            raise FileNotFoundError(f"neutral portrait missing: {neutral_path}")
        edit_prompt = build_image_edit_prompt(instruction, source_image=str(neutral_path))
        path, _, _ = client.edit(
            edit_prompt,
            source_image=neutral_path,
            seed=seed + (abs(hash(emotion)) % 1000),
            filename_prefix=f"agent-{agent_id}-{emotion}",
        )
        _copy(path, out)
        remove_background(out)
        generated.append(emotion)

    manifest = {
        "default": "neutral.png",
        "emotions": {emotion: f"{emotion}.png" for emotion in EMOTIONS},
    }
    (portraits_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    avatar_written = False
    profile_path = agent_dir / "profile.json"
    profile: dict = {}
    if profile_path.is_file():
        profile = json.loads(profile_path.read_text(encoding="utf-8"))

    existing_avatar = profile.get("avatar")
    profile_points_to_file = bool(
        isinstance(existing_avatar, str)
        and existing_avatar
        and (agent_dir / existing_avatar).is_file()
    )
    disk_avatar = next(iter(sorted(agent_dir.glob("avatar.*"))), None)

    # Never clobber a user-uploaded avatar; only fill in when missing.
    # Also backfill profile.avatar when the file exists but the field was wiped
    # (e.g. character editor save after async generation).
    if write_avatar:
        if not profile_points_to_file and not disk_avatar and neutral_path.is_file():
            avatar_path = agent_dir / "avatar.png"
            _copy(neutral_path, avatar_path)
            disk_avatar = avatar_path
            avatar_written = True
        if disk_avatar and profile.get("avatar") != disk_avatar.name and profile_path.is_file():
            profile["avatar"] = disk_avatar.name
            profile_path.write_text(
                json.dumps(profile, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            avatar_written = True

    return {
        "agentId": agent_id,
        "generated": generated,
        "skipped": skipped,
        "avatarWritten": avatar_written,
        "portraitsDir": str(portraits_dir),
    }
