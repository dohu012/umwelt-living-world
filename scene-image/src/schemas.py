from __future__ import annotations

from typing import List, Literal, Optional, Dict

from pydantic import BaseModel, Field

ImageType = Literal["character_portrait", "environment", "image_edit"]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class AgentStatus(BaseModel):
    """Optional umwelt facts (Hook B keys) passed into the visual pipeline."""

    location: str = ""
    mood: str = ""
    action: str = ""
    affinity: str = ""
    relationship: str = ""


class UmweltAgent(BaseModel):
    """One NPC snapshot from umwelt RoomManager Hook C input."""

    id: str = ""
    name: str = ""
    state: AgentStatus = Field(default_factory=AgentStatus)
    profileHints: Dict[str, str] = Field(default_factory=dict)


class DetectResult(BaseModel):
    need_image: bool
    image_types: List[ImageType] = Field(default_factory=list)
    reason: str = ""
    priority: Optional[ImageType] = None


class CharacterCard(BaseModel):
    name: str = ""
    gender_presentation: str = ""
    age_range: str = ""
    hair: str = ""
    eyes: str = ""
    face: str = ""
    body: str = ""
    outfit: str = ""
    accessories: str = ""
    expression: str = ""
    pose: str = "standing, three-quarter view"
    personality_visual_cues: str = ""
    art_style: str = "anime illustration"
    extra: List[str] = Field(default_factory=list)


class SceneCard(BaseModel):
    location: str = ""
    time_of_day: str = ""
    weather: str = ""
    lighting: str = ""
    mood: str = ""
    key_props: List[str] = Field(default_factory=list)
    camera: str = "wide establishing shot"
    art_style: str = "anime background art"
    no_characters: bool = True
    extra: List[str] = Field(default_factory=list)


class VisualContext(BaseModel):
    character: Optional[CharacterCard] = None
    scene: Optional[SceneCard] = None


class ImagePrompt(BaseModel):
    image_type: ImageType
    prompt: str
    negative_prompt: str = ""
    size: str = "1024x1024"
    language: str = "en"
    notes: str = ""
    # Used when image_type == "image_edit" — path or URL of the source image.
    source_image: str = ""


class GeneratedImage(BaseModel):
    image_type: ImageType
    prompt: ImagePrompt
    path: Optional[str] = None
    url: Optional[str] = None
    seed: Optional[int] = None
    source_image: Optional[str] = None


class PipelineResult(BaseModel):
    detect: DetectResult
    context: VisualContext
    prompts: List[ImagePrompt] = Field(default_factory=list)
    images: List[GeneratedImage] = Field(default_factory=list)
    dry_run: bool = False
    error: Optional[str] = None
