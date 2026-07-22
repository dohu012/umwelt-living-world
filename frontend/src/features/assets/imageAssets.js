// Every bundled template and the portrait/background generators currently emit PNG. Probe that
// canonical format first so a successful render does not create a noisy, guaranteed WebP 404 in
// DevTools before falling back to the file that is actually present.
export const IMAGE_EXTENSIONS = ['png', 'webp', 'jpg', 'jpeg'];

const EMOTION_ALIASES = [
  ['happy', ['开心', '高兴', '愉快', '轻松', '满意', '兴奋', 'happy', 'joy', 'smile']],
  ['angry', ['生气', '愤怒', '恼火', '不满', 'angry', 'rage']],
  ['sad', ['悲伤', '难过', '沮丧', '失落', 'sad', 'sorrow']],
  ['fear', ['害怕', '恐惧', '紧张', '警惕', '担心', 'fear', 'afraid', 'nervous']],
  ['surprised', ['惊讶', '震惊', '意外', 'surprise', 'surprised']],
  ['neutral', ['平静', '普通', '默认', 'neutral', 'idle']],
];

export function assetPath(...segments) {
  return `/media/${segments.map((segment) => encodeURIComponent(String(segment))).join('/')}`;
}

export function emotionFromState(state) {
  const text = `${state?.mood ?? ''} ${state?.action ?? ''}`.toLowerCase();
  if (!text.trim()) return 'neutral';
  for (const [emotion, aliases] of EMOTION_ALIASES) {
    if (aliases.some((alias) => text.includes(alias.toLowerCase()))) return emotion;
  }
  return 'neutral';
}

function imageCandidatesForBase(basePath, label, meta = {}) {
  return IMAGE_EXTENSIONS.map((ext) => ({
    src: `${basePath}.${ext}`,
    label,
    ...meta,
  }));
}

export function portraitManifestUrl(worldId, agentId) {
  return assetPath(worldId, 'agents', agentId, 'portraits', 'manifest.json');
}

export function portraitCandidates({ worldId, character, emotion, manifest, generated }) {
  if (!worldId || !character?.id) return [];
  const base = assetPath(worldId, 'agents', character.id, 'portraits');
  const manifestEmotion = manifest?.emotions?.[emotion];
  const manifestDefault = manifest?.default || manifest?.emotions?.neutral;
  const candidates = [];

  if (manifestEmotion) {
    candidates.push({ src: `${base}/${manifestEmotion}`, label: `${emotion} 立绘`, source: 'manifest' });
  }
  candidates.push(...imageCandidatesForBase(`${base}/${emotion}`, `${emotion} 立绘`, { source: 'fixed-emotion' }));

  if (generated?.src) {
    candidates.push({ src: generated.src, label: '最近生成立绘', source: 'generated' });
  }

  if (manifestDefault && manifestDefault !== manifestEmotion) {
    candidates.push({ src: `${base}/${manifestDefault}`, label: '默认立绘', source: 'manifest-default' });
  }
  for (const name of ['neutral', 'default']) {
    candidates.push(...imageCandidatesForBase(`${base}/${name}`, name === 'neutral' ? '中性立绘' : '默认立绘', { source: 'fixed-default' }));
  }
  if (character.avatar) {
    candidates.push({ src: assetPath(worldId, 'agents', character.id, character.avatar), label: '角色头像', source: 'avatar' });
  }

  return dedupeCandidates(candidates);
}

export function backgroundCandidates({ worldId, location, messages }) {
  const latestSceneImage = [...(messages ?? [])]
    .reverse()
    .find(
      (message) =>
        message.kind === 'image' &&
        isBackgroundImageType(message.imageType) &&
        message.src &&
        (!message.location || message.location === location),
    );
  const candidates = [];
  if (latestSceneImage?.src) {
    candidates.push({ src: latestSceneImage.src, label: '最近生成场景图', source: 'generated' });
  }

  if (worldId && location) {
    const locationBase = assetPath(worldId, 'locations', location);
    candidates.push(...imageCandidatesForBase(`${locationBase}/background`, '当前地点背景', { source: 'location-background' }));
    candidates.push(...imageCandidatesForBase(assetPath(worldId, 'images', `${location}-background`), '当前地点场景图', { source: 'location-image' }));
    candidates.push(...imageCandidatesForBase(assetPath(worldId, 'images', location), '当前地点场景图', { source: 'location-image' }));
  }
  if (worldId) {
    candidates.push(...imageCandidatesForBase(assetPath(worldId, 'background'), '世界背景', { source: 'world-background' }));
  }
  candidates.push({ src: `/api/worlds/${encodeURIComponent(worldId)}/background`, label: '世界背景', source: 'api-background' });
  return dedupeCandidates(candidates);
}

export function isPortraitImageType(type) {
  return ['character_portrait', 'portrait', 'character', 'standing', '立绘', '角色立绘'].includes(type);
}

export function isBackgroundImageType(type) {
  return ['environment', 'background', 'scene', 'scene_background', '场景图', '环境图'].includes(type);
}

export function generatedPortraitMap(messages, fallbackResponderIds = []) {
  const map = new Map();
  const fallbackTarget = fallbackResponderIds[0];
  for (const message of messages ?? []) {
    if (message.kind !== 'image' || !message.src || !isPortraitImageType(message.imageType)) continue;
    const target = message.subject || message.agentId || fallbackTarget;
    if (!target) continue;
    map.set(target, message);
  }
  return map;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const out = [];
  for (const candidate of candidates) {
    if (!candidate?.src || seen.has(candidate.src)) continue;
    seen.add(candidate.src);
    out.push(candidate);
  }
  return out;
}
