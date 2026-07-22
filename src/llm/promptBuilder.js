const LANGUAGE_INSTRUCTION =
  'Always write your in-character dialogue/action in Chinese (中文), even if this character\'s ' +
  "persona, scenario, or dialogue examples above are written in English or any other language. " +
  'This overrides any language the character would "naturally" use in-world.';

/** Sentinel an agent (or the narrator) outputs verbatim to decline speaking this turn — see
 * groupSceneInstruction below and TurnRunner.runTurn/NarratorRunner, which check for it. Chosen to
 * be bracketed/all-caps English precisely so it's vanishingly unlikely to appear as genuine
 * in-character Chinese dialogue. */
export const SILENT_MARKER = '[[SILENT]]';

/** locationName: this agent's own current location fact, resolved to a display name. Stated as a
 * hard fact regardless of whether anyone else is present — grounds every line so it never
 * describes or reacts as if the character were somewhere else. */
function locationLine(locationName) {
  if (!locationName) return null;
  return `You are currently at: ${locationName}. Every line you write must be consistent with actually ` +
    'being here right now — never describe, reference, or react as though you were somewhere else.';
}

/** roster: display names of everyone else present (player + other agents), excluding this agent. */
function groupSceneInstruction(roster) {
  if (!roster || roster.length === 0) return null;
  return [
    `This is a multi-party scene, not a private 1:1 conversation. Present with you right now: ${roster.join(', ')}.`,
    'Every line from someone else in the transcript below is labeled "[Name]: ..." — that label only ' +
      'identifies who said it, it does NOT mean that line was addressed to you.',
    'Before you write anything, decide who this line is actually for: the player, one specific character ' +
      'by name, the whole group at once, or no one this turn — the most recent message is not necessarily ' +
      'directed at you, so never assume a strict back-and-forth with whoever spoke last. Let your own line ' +
      'make the target reasonably clear (naming them, or an obviously room-wide remark) — just decide it ' +
      "first, silently, rather than drifting into whoever you last read. Don't narrate this decision out loud.",
    `If you genuinely have nothing to say or do this turn, output exactly ${SILENT_MARKER} ` +
      'and nothing else — no punctuation, no narration, no partial sentence.',
  ].join('\n');
}

function personaBlock(profile) {
  const parts = [
    profile.system_prompt,
    `You are ${profile.name}.`,
    profile.description,
    profile.personality ? `Personality: ${profile.personality}` : null,
    profile.scenario ? `Scenario: ${profile.scenario}` : null,
  ].filter(Boolean);
  return parts.join('\n\n');
}

/** Pulls the `local:<id>` tag off an event's tag list (see EventStore.queryVisible, which already
 * attaches `.tags` to every row) — this is what lets the transcript below tell "happened here" from
 * "happened somewhere I've since left," now that an agent's own memory can span multiple locations
 * (see RoomManager._runScene's witnessIds tagging). */
function extractLocationId(tags) {
  const tag = tags?.find((t) => t.startsWith('local:'));
  return tag ? tag.slice('local:'.length) : null;
}

const SCENE_CHANGE_INSTRUCTION =
  'The transcript below may span more than one place you have been, since your own memory of ' +
  'anything you witnessed follows you wherever you go. A line like "[场景切换：X]" marks the point ' +
  'where you moved somewhere new — everything before such a marker is something you remember from ' +
  'that earlier place, not something happening in your current location now (see the "You are ' +
  'currently at" line above for where you actually are at this moment).';

/**
 * context: { profile, agentId, recentEvents, memorySummary?, resolveName?, roster?, locationName?, resolveLocationName? }
 * recentEvents: rows from EventStore.getRecentEvents() (type/actor/content/...)
 * memorySummary: rolling summary from ContextAssembler (milestone 3), or null/undefined.
 * resolveName: (actorId) => display name — so the transcript the model reads (and echoes back into
 *   its own dialogue) shows names, never raw agent/persona ids. Defaults to identity.
 * roster: display names of everyone else currently present (player + other agents), excluding this
 *   agent itself. Drives the group-scene framing below; omitted/empty when nobody else is around.
 * locationName: this agent's own current location fact, resolved to a display name via the
 *   location registry. Grounds every line in actually being there; omitted when unresolvable.
 * resolveLocationName: (locationId) => display name — same idea as resolveName, but for the
 *   per-event `[场景切换：X]` markers below. Defaults to identity.
 */
export function buildPrompt(context) {
  const {
    profile,
    agentId,
    recentEvents,
    memorySummary,
    resolveName = (id) => id,
    resolveLocationName = (id) => id,
    roster,
    locationName,
  } = context;

  const messages = [];
  let lastLocationId = null;
  let sceneMarkersUsed = false;
  for (const ev of recentEvents) {
    if (ev.type !== 'dialogue' && ev.type !== 'action' && ev.type !== 'system' && ev.type !== 'narration' && ev.type !== 'world_event') continue;
    if (!ev.content) continue;

    const evLocationId = extractLocationId(ev.tags);
    if (evLocationId && evLocationId !== lastLocationId) {
      // Only mark actual transitions — the very first location established (lastLocationId still
      // null) is just where the transcript starts, not a "change" worth calling out.
      if (lastLocationId !== null) {
        sceneMarkersUsed = true;
        appendCoalescing(messages, 'user', `[场景切换：${resolveLocationName(evLocationId)}]`);
      }
      lastLocationId = evLocationId;
    }

    const role = ev.actor === agentId ? 'assistant' : 'user';
    const label = ev.actor === agentId ? null : resolveName(ev.actor);
    const content = label ? `[${label}]: ${ev.content}` : ev.content;
    appendCoalescing(messages, role, content);
  }

  if (messages.length === 0 && profile.first_mes) {
    appendCoalescing(messages, 'user', '(The scene begins.)');
  }

  // Restated right at the end, closest to the point of generation — models weight the tail of a
  // long context more heavily than a system prompt stated once at the top, so on a long transcript
  // the "You are currently at" line up top alone isn't always enough to stop a stale prop/location
  // from an earlier scene bleeding into the new one (e.g. an agent still describing "the bar" a
  // couple turns after moving to a back alley). Cheap, and only fires when there's an actual
  // current location to restate.
  if (locationName) {
    appendCoalescing(messages, 'user', `[提醒：你现在身处「${locationName}」，接下来的发言/动作必须符合这一点]`);
  }

  const system = [
    personaBlock(profile),
    LANGUAGE_INSTRUCTION,
    locationLine(locationName),
    groupSceneInstruction(roster),
    sceneMarkersUsed ? SCENE_CHANGE_INSTRUCTION : null,
    memorySummary ? `[Summary of earlier events: ${memorySummary}]` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { system, messages };
}

/**
 * Most OpenAI-compatible backends reject 2+ consecutive same-role messages
 * (this is the norm for a single agent's own turn history, since every
 * prior turn of its own maps to "assistant" with nothing from another
 * actor in between). Merge adjacent same-role turns instead of sending
 * them as separate messages.
 */
function appendCoalescing(messages, role, content) {
  const last = messages.at(-1);
  if (last && last.role === role) {
    last.content += `\n${content}`;
  } else {
    messages.push({ role, content });
  }
}
