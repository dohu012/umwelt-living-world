#!/usr/bin/env python3
"""Generate emotion portraits for one umwelt agent directory (used on character create).

Example:
  python scripts/generate_agent_portraits.py \\
    --agent-dir ../umwelt/data/world/w1/agents/alice
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.portrait_assets import card_from_profile, generate_agent_portraits  # noqa: E402
from src.stepfun_client import StepFunImageClient  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate portraits for one agent")
    parser.add_argument("--agent-dir", required=True, help="Path to agents/<agentId>/")
    parser.add_argument("--agent-id", default="", help="Override agent id (default: dirname)")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--skip-existing", action="store_true")
    parser.add_argument(
        "--no-avatar",
        action="store_true",
        help="Do not write avatar.png / profile.avatar",
    )
    args = parser.parse_args()

    agent_dir = Path(args.agent_dir).resolve()
    if not agent_dir.is_dir():
        raise SystemExit(f"agent dir not found: {agent_dir}")

    agent_id = args.agent_id or agent_dir.name
    profile_path = agent_dir / "profile.json"
    if not profile_path.is_file():
        raise SystemExit(f"profile.json missing in {agent_dir}")
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    card = card_from_profile(profile, agent_id=agent_id)

    out_dir = ROOT / "output" / "agent-portraits" / agent_id
    out_dir.mkdir(parents=True, exist_ok=True)
    client = StepFunImageClient(output_dir=out_dir)

    result = generate_agent_portraits(
        client,
        agent_dir=agent_dir,
        agent_id=agent_id,
        card=card,
        seed=args.seed,
        skip_existing=args.skip_existing,
        write_avatar=not args.no_avatar,
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
