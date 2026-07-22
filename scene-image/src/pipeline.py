from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Union

from .bg_remove import remove_background
from .heuristics import detect_need_image, extract_edit_instruction, summarize_visual_context
from .prompt_builders import (
    build_character_portrait_prompt,
    build_environment_prompt,
    build_image_edit_prompt,
)
from .schemas import (
    CharacterCard,
    ChatMessage,
    DetectResult,
    GeneratedImage,
    ImagePrompt,
    PipelineResult,
    SceneCard,
    UmweltAgent,
    VisualContext,
)
from .stepfun_client import StepFunImageClient


def run_pipeline(
    messages: Union[List[ChatMessage], List[Dict]],
    *,
    dry_run: bool = False,
    force_types: Optional[List[str]] = None,
    known_character: Optional[Union[CharacterCard, Dict]] = None,
    known_scene: Optional[Union[SceneCard, Dict]] = None,
    lookback: int = 8,
    seed: int = 0,
    client: Optional[StepFunImageClient] = None,
    # umwelt RoomManager Hook C extras (optional)
    location: str = "",
    persona_id: str = "",
    request_image: bool = False,
    request_edit: bool = False,
    source_image: str = "",
    agents: Optional[List[Union[UmweltAgent, Dict]]] = None,
) -> PipelineResult:
    """Run detect → summarize → prompt → (optional) StepFun generate/edit.

    When called from umwelt, pass location / agents / request_image so status
    facts (mood, action, …) enrich CharacterCard / SceneCard. For edits, pass
    ``source_image`` (local path) and/or ``request_edit=True``.
    """
    _ = persona_id  # reserved for future affinity-facing portrait tweaks

    parsed = [
        m if isinstance(m, ChatMessage) else ChatMessage.model_validate(m) for m in messages
    ]
    kc = (
        None
        if known_character is None
        else known_character
        if isinstance(known_character, CharacterCard)
        else CharacterCard.model_validate(known_character)
    )
    ks = (
        None
        if known_scene is None
        else known_scene
        if isinstance(known_scene, SceneCard)
        else SceneCard.model_validate(known_scene)
    )
    parsed_agents: List[UmweltAgent] = []
    for a in agents or []:
        parsed_agents.append(a if isinstance(a, UmweltAgent) else UmweltAgent.model_validate(a))
    primary = parsed_agents[0] if parsed_agents else None

    detect = detect_need_image(parsed, lookback=lookback)
    if request_edit:
        detect.need_image = True
        detect.image_types = ["image_edit"]
        detect.reason = "umwelt intent flag requestEdit"
        detect.priority = "image_edit"
    elif request_image and not detect.need_image:
        detect.need_image = True
        detect.image_types = ["character_portrait"]
        detect.reason = "umwelt intent flag requestImage"
        detect.priority = "character_portrait"
    if force_types:
        detect.need_image = True
        detect.image_types = force_types  # type: ignore[assignment]
        detect.reason = f"forced types: {force_types}"
        detect.priority = detect.image_types[0] if detect.image_types else None

    if not detect.need_image:
        return PipelineResult(
            detect=detect,
            context=summarize_visual_context(
                parsed,
                [],
                known_character=kc,
                known_scene=ks,
                umwelt_agent=primary,
                umwelt_location=location,
            ),
            dry_run=dry_run,
        )

    # Edit path: needs a source image; summarize still runs for portrait/env types only.
    summarize_types = [t for t in detect.image_types if t != "image_edit"]
    context = summarize_visual_context(
        parsed,
        summarize_types,
        known_character=kc,
        known_scene=ks,
        umwelt_agent=primary,
        umwelt_location=location,
    )

    prompts: list[ImagePrompt] = []
    order = list(detect.image_types)
    if detect.priority and detect.priority in order:
        order = [detect.priority] + [t for t in order if t != detect.priority]

    for image_type in order:
        if image_type == "image_edit":
            src = (source_image or "").strip()
            if not src:
                return PipelineResult(
                    detect=detect,
                    context=context,
                    dry_run=dry_run,
                    error="image_edit requested but no source_image provided",
                )
            if not dry_run and not Path(src).is_file():
                return PipelineResult(
                    detect=detect,
                    context=context,
                    dry_run=dry_run,
                    error=f"source image not found: {src}",
                )
            instruction = extract_edit_instruction(parsed)
            prompts.append(build_image_edit_prompt(instruction, source_image=src))
        elif image_type == "character_portrait" and context.character:
            prompts.append(build_character_portrait_prompt(context.character))
        elif image_type == "environment" and context.scene:
            prompts.append(build_environment_prompt(context.scene))

    images: list[GeneratedImage] = []
    if not dry_run:
        sf = client or StepFunImageClient()
        for i, prompt in enumerate(prompts):
            if prompt.image_type == "image_edit":
                path, url, used_seed = sf.edit(
                    prompt,
                    source_image=prompt.source_image,
                    seed=seed + i,
                    filename_prefix="image_edit",
                )
            else:
                path, url, used_seed = sf.generate(
                    prompt,
                    seed=seed + i,
                    filename_prefix=f"{prompt.image_type}",
                )
            # Portraits need transparent cutouts for scene overlay.
            # Skip environment edits — rembg would destroy scene art.
            if prompt.image_type == "character_portrait":
                remove_background(path)
            elif prompt.image_type == "image_edit":
                src = (prompt.source_image or "").lower()
                if "portrait" in src or "/agents/" in src or "avatar" in src:
                    remove_background(path)
            images.append(
                GeneratedImage(
                    image_type=prompt.image_type,
                    prompt=prompt,
                    path=str(path),
                    url=url,
                    seed=used_seed,
                    source_image=prompt.source_image or None,
                )
            )

    return PipelineResult(
        detect=detect,
        context=context,
        prompts=prompts,
        images=images,
        dry_run=dry_run,
    )


def run_asset_pipeline(
    *,
    image_type: str,
    card: Union[CharacterCard, SceneCard, Dict],
    seed: int = 0,
    filename: Optional[str] = None,
    dry_run: bool = False,
    client: Optional[StepFunImageClient] = None,
) -> PipelineResult:
    """Hook E+F only: a caller-supplied visual card → prompt → one generated image.

    The umwelt visual sub-agent (or run_umwelt_bridge.py's "asset mode") owns detection and
    summarization upstream and hands the finished CharacterCard/SceneCard down here, so both are
    skipped — this is the counterpart to run_pipeline's full detect->summarize->generate flow.
    `filename` pins the exact output name (asset layer content keys) rather than a `<prefix>-
    <seed>.png` guess.
    """
    if image_type == "character_portrait":
        cc = card if isinstance(card, CharacterCard) else CharacterCard.model_validate(card)
        prompt = build_character_portrait_prompt(cc)
        context = VisualContext(character=cc)
    elif image_type == "environment":
        sc = card if isinstance(card, SceneCard) else SceneCard.model_validate(card)
        prompt = build_environment_prompt(sc)
        context = VisualContext(scene=sc)
    else:
        raise ValueError(f"run_asset_pipeline: unsupported image_type {image_type!r}")

    detect = DetectResult(
        need_image=True,
        image_types=[image_type],  # type: ignore[list-item]
        reason="asset mode: card already produced by caller",
        priority=image_type,  # type: ignore[arg-type]
    )

    images: list[GeneratedImage] = []
    if not dry_run:
        sf = client or StepFunImageClient()
        path, url, used_seed = sf.generate(prompt, seed=seed, filename=filename)
        if image_type == "character_portrait":
            remove_background(path)
        images.append(
            GeneratedImage(
                image_type=prompt.image_type,
                prompt=prompt,
                path=str(path),
                url=url,
                seed=used_seed,
            )
        )

    return PipelineResult(
        detect=detect, context=context, prompts=[prompt], images=images, dry_run=dry_run
    )


def load_dialogue_file(path: Union[str, Path]) -> List[ChatMessage]:
    import json

    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict) and "messages" in data:
        data = data["messages"]
    return [ChatMessage.model_validate(m) for m in data]
