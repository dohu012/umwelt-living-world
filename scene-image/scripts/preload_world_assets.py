#!/usr/bin/env python3
"""Pre-generate character emotion portraits + location backgrounds into umwelt media dirs.

Writes paths the frontend already probes:
  data/world/<worldId>/agents/<agentId>/portraits/{emotion}.png
  data/world/<worldId>/locations/<locationId>/background.png
  data/world/<worldId>/background.png  (world fallback)
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.portrait_assets import (  # noqa: E402
    card_from_profile,
    generate_agent_portraits,
)
from src.prompt_builders import build_environment_prompt  # noqa: E402
from src.schemas import CharacterCard, SceneCard  # noqa: E402
from src.stepfun_client import StepFunImageClient  # noqa: E402

# Visual cards derived from w1 profiles (bartender Alice / merchant Bob).
CHARACTER_CARDS: dict[str, CharacterCard] = {
    "alice": CharacterCard(
        name="Alice",
        gender_presentation="female",
        age_range="young adult",
        hair="dark brown hair in a practical short bob with side-swept bangs",
        eyes="sharp hazel eyes",
        face="slight smirk, observant bartender face",
        body="lean athletic build",
        outfit="rolled-sleeve white shirt, dark leather apron, tavern bartender clothes",
        accessories="simple silver earrings, cleaning cloth tucked in apron",
        expression="calm neutral expression",
        pose="standing, three-quarter view, one hand on hip",
        personality_visual_cues="dry-witted, confident, quietly protective aura",
        art_style="anime illustration",
        extra=["tavern bartender", "evening lighting"],
    ),
    "bob": CharacterCard(
        name="Bob",
        gender_presentation="male",
        age_range="adult",
        hair="messy sandy-brown hair",
        eyes="friendly brown eyes",
        face="gregarious traveler face, light stubble",
        body="sturdy medium build",
        outfit="dusty travel coat over vest and shirt, merchant traveler clothes",
        accessories="leather satchel strap, coin pouch",
        expression="calm neutral expression",
        pose="standing, three-quarter view, one hand on satchel",
        personality_visual_cues="talkative merchant, homesick wanderer energy",
        art_style="anime illustration",
        extra=["traveling merchant", "road-worn"],
    ),
}

LOCATION_CARDS: dict[str, SceneCard] = {
    "start": SceneCard(
        location="quiet village square outside a wooden tavern entrance called the Rusty Anchor",
        time_of_day="early evening",
        weather="clear",
        lighting="warm sunset glow, lanterns just lit",
        mood="calm introductory atmosphere",
        key_props=["cobblestone street", "tavern signboard", "wooden door", "barrels"],
        camera="wide establishing shot",
        art_style="anime background art",
        no_characters=True,
    ),
    "tavern": SceneCard(
        location="interior of the Rusty Anchor tavern bar room",
        time_of_day="night",
        weather="indoors",
        lighting="warm amber lantern light, soft shadows",
        mood="cozy slow Tuesday night",
        key_props=["wooden bar counter", "stools", "shelves of bottles", "fireplace", "tables"],
        camera="wide establishing shot from entrance toward the bar",
        art_style="anime background art",
        no_characters=True,
    ),
    "后巷": SceneCard(
        location="narrow back alley behind a tavern, brick walls and crates",
        time_of_day="night",
        weather="damp cool air",
        lighting="dim moonlight and a single wall lantern",
        mood="quiet, slightly tense backstreet atmosphere",
        key_props=["brick walls", "wooden crates", "trash barrels", "back door", "puddles"],
        camera="wide establishing shot down the alley",
        art_style="anime background art",
        no_characters=True,
    ),
    # 纠缠号 — sci-fi freighter interiors (no people)
    "食堂": SceneCard(
        location="mess hall of the freighter Entanglement: long metal tables, half-broken coffee machine, corkboard with crew photos, joke whiteboard about unauthorized observation of food",
        time_of_day="night",
        weather="indoors spaceship",
        lighting="dim red emergency alert light through portholes washing the tabletops, cool overhead panels",
        mood="tense post-red-alert gathering place, empty of people",
        key_props=["metal tables", "coffee machine", "corkboard", "portholes", "red alert glow"],
        camera="wide establishing shot of the empty mess hall",
        art_style="anime sci-fi background art",
        no_characters=True,
    ),
    "舰桥": SceneCard(
        location="bridge of the freighter Entanglement: wall-sized main screen showing a red decohered entanglement-link status, secondary screens with noisy call logs, empty captain chair",
        time_of_day="night",
        weather="indoors spaceship",
        lighting="cool blue-white console light mixed with harsh red status glow from the main screen",
        mood="urgent command-deck atmosphere, deserted",
        key_props=["main status screen", "consoles", "captain chair", "secondary monitors"],
        camera="wide establishing shot toward the main screen",
        art_style="anime sci-fi background art",
        no_characters=True,
    ),
    "纠缠舱": SceneCard(
        location="sealed cryogenic entanglement core chamber: locked low-temperature vault housing the main entanglement pair, access card reader, broken camera, calibration pegs",
        time_of_day="night",
        weather="indoors spaceship cold room",
        lighting="cold cyan cryogenic lights, frost haze, sparse red security LEDs",
        mood="restricted, sterile, slightly ominous",
        key_props=["cryogenic vault", "entanglement pair housing", "card reader", "broken camera", "calibration pegs"],
        camera="wide establishing shot of the sealed core room",
        art_style="anime sci-fi background art",
        no_characters=True,
    ),
    "会议室": SceneCard(
        location="emergency meeting room of the freighter: long conference table, electronic voting board, thick leather anomaly-observation logbook, regulation poster on the wall",
        time_of_day="night",
        weather="indoors spaceship",
        lighting="flat institutional fluorescent panels with a faint red alert wash",
        mood="formal confrontation space, empty chairs",
        key_props=["long table", "voting board", "logbook", "regulation poster", "blank report forms"],
        camera="wide establishing shot down the conference table",
        art_style="anime sci-fi background art",
        no_characters=True,
    ),
    "维修廊": SceneCard(
        location="narrow maintenance corridor packed with pipes and a spare quantum repeater, flickering lights, loose screw on the repeater casing, hatch to ventilation shaft",
        time_of_day="night",
        weather="indoors spaceship",
        lighting="flickering yellow utility lights, occasional dark stretches",
        mood="claustrophobic, industrial, slightly wrong",
        key_props=["pipes", "quantum repeater", "loose screw", "flickering lamps", "vent hatch"],
        camera="wide establishing shot along the corridor",
        art_style="anime sci-fi background art",
        no_characters=True,
    ),
    "通风管": SceneCard(
        location="tight ventilation maintenance shaft between cargo bay and entanglement chamber side wall, fresh scrape marks on the side panel, barely wide enough to sideways-walk",
        time_of_day="night",
        weather="indoors spaceship ducts",
        lighting="sparse emergency strips, deep shadows",
        mood="claustrophobic, eerie, rumor-haunted",
        key_props=["metal duct walls", "scrape marks", "grates", "narrow passage"],
        camera="wide establishing shot looking down the cramped shaft",
        art_style="anime sci-fi background art",
        no_characters=True,
    ),
}


def _copy(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    print(f"  -> {dest}")


def preload_portraits(
    client: StepFunImageClient,
    *,
    world_dir: Path,
    agent_id: str,
    card: CharacterCard,
    seed: int,
    skip_existing: bool,
) -> None:
    result = generate_agent_portraits(
        client,
        agent_dir=world_dir / "agents" / agent_id,
        agent_id=agent_id,
        card=card,
        seed=seed,
        skip_existing=skip_existing,
        write_avatar=True,
    )
    for emotion in result.get("generated", []):
        print(f"[gen] {agent_id}/{emotion}.png")
    for emotion in result.get("skipped", []):
        print(f"[skip] {agent_id}/{emotion}.png exists")
    if result.get("avatarWritten"):
        print(f"  -> {world_dir / 'agents' / agent_id / 'avatar.png'}")


def preload_locations(
    client: StepFunImageClient,
    *,
    world_dir: Path,
    location_ids: list[str],
    seed_base: int,
    skip_existing: bool,
) -> None:
    for i, loc_id in enumerate(location_ids):
        card = LOCATION_CARDS.get(loc_id)
        if card is None:
            # Generic fallback for unknown location ids.
            card = SceneCard(
                location=loc_id,
                time_of_day="day",
                lighting="natural light",
                mood="neutral scene",
                key_props=[],
                art_style="anime background art",
                no_characters=True,
            )
        out = world_dir / "locations" / loc_id / "background.png"
        if skip_existing and out.is_file():
            print(f"[skip] locations/{loc_id}/background.png exists")
            continue
        print(f"[gen] locations/{loc_id}/background.png")
        prompt = build_environment_prompt(card)
        path, _, used_seed = client.generate(
            prompt,
            seed=seed_base + i,
            filename_prefix=f"preload-loc-{loc_id}",
        )
        _copy(path, out)
        print(f"  seed={used_seed}")

    # World fallback background: prefer starting hub if present.
    preferred = None
    for candidate in ("食堂", "tavern", "start"):
        if candidate in location_ids:
            preferred = candidate
            break
    if preferred is None and location_ids:
        preferred = location_ids[0]
    if preferred:
        src = world_dir / "locations" / preferred / "background.png"
        if src.is_file():
            _copy(src, world_dir / "background.png")


def main() -> None:
    parser = argparse.ArgumentParser(description="Preload portraits + location backgrounds")
    parser.add_argument("--world-id", default="w1")
    parser.add_argument(
        "--world-root",
        default=str(ROOT.parent / "umwelt" / "data" / "world"),
        help="Path to umwelt data/world",
    )
    parser.add_argument("--agents", default="alice,bob", help="Comma-separated agent ids")
    parser.add_argument(
        "--locations",
        default="",
        help="Comma-separated location ids (default: read locations.json)",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--skip-existing", action="store_true")
    parser.add_argument("--portraits-only", action="store_true")
    parser.add_argument("--locations-only", action="store_true")
    args = parser.parse_args()

    world_dir = Path(args.world_root) / args.world_id
    if not world_dir.is_dir():
        raise SystemExit(f"world dir not found: {world_dir}")

    agent_ids = [a.strip() for a in args.agents.split(",") if a.strip()]
    if args.locations.strip():
        location_ids = [x.strip() for x in args.locations.split(",") if x.strip()]
    else:
        loc_file = world_dir / "locations.json"
        data = json.loads(loc_file.read_text(encoding="utf-8")) if loc_file.is_file() else {}
        location_ids = list((data.get("locations") or {}).keys())

    # Temp output for StepFun downloads; final assets are copied into world_dir.
    out_dir = ROOT / "output" / "preload" / args.world_id
    out_dir.mkdir(parents=True, exist_ok=True)
    client = StepFunImageClient(output_dir=out_dir)

    print(f"world={world_dir}")
    print(f"agents={agent_ids}")
    print(f"locations={location_ids}")
    print(f"model={client.model} edit_model={client.edit_model}")

    if not args.locations_only:
        for i, agent_id in enumerate(agent_ids):
            card = CHARACTER_CARDS.get(agent_id)
            if card is None:
                profile_path = world_dir / "agents" / agent_id / "profile.json"
                if not profile_path.is_file():
                    raise SystemExit(
                        f"no CharacterCard for agent '{agent_id}' and no profile.json at {profile_path}"
                    )
                profile = json.loads(profile_path.read_text(encoding="utf-8"))
                card = card_from_profile(profile, agent_id=agent_id)
                print(f"[card] built from profile for {agent_id}")
            preload_portraits(
                client,
                world_dir=world_dir,
                agent_id=agent_id,
                card=card,
                seed=args.seed + i * 100,
                skip_existing=args.skip_existing,
            )

    if not args.portraits_only:
        preload_locations(
            client,
            world_dir=world_dir,
            location_ids=location_ids,
            seed_base=args.seed + 1000,
            skip_existing=args.skip_existing,
        )

    print("done")


if __name__ == "__main__":
    main()
