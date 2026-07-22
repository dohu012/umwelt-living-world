import { assetPath, emotionFromState, IMAGE_EXTENSIONS } from '../assets/imageAssets.js';

export const NODE_COLORS = {
  center: '#f4d67a',
  ally: '#78d3ff',
  enemy: '#ff8da1',
  rival: '#ffbd7a',
  neutral: '#b7c0d9',
  mystery: '#cba6ff',
};

export const NODE_TITLES = {
  center: '核心角色',
  ally: '友好',
  enemy: '敌对',
  rival: '紧张',
  neutral: '中立',
  mystery: '未知',
};

export const EDGE_COLORS = {
  ally: '#6fd3ff',
  enemy: '#ff8da1',
  rival: '#ffbd7a',
  neutral: '#cfd7ea',
  mystery: '#cba6ff',
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function readProfession(character) {
  return character?.profession
    ?? character?.occupation
    ?? character?.job
    ?? character?.role
    ?? character?.extensions?.profile?.profession
    ?? null;
}

function readGender(character) {
  return character?.gender
    ?? character?.sex
    ?? character?.extensions?.profile?.gender
    ?? null;
}

function relationshipTypeFromScore(score) {
  if (score >= 5) return 'ally';
  if (score <= -5) return 'enemy';
  if (score <= -2) return 'rival';
  if (score === 0) return 'mystery';
  return 'neutral';
}

export function describeRelationship(type) {
  switch (type) {
    case 'ally': return '友好';
    case 'enemy': return '敌对';
    case 'rival': return '紧张';
    case 'mystery': return '未知';
    default: return '中立';
  }
}

function relationScore(entry) {
  if (!entry) return 0;
  return asNumber(entry.affinity) + asNumber(entry.trust);
}

function edgeKey(source, target) {
  return source < target ? `${source}|${target}` : `${target}|${source}`;
}

function avatarCandidatesFor(worldId, character) {
  if (!worldId || !character?.id) return [];
  const emotion = emotionFromState(character.state);
  const portraitBase = assetPath(worldId, 'agents', character.id, 'portraits');
  const candidates = [
    ...IMAGE_EXTENSIONS.map((ext) => `${portraitBase}/${emotion}.${ext}`),
    ...IMAGE_EXTENSIONS.map((ext) => `${portraitBase}/neutral.${ext}`),
    ...IMAGE_EXTENSIONS.map((ext) => `${portraitBase}/default.${ext}`),
  ];

  if (character.avatar) candidates.push(assetPath(worldId, 'agents', character.id, character.avatar));
  if (character.portrait) candidates.push(assetPath(worldId, 'agents', character.id, character.portrait));
  if (character.image) candidates.push(assetPath(worldId, 'agents', character.id, character.image));

  return [...new Set(candidates)];
}

/**
 * Turns the polled roster into the shape the 3D scene consumes.
 *
 * `signature` is the identity of the *structure* (which nodes, which edges) only —
 * the scene uses it to tell a cheap in-place refresh (mood/affinity changed) apart
 * from a real rebuild, so a 2.5s roster poll never restarts the physics simulation
 * or interrupts a drag.
 */
export function buildGraphModel(roster, worldId, currentLocation) {
  const characters = [...roster.values()];
  if (characters.length === 0) {
    return { title: '关系图谱', nodes: [], edges: [], centerId: null, neighbors: new Map(), edgeTypes: new Map(), signature: '' };
  }

  const centerCharacter = characters.find((character) => character.state?.location === currentLocation) ?? characters[0];
  const centerId = String(centerCharacter.id);

  const nodes = characters.map((character) => {
    const direct = centerCharacter.state?.relationship?.[character.id];
    const reverse = character.state?.relationship?.[centerCharacter.id];
    const score = relationScore(direct) + relationScore(reverse);
    const type = String(character.id) === centerId ? 'center' : relationshipTypeFromScore(score);
    return {
      id: String(character.id),
      label: String(character.name ?? character.id),
      type,
      description: String(character.description ?? ''),
      avatarCandidates: avatarCandidatesFor(worldId, character),
      profession: readProfession(character),
      gender: readGender(character),
      mood: character.state?.mood ?? null,
      action: character.state?.action ?? null,
      location: character.state?.locationName ?? character.state?.location ?? null,
      relationshipText: (direct ?? reverse)?.label || (direct ?? reverse)?.note || describeRelationship(type),
      relationshipScore: score,
    };
  });

  const pairs = new Map();
  for (const character of characters) {
    for (const [targetId, detail] of Object.entries(character.state?.relationship ?? {})) {
      if (!roster.has(targetId) || String(targetId) === String(character.id)) continue;
      const key = edgeKey(String(character.id), String(targetId));
      const pair = pairs.get(key) ?? { key, source: null, target: null, forward: null, reverse: null };
      // Keep source/target deterministic (lexicographic) so the same relationship
      // always produces the same edge id across polls.
      [pair.source, pair.target] = key.split('|');
      if (pair.source === String(character.id)) pair.forward = detail;
      else pair.reverse = detail;
      pairs.set(key, pair);
    }
  }

  const edges = [...pairs.values()].map((pair) => {
    const score = relationScore(pair.forward) + relationScore(pair.reverse);
    const type = relationshipTypeFromScore(score);
    return {
      id: pair.key,
      source: pair.source,
      target: pair.target,
      type,
      label: pair.forward?.label ?? pair.reverse?.label ?? pair.forward?.note ?? pair.reverse?.note ?? describeRelationship(type),
      note: [pair.forward?.note, pair.reverse?.note].filter(Boolean).join(' / '),
      score,
    };
  });

  const neighbors = new Map(nodes.map((node) => [node.id, new Set()]));
  const edgeTypes = new Map();
  for (const edge of edges) {
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
    edgeTypes.set(edge.id, edge.type);
  }

  const signature = [
    nodes.map((node) => node.id).sort().join(','),
    edges.map((edge) => edge.id).sort().join(','),
  ].join('||');

  return { title: '角色关系图谱', nodes, edges, centerId, neighbors, edgeTypes, signature };
}

/** Relationship type between two characters, from the focused node's point of view. */
export function relationBetween(model, a, b) {
  return model.edgeTypes.get(edgeKey(a, b)) ?? null;
}

export function viewConfigFor(nodeCount) {
  const count = Math.max(1, nodeCount);
  // World-space constants only — the camera auto-fits, so these never need to
  // depend on the viewport size (which is why a window resize no longer has any
  // reason to rebuild the scene).
  const nodeRadius = clamp(46 - count * 0.9, 26, 44);
  const linkDistance = Math.round(clamp(nodeRadius * 5.4 - count * 3, 150, 260));
  const chargeStrength = -Math.round(clamp(900 + count * 60, 900, 2400));
  const focusRadius = Math.round(linkDistance * 1.25);
  return { nodeRadius, linkDistance, chargeStrength, focusRadius };
}
