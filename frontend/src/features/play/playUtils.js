export function historyToMessages(events, personaId) {
  return events
    .filter((event) => event.type === 'dialogue' || event.type === 'image' || event.type === 'narration')
    .map((event) => {
      const locationId = locationFromEvent(event);
      if (event.type === 'image') {
        let data = null;
        try {
          data = event.data ? JSON.parse(event.data) : null;
        } catch {
          data = null;
        }
        return {
          id: `evt-${event.id}`,
          kind: 'image',
          imageType: event.content,
          src: data?.mediaUrl || data?.url,
          actor: event.actor,
          subject: event.subject,
          agentId: event.subject,
          prompt: data?.prompt,
          locationId,
          location: data?.location || locationId,
          locationName: data?.locationName ?? null,
          reason: data?.reason ?? null,
        };
      }
      if (event.type === 'narration') {
        return { id: `evt-${event.id}`, kind: 'narration', text: event.content, locationId };
      }
      return {
        id: `evt-${event.id}`,
        kind: event.actor === personaId ? 'player' : 'agent',
        agentId: event.actor,
        actor: event.actor,
        text: event.content,
        locationId,
      };
    });
}

export function locationFromTags(tags = []) {
  const localTag = tags.find((tag) => typeof tag === 'string' && tag.startsWith('local:'));
  return localTag ? localTag.slice('local:'.length) : null;
}

/** Prefer explicit location in event.data (intro events use private tags without local:). */
export function locationFromEvent(event) {
  if (event?.data) {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data?.location) return data.location;
    } catch {
      // ignore malformed data
    }
  }
  return locationFromTags(event?.tags);
}

export function buildIdNameMap({ roster, personas, persona }) {
  const map = new Map();
  for (const character of roster.values()) map.set(character.id, character.name);
  for (const item of personas ?? []) map.set(item.id, item.name);
  if (persona) map.set(persona.id, persona.name);
  return map;
}

export function resolveIdsInText(text, idToName) {
  if (!text) return text;
  let out = text;
  for (const [id, name] of idToName) {
    if (!id || !name) continue;
    if (out.includes(id)) out = out.split(id).join(name);
    const head = id.split('-')[0];
    if (head.length >= 8 && head !== id && out.includes(head)) out = out.split(head).join(name);
  }
  return out;
}

export function signed(value) {
  const n = Number(value) || 0;
  return n > 0 ? `+${n}` : `${n}`;
}

export function relationshipTone(value) {
  const n = Number(value) || 0;
  if (n > 0) return 'positive';
  if (n < 0) return 'negative';
  return 'neutral';
}

export function hereAndElsewhere(roster, location) {
  const here = [];
  const elsewhere = [];
  for (const character of roster.values()) {
    (character.state?.location === location ? here : elsewhere).push(character);
  }
  return { here, elsewhere };
}

export function avatarFor(worldId, character) {
  return character?.avatar ? `/media/${worldId}/agents/${character.id}/${character.avatar}` : null;
}
