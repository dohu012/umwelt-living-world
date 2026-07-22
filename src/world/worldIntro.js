import { introFactKey } from './loadWorldMetadata.js';

/**
 * Runs the authored world intro once per persona per intro.version.
 * Writes narration + opening dialogue + completion fact; pushes WS frames.
 * Does not call LLM.
 */
export function maybeRunWorldIntro({
  store,
  agentRegistry,
  metadata,
  personaId,
  locationId,
  sendFrame,
}) {
  const intro = metadata?.intro;
  if (!intro?.version) return null;

  const factKey = introFactKey(intro.version);
  if (store.getFact(personaId, factKey)) return null;

  const locationData = { location: locationId, intro: true };
  let openingAgentId = intro.openingAgentId ?? null;
  let openingAgentName = openingAgentId;
  let openingLine = null;

  if (openingAgentId) {
    try {
      const profile = agentRegistry.loadProfile(openingAgentId);
      openingAgentName = profile.name;
      openingLine = profile.first_mes?.trim() || null;
    } catch {
      openingAgentId = null;
      openingAgentName = null;
      openingLine = null;
    }
  }

  const witnessTags = [`private:${personaId}`];
  if (openingAgentId && openingLine) witnessTags.push(`private:${openingAgentId}`);

  let narrationEvent = null;
  const narrationText = intro.openingNarration?.trim() || null;
  if (narrationText) {
    narrationEvent = store.append(
      { type: 'narration', actor: 'narrator', subject: null, content: narrationText, data: locationData },
      witnessTags,
    );
  }

  let dialogueEvent = null;
  if (openingAgentId && openingLine) {
    dialogueEvent = store.append(
      {
        type: 'dialogue',
        actor: openingAgentId,
        subject: openingAgentId,
        content: openingLine,
        data: locationData,
      },
      witnessTags,
    );
  }

  store.append(
    {
      type: 'fact',
      actor: 'system',
      subject: personaId,
      key: factKey,
      content: String(intro.version),
      data: locationData,
    },
    [`private:${personaId}`],
  );

  const introPayload = {
    type: 'world_intro',
    name: metadata.name ?? null,
    subtitle: metadata.subtitle ?? null,
    playerRole: intro.playerRole ?? null,
    summary: intro.summary ?? null,
    environment: intro.environment ?? null,
    openingNarration: narrationText,
    openingAgentId: openingAgentId && openingLine ? openingAgentId : null,
    openingAgentName: openingAgentId && openingLine ? openingAgentName : null,
    openingLine,
    location: locationId,
  };

  sendFrame?.(introPayload);

  if (narrationEvent && narrationText) {
    sendFrame?.({ type: 'narration_message', text: narrationText, location: locationId, eventId: narrationEvent.id });
  }

  if (dialogueEvent && openingAgentId && openingLine) {
    sendFrame?.({
      type: 'agent_message',
      agentId: openingAgentId,
      dialogueText: openingLine,
      location: locationId,
      eventId: dialogueEvent.id,
    });
  }

  return introPayload;
}
