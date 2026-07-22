"""Lightweight offline heuristics so the pipeline can run without an LLM.

Production multi-agent stacks should prefer loading skills/*/SKILL.md and
letting their own model fill CharacterCard / SceneCard; these helpers are for
local dry-runs and API smoke tests.
"""

from __future__ import annotations

import re
from typing import List, Optional, Tuple

from .schemas import (
    CharacterCard,
    ChatMessage,
    DetectResult,
    ImageType,
    SceneCard,
    VisualContext,
)

_DRAW_PATTERNS = re.compile(
    r"(画|立绘|生成图|出图|背景|场景图|portrait|draw|generate\s+(an?\s+)?image|background)",
    re.I,
)
_EDIT_PATTERNS = re.compile(
    r"("
    r"改图|修图|编辑(一下|这张|图片|图像)?|改一下(图|立绘|背景)?|"
    r"把.*(改成|换成|改成|变成)|换成|"
    r"edit(\s+the)?\s*(image|portrait|background)?|"
    r"modify(\s+the)?\s*(image|portrait)?|"
    r"change(\s+the)?\s*(image|portrait|outfit|hair|background)?"
    r")",
    re.I,
)
_CHAR_PATTERNS = re.compile(
    r"(头发|发型|瞳|眼睛|校服|服装|裙子|外套|银发|黑发|表情|外貌|hair|eyes|uniform|outfit|dress)",
    re.I,
)
_SCENE_PATTERNS = re.compile(
    r"(教室|天台|街道|雨|黄昏|夜晚|清晨|咖啡|屋顶|公园|车站|sunset|rooftop|classroom|rain|night)",
    re.I,
)


def _recent_text(messages: List[ChatMessage], lookback: int = 8) -> str:
    chunk = messages[-lookback:] if lookback > 0 else messages
    return "\n".join(m.content for m in chunk)


def detect_need_image(messages: List[ChatMessage], lookback: int = 8) -> DetectResult:
    text = _recent_text(messages, lookback)
    types: List[ImageType] = []

    wants_edit = bool(_EDIT_PATTERNS.search(text))
    wants_draw = bool(_DRAW_PATTERNS.search(text))
    has_char = bool(_CHAR_PATTERNS.search(text))
    has_scene = bool(_SCENE_PATTERNS.search(text))

    # Edit takes priority over fresh generate when the user asks to modify an existing image.
    if wants_edit:
        types.append("image_edit")
    else:
        if wants_draw or has_char:
            if has_char or re.search(r"(立绘|角色|她|他|portrait|character)", text, re.I):
                types.append("character_portrait")
        if wants_draw or has_scene:
            if has_scene or re.search(r"(背景|场景|environment|background)", text, re.I):
                types.append("environment")

    # Deduplicate while preserving order
    seen = set()
    image_types: List[ImageType] = []
    for t in types:
        if t not in seen:
            seen.add(t)
            image_types.append(t)

    if not image_types and wants_draw:
        image_types = ["character_portrait"]

    need = bool(image_types)
    priority = image_types[0] if image_types else None
    if wants_edit:
        reason = "matched image-edit cues in recent dialogue"
    elif need:
        reason = "matched visual/draw cues in recent dialogue"
    else:
        reason = "no visual trigger in recent dialogue"
    return DetectResult(
        need_image=need,
        image_types=image_types,
        reason=reason,
        priority=priority,
    )


def extract_edit_instruction(messages: List[ChatMessage], lookback: int = 6) -> str:
    """Pull a short natural-language edit instruction from recent user turns."""
    chunk = messages[-lookback:] if lookback > 0 else messages
    user_bits = [m.content.strip() for m in chunk if m.role == "user" and m.content.strip()]
    if not user_bits:
        # Fall back to the last non-empty message.
        for m in reversed(chunk):
            if m.content.strip():
                return m.content.strip()[:512]
        return "improve the image quality, keep the subject identity"
    return user_bits[-1][:512]


def _first_match(patterns: List[Tuple[str, str]], text: str) -> str:
    for pattern, value in patterns:
        if re.search(pattern, text, re.I):
            return value
    return ""


def _apply_umwelt_agent(character: CharacterCard, agent: Optional[object]) -> None:
    """Merge Hook B status (mood/action) and profile hints into a CharacterCard."""
    if agent is None:
        return
    name = getattr(agent, "name", None) or ""
    state = getattr(agent, "state", None)
    hints = getattr(agent, "profileHints", None) or {}
    if name and not character.name:
        character.name = name
    if state is not None:
        mood = getattr(state, "mood", "") or ""
        action = getattr(state, "action", "") or ""
        if mood and not character.expression:
            character.expression = mood
        if action and (not character.pose or character.pose == "standing, three-quarter view"):
            character.pose = action
    desc = hints.get("description") if isinstance(hints, dict) else ""
    personality = hints.get("personality") if isinstance(hints, dict) else ""
    if personality and not character.personality_visual_cues:
        character.personality_visual_cues = str(personality)[:80]
    if desc and not character.extra:
        character.extra = [str(desc)[:120]]


def summarize_visual_context(
    messages: List[ChatMessage],
    image_types: List[ImageType],
    *,
    known_character: Optional[CharacterCard] = None,
    known_scene: Optional[SceneCard] = None,
    umwelt_agent: Optional[object] = None,
    umwelt_location: str = "",
) -> VisualContext:
    text = _recent_text(messages, lookback=12)
    character = None
    scene = None

    if "character_portrait" in image_types:
        character = known_character.model_copy() if known_character else CharacterCard()
        _apply_umwelt_agent(character, umwelt_agent)
        if not character.name:
            m = re.search(
                r"(?:角色叫|名叫|名字是|我是)\s*([^\s，。,]{1,12})",
                text,
            ) or re.search(r"角色\s*([^\s，。,]{1,12})", text)
            if m:
                character.name = m.group(1)
        character.hair = character.hair or _first_match(
            [
                (r"银发|银色头发|silver hair", "long silver hair"),
                (r"黑发|黑色头发|black hair", "long black hair"),
                (r"金发|金色头发|blonde", "blonde hair"),
            ],
            text,
        )
        character.eyes = character.eyes or _first_match(
            [
                (r"蓝瞳|蓝色眼睛|blue eyes", "pale blue eyes"),
                (r"红瞳|红色眼睛|red eyes", "red eyes"),
                (r"琥珀|amber eyes", "amber eyes"),
            ],
            text,
        )
        character.outfit = character.outfit or _first_match(
            [
                (r"校服|制服|school uniform", "navy school uniform with ribbon"),
                (r"风衣|coat", "long coat"),
                (r"和服|kimono", "kimono"),
            ],
            text,
        )
        character.expression = character.expression or _first_match(
            [
                (r"微笑|笑|smile", "gentle smile"),
                (r"冷淡|淡漠", "calm expression"),
                (r"害羞|shy", "shy expression"),
            ],
            text,
        )
        if not character.gender_presentation:
            if re.search(r"(她|女孩|少女|girl)", text):
                character.gender_presentation = "female"
            elif re.search(r"(他|男孩|少年|boy)", text):
                character.gender_presentation = "male"
        if not character.age_range and re.search(r"(高中|少女|teen)", text, re.I):
            character.age_range = "teen"
        if not character.personality_visual_cues:
            character.personality_visual_cues = _first_match(
                [
                    (r"内向|害羞|shy", "shy reserved posture"),
                    (r"高傲|傲娇", "proud posture"),
                    (r"温柔|gentle", "soft gentle demeanor"),
                ],
                text,
            )

    if "environment" in image_types:
        scene = known_scene.model_copy() if known_scene else SceneCard()
        if umwelt_location and not scene.location:
            scene.location = umwelt_location
        if umwelt_agent is not None:
            st = getattr(umwelt_agent, "state", None)
            if st is not None and getattr(st, "mood", "") and not scene.mood:
                scene.mood = getattr(st, "mood")
        scene.location = scene.location or _first_match(
            [
                (r"天台|屋顶|rooftop", "high school rooftop"),
                (r"教室|classroom", "school classroom"),
                (r"街道|street", "city street"),
                (r"咖啡|cafe", "small cafe interior"),
                (r"车站|station", "train station platform"),
                (r"公园|park", "quiet park"),
            ],
            text,
        )
        scene.time_of_day = scene.time_of_day or _first_match(
            [
                (r"黄昏|夕阳|日落|sunset|golden hour", "golden hour sunset"),
                (r"夜晚|夜里|night", "night"),
                (r"清晨|早晨|morning", "early morning"),
                (r"午后|afternoon", "afternoon"),
            ],
            text,
        )
        scene.weather = scene.weather or _first_match(
            [
                (r"雨|rain", "light rain"),
                (r"雪|snow", "light snow"),
                (r"晴|clear", "clear sky"),
            ],
            text,
        )
        if not scene.lighting and "sunset" in (scene.time_of_day or ""):
            scene.lighting = "warm orange sunlight from the side"
        if not scene.mood:
            scene.mood = _first_match(
                [
                    (r"安静|quiet|nostalg", "quiet, nostalgic"),
                    (r"紧张|tense", "tense atmosphere"),
                    (r"浪漫|romantic", "soft romantic mood"),
                ],
                text,
            ) or "cinematic mood"
        if not scene.key_props and "rooftop" in (scene.location or ""):
            scene.key_props = ["chain-link fence", "water tower", "distant city"]
        scene.no_characters = True

    return VisualContext(character=character, scene=scene)
