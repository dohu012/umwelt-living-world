import * as THREE from 'three';
import { NODE_COLORS, NODE_TITLES } from './graphModel.js';

// The avatar ball is drawn dead-centre in its canvas, and the name plate lives in a
// *separate* sprite offset below it. That separation is the whole point: a sprite is
// centred on the node's simulation position, so anything baked into the same canvas as
// the ball (a caption under it) pushes the ball off-centre — which is exactly why the
// relationship lines used to meet somewhere below each portrait instead of on it.
const BALL_CANVAS = 320;
const BALL_RATIO = 0.46; // ball radius / canvas side
const GLOW_CANVAS = 160;
const GLOW_SPREAD = 1.7; // glow sprite size relative to the ball sprite
const PLATE_W = 512;
const PLATE_H = 148;

// Draw order within the transparent pass. The ball goes last so that it paints over any
// link already drawn behind it; links that are genuinely in front of a ball still win,
// because the ball also depth-tests.
const GLOW_RENDER_ORDER = 16;
const PLATE_RENDER_ORDER = 18;
const BALL_RENDER_ORDER = 20;
const LINK_RENDER_ORDER = 6;
const LINK_LABEL_RENDER_ORDER = 10;

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * The ball itself: fully opaque inside its circle, fully transparent outside. The hard
 * edge matters — this sprite writes depth (that is what occludes the links running
 * behind it), and a soft halo baked in here would write depth for its transparent
 * pixels too, punching a square hole in whatever is behind the node. The halo is a
 * separate, non-depth-writing sprite instead.
 */
function drawBallCanvas(node, image, type) {
  const canvas = document.createElement('canvas');
  canvas.width = BALL_CANVAS;
  canvas.height = BALL_CANVAS;

  const ctx = canvas.getContext('2d');
  const cx = BALL_CANVAS / 2;
  const cy = BALL_CANVAS / 2;
  const radius = BALL_CANVAS * BALL_RATIO;
  const color = NODE_COLORS[type] || NODE_COLORS.ally;

  const core = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  core.addColorStop(0, '#233454');
  core.addColorStop(0.55, '#182742');
  core.addColorStop(1, '#0d1628');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 3, 0, Math.PI * 2);
  ctx.clip();

  if (image) {
    // Cover-fit, biased upwards so a full-body portrait shows the face.
    const side = (radius - 3) * 2;
    const scale = Math.max(side / image.width, side / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    ctx.drawImage(image, cx - drawWidth / 2, cy - radius - (drawHeight - side) * 0.14, drawWidth, drawHeight);
  } else {
    ctx.fillStyle = '#41537a';
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = color;
    ctx.font = '600 96px "Segoe UI", "Microsoft YaHei UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(node.label ?? '?').charAt(0), cx, cy);
  }

  // Inner shading gives the flat disc a bit of volume.
  const shade = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.4, radius * 0.1, cx, cy, radius);
  shade.addColorStop(0, 'rgba(255,255,255,0.16)');
  shade.addColorStop(0.55, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(2,7,18,0.5)');
  ctx.fillStyle = shade;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();

  ctx.strokeStyle = color;
  ctx.lineWidth = type === 'center' ? 8 : 5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 2.5, 0, Math.PI * 2);
  ctx.stroke();

  return canvas;
}

function drawGlowCanvas(type) {
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_CANVAS;
  canvas.height = GLOW_CANVAS;
  const ctx = canvas.getContext('2d');
  const c = GLOW_CANVAS / 2;
  const color = NODE_COLORS[type] || NODE_COLORS.ally;
  const inner = (BALL_RATIO / GLOW_SPREAD) * GLOW_CANVAS;

  const gradient = ctx.createRadialGradient(c, c, inner * 0.92, c, c, c);
  gradient.addColorStop(0, `${color}55`);
  gradient.addColorStop(0.35, `${color}22`);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

function drawPlateCanvas(node, type) {
  const canvas = document.createElement('canvas');
  canvas.width = PLATE_W;
  canvas.height = PLATE_H;

  const ctx = canvas.getContext('2d');
  const color = NODE_COLORS[type] || NODE_COLORS.ally;

  ctx.fillStyle = 'rgba(242, 247, 255, 0.96)';
  ctx.font = '700 44px "Segoe UI", "Microsoft YaHei UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(3, 8, 18, 0.85)';
  ctx.shadowBlur = 10;
  ctx.fillText(String(node.label ?? ''), PLATE_W / 2, 8);

  ctx.fillStyle = `${color}dd`;
  ctx.font = '500 28px "Segoe UI", "Microsoft YaHei UI", sans-serif';
  ctx.fillText(NODE_TITLES[type] || '角色', PLATE_W / 2, 66);

  return canvas;
}

function spriteFrom(canvas, renderOrder, { depthWrite = false, alphaTest = 0 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite,
    alphaTest,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = renderOrder;
  return sprite;
}

/**
 * A node object is a Group whose origin is the centre of the avatar ball, so the
 * force layout's node position and the visual ball centre are the same point.
 */
export function createNodeObject(node, radius) {
  const group = new THREE.Group();
  const ballScale = radius / BALL_RATIO;

  const glow = spriteFrom(drawGlowCanvas(node.type), GLOW_RENDER_ORDER);
  glow.scale.set(ballScale * GLOW_SPREAD, ballScale * GLOW_SPREAD, 1);

  // alphaTest keeps the quad's transparent corners from writing depth, so the ball
  // occludes only where the portrait actually is.
  const ball = spriteFrom(drawBallCanvas(node, null, node.type), BALL_RENDER_ORDER, {
    depthWrite: true,
    alphaTest: 0.35,
  });
  ball.scale.set(ballScale, ballScale, 1);

  const plate = spriteFrom(drawPlateCanvas(node, node.type), PLATE_RENDER_ORDER);
  const plateWidth = ballScale * 0.78;
  const plateHeight = plateWidth * (PLATE_H / PLATE_W);
  plate.scale.set(plateWidth, plateHeight, 1);
  plate.position.set(0, -(radius + plateHeight * 0.62), 0);

  group.add(glow);
  group.add(ball);
  group.add(plate);

  group.userData = {
    glow,
    ball,
    plate,
    radius,
    image: null,
    paintKey: null,
    repaint(nextNode, type) {
      ball.material.map.image = drawBallCanvas(nextNode, group.userData.image, type);
      ball.material.map.needsUpdate = true;
      plate.material.map.image = drawPlateCanvas(nextNode, type);
      plate.material.map.needsUpdate = true;
      glow.material.map.image = drawGlowCanvas(type);
      glow.material.map.needsUpdate = true;
    },
    // Emphasis lives on the child sprites, never on the group: scaling the group
    // would also scale its local space, and 3d-force-graph's drag handler applies the
    // pointer delta to the group in that space — a hovered (and therefore scaled)
    // node would then drift away from the cursor as you drag it.
    emphasize(factor) {
      ball.scale.set(ballScale * factor, ballScale * factor, 1);
      glow.scale.set(ballScale * GLOW_SPREAD * factor, ballScale * GLOW_SPREAD * factor, 1);
      plate.scale.set(plateWidth * factor, plateHeight * factor, 1);
    },
    dispose() {
      [glow, ball, plate].forEach((sprite) => {
        sprite.material.map?.dispose();
        sprite.material.dispose();
      });
    },
  };

  return group;
}

export function drawLinkLabelCanvas(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(3, 10, 24, 0.72)';
  ctx.strokeStyle = `${color}aa`;
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 46, 30, 420, 60, 30);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#eef4ff';
  ctx.font = '700 30px "Segoe UI", "Microsoft YaHei UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text || '关系', canvas.width / 2, canvas.height / 2);
  return canvas;
}

// One unit-length beam, its base at the origin, pointing +Y — every link scales and
// orients this same geometry.
const BEAM_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
BEAM_GEOMETRY.translate(0, 0.5, 0);

/**
 * A relationship beam plus its floating label.
 *
 * The beam is trimmed at both ends so it starts on the surface of each ball rather than
 * at its centre: combined with the balls writing depth, a link now genuinely disappears
 * behind the characters it connects instead of being painted over them.
 */
export function createLinkObject(link) {
  const group = new THREE.Group();

  const material = new THREE.MeshBasicMaterial({
    color: link.color,
    transparent: true,
    opacity: 0.88,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(BEAM_GEOMETRY, material);
  beam.renderOrder = LINK_RENDER_ORDER;

  const label = spriteFrom(drawLinkLabelCanvas(link.label, link.color), LINK_LABEL_RENDER_ORDER);
  label.scale.set(76, 19, 1);

  group.add(beam);
  group.add(label);

  group.userData = {
    beam,
    label,
    setStyle(color, text) {
      material.color.set(color);
      label.material.map.image = drawLinkLabelCanvas(text, color);
      label.material.map.needsUpdate = true;
    },
    /** `start`/`end` are ball centres; `trim` is how much to cut off at each end. */
    place(start, end, trim, width, labelLift) {
      _dir.set(end.x - start.x, end.y - start.y, end.z - start.z);
      const length = _dir.length();
      const span = length - trim * 2;
      if (span <= 1) {
        group.visible = false;
        return;
      }
      group.visible = true;
      _dir.divideScalar(length);

      beam.position.set(start.x, start.y, start.z).addScaledVector(_dir, trim);
      beam.quaternion.setFromUnitVectors(UP, _dir);
      beam.scale.set(width, span, width);

      label.position.set(start.x, start.y, start.z).addScaledVector(_dir, length / 2);
      label.position.y += labelLift;
    },
    dispose() {
      material.dispose();
      label.material.map?.dispose();
      label.material.dispose();
    },
  };

  return group;
}

export function createStarfield(count = 900, spread = 4200) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const palette = [
    new THREE.Color('#dbe7ff'),
    new THREE.Color('#8fd3ff'),
    new THREE.Color('#ffe0a0'),
    new THREE.Color('#b7c6ff'),
  ];

  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    positions[i3] = (Math.random() - 0.5) * spread;
    positions[i3 + 1] = (Math.random() - 0.5) * spread * 0.72;
    positions[i3 + 2] = (Math.random() - 0.5) * spread;

    const color = palette[Math.floor(Math.random() * palette.length)];
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 5,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'kg-starfield';
  return points;
}

export function loadFirstImage(urls) {
  return new Promise((resolve, reject) => {
    const candidates = [...(urls ?? [])];
    const tryNext = () => {
      const src = candidates.shift();
      if (!src) {
        reject(new Error('No avatar candidate loaded'));
        return;
      }
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => tryNext();
      image.src = src;
    };
    tryNext();
  });
}
