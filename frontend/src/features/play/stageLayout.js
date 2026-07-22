const DEFAULT_LAYOUT = {
  speaker: { x: '50%', scale: '1.06', opacity: '0.98', z: 7, bottom: '0' },
  left: { x: '37%', scale: '0.94', opacity: '0.72', z: 4, bottom: '0.1rem' },
  right: { x: '63%', scale: '0.94', opacity: '0.72', z: 4, bottom: '0.1rem' },
  farLeft: { x: '25%', scale: '0.84', opacity: '0.58', z: 2, bottom: '-0.25rem' },
  farRight: { x: '75%', scale: '0.84', opacity: '0.58', z: 2, bottom: '-0.25rem' },
};

const LOCATION_LAYOUTS = {
  tavern: {
    speaker: { x: '48%', scale: '1.03', bottom: '-0.2rem' },
    left: { x: '35%' },
    right: { x: '64%' },
    farLeft: { x: '23%' },
    farRight: { x: '77%' },
  },
  alley: {
    speaker: { x: '54%', scale: '1.04' },
    left: { x: '38%' },
    right: { x: '68%' },
    farLeft: { x: '27%' },
    farRight: { x: '81%' },
  },
};

const SUPPORT_SLOTS = ['left', 'right', 'farLeft', 'farRight'];
const IDLE_SLOT_MAP = {
  1: ['speaker'],
  2: ['left', 'right'],
  3: ['left', 'speaker', 'right'],
  4: ['farLeft', 'left', 'right', 'farRight'],
};

export function createStageSlotMap({ characters, speakerId }) {
  const visible = selectVisibleCharacters(characters, speakerId);
  const slotMap = new Map();

  if (speakerId && visible.some((character) => character.id === speakerId)) {
    slotMap.set(speakerId, 'speaker');
    let supportIndex = 0;
    for (const character of visible) {
      if (character.id === speakerId) continue;
      slotMap.set(character.id, SUPPORT_SLOTS[supportIndex] ?? 'right');
      supportIndex += 1;
    }
    return slotMap;
  }

  const idleSlots = IDLE_SLOT_MAP[visible.length] ?? IDLE_SLOT_MAP[4];
  visible.forEach((character, index) => {
    slotMap.set(character.id, idleSlots[index] ?? 'right');
  });
  return slotMap;
}

export function buildStageActors({ characters, speakerId, previousSpeakerId, typingAgentIds = [], slotMap, location }) {
  const typingSet = new Set(typingAgentIds);
  const activeSlotMap = slotMap?.size ? slotMap : createStageSlotMap({ characters, speakerId });
  const layout = layoutForLocation(location);
  const visible = characters.filter((character) => activeSlotMap.has(character.id));

  return visible.map((character) => {
    const role = displayRoleFor({ character, speakerId, previousSpeakerId, typingSet });
    const slot = activeSlotMap.get(character.id) ?? 'right';
    return {
      character,
      slot,
      role,
      active: role === 'speaker' || role === 'typing',
      featured: role === 'speaker',
      style: styleForSlot(layout, slot, role),
    };
  });
}

function selectVisibleCharacters(characters, speakerId) {
  const visible = characters.slice(0, 4);
  if (!speakerId || visible.some((character) => character.id === speakerId)) return visible;

  const speaker = characters.find((character) => character.id === speakerId);
  if (!speaker) return visible;

  return [speaker, ...visible.filter((character) => character.id !== speakerId)].slice(0, 4);
}

function displayRoleFor({ character, speakerId, previousSpeakerId, typingSet }) {
  if (character.id === speakerId) return 'speaker';
  if (typingSet.has(character.id)) return 'typing';
  if (speakerId && character.id === previousSpeakerId) return 'previous';
  return 'present';
}

function layoutForLocation(location) {
  const normalized = String(location || '').toLowerCase();
  return mergeLayout(DEFAULT_LAYOUT, LOCATION_LAYOUTS[normalized]);
}

function mergeLayout(base, override = {}) {
  return {
    speaker: { ...base.speaker, ...override.speaker },
    left: { ...base.left, ...override.left },
    right: { ...base.right, ...override.right },
    farLeft: { ...base.farLeft, ...override.farLeft },
    farRight: { ...base.farRight, ...override.farRight },
  };
}

function styleForSlot(layout, slot, role) {
  const config = layout[slot] ?? layout.right;
  const supportingDim = role === 'present' || role === 'previous';
  return {
    '--stage-x': config.x,
    '--stage-bottom': config.bottom,
    '--stage-scale': config.scale,
    '--stage-opacity': supportingDim ? String(Math.max(0.52, Number(config.opacity) || 0.58)) : config.opacity,
    '--stage-z': config.z,
  };
}

export function slotClassName(slot) {
  switch (slot) {
    case 'speaker':
      return 'slot-speaker';
    case 'left':
      return 'slot-left';
    case 'right':
      return 'slot-right';
    case 'farLeft':
      return 'slot-far-left';
    case 'farRight':
      return 'slot-far-right';
    default:
      return 'slot-right';
  }
}
