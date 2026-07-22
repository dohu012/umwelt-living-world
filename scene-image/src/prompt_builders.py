from __future__ import annotations

from .schemas import CharacterCard, ImagePrompt, SceneCard

EDIT_NEGATIVE = (
    "extra fingers, deformed hands, blurry face, low quality, text, watermark, nsfw"
)

PORTRAIT_NEGATIVE = (
    "extra fingers, deformed hands, blurry face, low quality, text, watermark, "
    "crowded background, multiple people, nsfw"
)
ENVIRONMENT_NEGATIVE = (
    "people, characters, portrait, face, text, watermark, blurry, "
    "low quality, oversaturated, cluttered UI"
)

# step-image-edit-2 (the only image model this account's plan has access to) only accepts a
# fixed set of sizes: 1024x1024, 768x1360, 896x1184, 1360x768, 1184x896 — arbitrary sizes like the
# old step-1x/step-2x-compatible 800x1280 get rejected with a "size_invalid" error.
DEFAULT_PORTRAIT_SIZE = "768x1360"
DEFAULT_ENVIRONMENT_SIZE = "1360x768"


def _join(*parts: str, max_chars: int = 480) -> str:
    text = ", ".join(p.strip() for p in parts if p and p.strip())
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3].rstrip(", ") + "..."


def _person_token(gender_presentation: str) -> str:
    g = (gender_presentation or "").lower()
    if g in {"female", "woman", "girl", "f"}:
        return "1girl"
    if g in {"male", "man", "boy", "m"}:
        return "1boy"
    return "1person"


def build_character_portrait_prompt(
    card: CharacterCard,
    *,
    size: str = DEFAULT_PORTRAIT_SIZE,
) -> ImagePrompt:
    style = card.art_style or "anime illustration"
    person = _person_token(card.gender_presentation)
    pose = card.pose or "standing, three-quarter view"
    composition = "full body" if "full" in pose.lower() or "standing" in pose.lower() else "upper body"

    prompt = _join(
        f"{style} character portrait",
        person,
        card.age_range,
        card.hair,
        card.eyes,
        card.face,
        card.body,
        card.outfit,
        card.accessories,
        card.expression,
        pose,
        card.personality_visual_cues,
        *card.extra,
        "solid pure white background",
        "isolated character cutout",
        composition,
        "high detail",
    )

    return ImagePrompt(
        image_type="character_portrait",
        prompt=prompt,
        negative_prompt=PORTRAIT_NEGATIVE,
        size=size,
        language="en",
        notes=f"portrait for {card.name or 'unnamed character'}",
    )


def build_environment_prompt(
    card: SceneCard,
    *,
    size: str = DEFAULT_ENVIRONMENT_SIZE,
) -> ImagePrompt:
    style = card.art_style or "anime background art"
    props = ", ".join(card.key_props[:6])
    no_people = "empty scene, no people, no characters" if card.no_characters else ""

    prompt = _join(
        style,
        card.location,
        card.time_of_day,
        card.weather,
        card.lighting,
        card.mood,
        props,
        card.camera or "wide establishing shot",
        *card.extra,
        no_people,
        "cinematic composition",
        "high detail",
    )

    return ImagePrompt(
        image_type="environment",
        prompt=prompt,
        negative_prompt=ENVIRONMENT_NEGATIVE,
        size=size,
        language="en",
        notes="landscape background, no characters"
        if card.no_characters
        else "landscape background",
    )


def build_image_edit_prompt(
    instruction: str,
    *,
    source_image: str,
    size: str = "1024x1024",
) -> ImagePrompt:
    """Build a StepFun /v1/images/edits prompt (max ~512 chars)."""
    text = (instruction or "").strip()
    if not text:
        text = "Improve clarity and lighting; keep the subject identity and composition"
    # Identity lock — edit models often drift gender/face when the user prompt is vague.
    identity = (
        "Keep the same character identity, gender presentation, face, and body type; "
        "only apply the requested change."
    )
    if identity.lower() not in text.lower():
        text = f"{text}. {identity}"
    # step-image-edit-2 prompt limit is 512 characters.
    if len(text) > 512:
        text = text[:509].rstrip() + "..."

    return ImagePrompt(
        image_type="image_edit",
        prompt=text,
        negative_prompt=EDIT_NEGATIVE,
        size=size,
        language="zh" if any("\u4e00" <= ch <= "\u9fff" for ch in text) else "en",
        notes="StepFun images.edits",
        source_image=source_image,
    )
