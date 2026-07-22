import { assetPath, emotionFromState, generatedPortraitMap, portraitCandidates } from './imageAssets.js';

export function personaAvatarCandidates(persona) {
  if (!persona?.id || !persona.avatar) return [];
  return [{ src: assetPath('personas', persona.id, persona.avatar), source: 'persona-avatar' }];
}

export function characterAvatarCandidates({ worldId, character, messages, focusAgentIds = [] }) {
  if (!worldId || !character?.id) return [];
  const generated = generatedPortraitMap(messages, focusAgentIds).get(character.id);
  const emotion = emotionFromState(character.state);
  const candidates = [];

  if (character.avatar) {
    candidates.push({
      src: assetPath(worldId, 'agents', character.id, character.avatar),
      source: 'avatar',
      headshot: true,
    });
  }

  candidates.push(
    ...portraitCandidates({ worldId, character, emotion, generated }).map((candidate) => ({
      ...candidate,
      headshot: candidate.source !== 'avatar',
    })),
  );

  return dedupeMedia(candidates);
}

export function firstMediaSrc(candidates) {
  return candidates.find((candidate) => candidate?.src)?.src ?? null;
}

export function shouldUseHeadshotCrop(candidates) {
  const first = candidates.find((candidate) => candidate?.src);
  return Boolean(first?.headshot);
}

function dedupeMedia(candidates) {
  const seen = new Set();
  const out = [];
  for (const candidate of candidates) {
    if (!candidate?.src || seen.has(candidate.src)) continue;
    seen.add(candidate.src);
    out.push(candidate);
  }
  return out;
}
