# Umwelt Living World

Umwelt Living World is a persistent autonomous-agent simulation. The player does not directly
control a character. Instead, they observe a world that continues while they are away, offer
non-binding advice when agents reach important decisions, and shape the environment through
large-scale events such as storms, blackouts, arrivals, or accidents.

This repository started from the original local Umwelt multi-agent simulation, but has its own Git
history and intentionally excludes the original repository's runtime worlds, settings, secrets,
dependencies, and build output.

## Product principles

1. **The world does not wait for the player.** Simulation time and scheduled work are persisted in
   each world's SQLite database.
2. **Agents retain autonomy.** Player suggestions are inputs to a decision, not commands.
3. **World events create conditions, not scripted outcomes.** A typhoon changes the environment;
   agents decide how to prepare and respond.
4. **Everything important becomes an event.** History can be inspected and summarized when the
   player returns.
5. **Rules decide consequences; language models express them.** Structured actions preserve
   causality, while LLMs handle reasoning and narrative presentation at important moments.

## Current foundation

The first living-world slice adds:

- a persistent per-world clock with pause, resume, acceleration, and manual advancement;
- a SQLite-backed scheduled job queue that survives process restarts;
- staged world-will events (`forecast` → `impact` → `aftermath`);
- persistent agent decision points and non-binding world-will suggestions;
- autonomous agent needs, schedules, movement, work, rest, eating, socializing, and sheltering;
- persistent environment state changed by staged weather events;
- a background worker that ticks every world even when no player is connected;
- REST endpoints for clock control, event scheduling, decisions, and manual ticking.

The original dialogue, characters, visibility policies, world templates, event history, and
WebSocket play mode remain available while the autonomous-life layer is developed.

The Python image pipeline is included under `scene-image/` rather than assumed to exist in a
sibling repository. Its API credentials remain local and are ignored by Git.

## Development

Requires Node.js 18 or newer.

```powershell
npm install
cd frontend
npm install
cd ..
npm test
npm run serve
```

In a second terminal:

```powershell
cd frontend
npm run dev
```

The backend listens on port `4001`. Vite proxies `/api`, `/media`, and `/ws` to it.

## Living-world API

For a world with id `纠缠号`:

```text
GET  /api/worlds/纠缠号/simulation/clock
POST /api/worlds/纠缠号/simulation/clock
GET  /api/worlds/纠缠号/simulation/events
POST /api/worlds/纠缠号/simulation/events
GET  /api/worlds/纠缠号/simulation/decisions
GET  /api/worlds/纠缠号/simulation/agents
GET  /api/worlds/纠缠号/simulation/environment
POST /api/worlds/纠缠号/simulation/decisions
POST /api/worlds/纠缠号/simulation/decisions/:decisionId/suggestions
POST /api/worlds/纠缠号/simulation/tick
```

Schedule a typhoon-like event:

```json
{
  "kind": "typhoon",
  "title": "台风登陆",
  "scheduledAt": "2026-07-23T18:00:00.000Z",
  "intensity": 0.8,
  "scope": "临海镇",
  "data": {
    "leadTimeMs": 21600000,
    "durationMs": 32400000,
    "effects": ["heavy_rain", "power_outage_risk", "road_closure"]
  }
}
```

Control time:

```json
{ "action": "pause" }
{ "action": "resume" }
{ "action": "set_scale", "timeScale": 12 }
{ "action": "advance", "hours": 6 }
```

## Next milestones

1. Structured environment state and object interactions.
2. Agent needs, schedules, goals, and action planning.
3. Decision deadlines and autonomous option resolution influenced—but not controlled—by advice.
4. Event-specific effect resolvers for weather, failures, arrivals, and resource crises.
5. Offline digest and historical story timeline.
6. A world overview UI with time controls, scheduled events, and pending decisions.
