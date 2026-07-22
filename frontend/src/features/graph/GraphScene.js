import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { clamp, EDGE_COLORS, NODE_TITLES, relationBetween, viewConfigFor } from './graphModel.js';
import { createLinkObject, createNodeObject, createStarfield, loadFirstImage } from './graphObjects.js';

const FIT_DURATION = 700;
const FOCUS_DURATION = 760;
const FLOAT_AMPLITUDE = 0.16; // × ball radius
const FLOAT_PERIOD = 4600; // ms for a full bob cycle

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function tooltipForNode(node) {
  const items = [
    ['职业', node.profession ?? '未设定'],
    ['性别', node.gender ?? '未设定'],
    ['状态', node.mood || node.action || '未知'],
    ['地点', node.location ?? '未知'],
    ['关系', node.relationshipText ?? '未知'],
  ];
  return `
    <div class="kg-tooltip">
      <strong>${escapeHtml(node.label)}</strong>
      <span>${escapeHtml(NODE_TITLES[node.type] || '角色')}</span>
      ${items.map(([label, value]) => `<div><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></div>`).join('')}
      ${node.description ? `<p>${escapeHtml(node.description)}</p>` : ''}
    </div>
  `;
}

/** Evenly spreads `count` points over a sphere (fibonacci), used for seeds and for the focus ring. */
function spherePoint(index, count, radius) {
  if (count <= 1) return { x: radius, y: 0, z: 0 };
  const offset = 2 / count;
  const increment = Math.PI * (3 - Math.sqrt(5));
  const y = index * offset - 1 + offset / 2;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = index * increment;
  return {
    x: Math.cos(phi) * ring * radius,
    y: y * radius * 0.62,
    z: Math.sin(phi) * ring * radius,
  };
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

/**
 * Owns the WebGL relationship graph.
 *
 * Two invariants drive the whole design:
 *
 * 1. Simulation node objects are created once and then mutated in place. The roster is
 *    polled every 2.5s; the previous implementation handed 3d-force-graph brand-new node
 *    objects on every poll, which reset the physics layout, rebuilt every sprite and
 *    cancelled any in-progress drag. `.graphData()` is now only called when the set of
 *    node/edge ids actually changes.
 * 2. Once the opening layout settles, every node is pinned (fx/fy/fz). From then on the
 *    graph is script-driven: dragging moves exactly one node, and focus mode can place
 *    nodes deterministically instead of negotiating with the force simulation.
 * 3. A render loop — not the physics engine — places the visuals. Node data holds the
 *    *resting* position; the loop adds the idle float on top and derives both the node
 *    objects and the link beams from that same bobbed position, which is what keeps the
 *    beams attached to the balls at all times.
 */
export default class GraphScene {
  constructor(container, { onSelect, onFocusChange } = {}) {
    this.container = container;
    this.onSelect = onSelect ?? (() => {});
    this.onFocusChange = onFocusChange ?? (() => {});

    this.fg = null;
    this.model = null;
    this.signature = null;
    this.view = viewConfigFor(1);

    this.nodeData = new Map();
    this.linkData = new Map();
    this.objects = new Map();
    this.linkObjects = new Map();
    this.home = new Map();
    this.floatOffsets = new Map();
    this.floatPhases = new Map();
    this.floatWeight = 0;

    this.focusId = null;
    this.visibleIds = null;
    this.settled = false;
    this.recentred = false;
    this.nodeRadius = this.view.nodeRadius;
    this.animFrame = null;
    this.renderFrameId = null;
    this.disposed = false;
  }

  /** Stable per-character phase so the crowd drifts out of sync with itself. */
  floatPhase(id) {
    const cached = this.floatPhases.get(id);
    if (cached !== undefined) return cached;
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 100000;
    const phase = (hash / 100000) * Math.PI * 2;
    this.floatPhases.set(id, phase);
    return phase;
  }

  // ---------------------------------------------------------------- lifecycle

  setModel(model) {
    if (this.disposed) return;
    this.model = model;
    if (model.nodes.length === 0) return;

    if (!this.fg) {
      this.init(model);
      return;
    }
    if (model.signature === this.signature) {
      this.refreshInPlace(model);
      return;
    }
    this.rebuildData(model);
  }

  init(model) {
    this.signature = model.signature;
    this.view = viewConfigFor(model.nodes.length);
    this.nodeRadius = this.view.nodeRadius;

    model.nodes.forEach((node, index) => {
      const seed = spherePoint(index, model.nodes.length, this.view.linkDistance * 0.9);
      this.nodeData.set(node.id, { ...node, ...seed });
    });
    model.edges.forEach((edge) => this.linkData.set(edge.id, this.buildLink(edge)));

    const fg = ForceGraph3D()(this.container)
      .graphData(this.graphData())
      .numDimensions(3)
      .backgroundColor('rgba(0,0,0,0)')
      .showNavInfo(false)
      .warmupTicks(20)
      .cooldownTicks(140)
      .nodeRelSize(1)
      .nodeLabel(tooltipForNode)
      .nodeVisibility(() => true)
      .nodeThreeObject((node) => this.nodeObject(node))
      // The render loop is the only thing that positions node objects. Without this the
      // engine's tick loop (which runs during a drag) would keep resetting objects to
      // the un-floated position, and the balls would judder between the two.
      .nodePositionUpdate(() => true)
      .linkVisibility(() => true)
      .linkCurvature(0)
      .linkDirectionalParticles((link) => (link.style === 'enemy' ? 5 : link.style === 'neutral' ? 3 : 4))
      .linkDirectionalParticleWidth(2)
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleColor((link) => link.color)
      .linkDirectionalParticleResolution(10)
      // Links are ours end to end. The library's own line runs centre-to-centre, which
      // cannot be trimmed back to the ball surfaces, so it is replaced outright:
      // returning true from linkPositionUpdate tells the library to leave geometry alone.
      .linkThreeObject((link) => this.linkObject(link))
      .linkPositionUpdate(() => true)
      .onNodeHover((node) => this.handleHover(node))
      .onNodeClick((node) => this.handleNodeClick(node))
      .onBackgroundClick(() => this.clearFocus())
      .onNodeDrag((node) => this.handleDrag(node))
      .onNodeDragEnd((node) => this.handleDragEnd(node))
      .onEngineStop(() => this.handleEngineStop());

    fg.d3Force('link').distance(this.view.linkDistance);
    fg.d3Force('charge').strength(this.view.chargeStrength);
    // No centering force: it fights pinned nodes every tick. The layout is recentred
    // once, by hand, when it first settles.
    fg.d3Force('center', null);

    const scene = fg.scene();
    this.starfield = createStarfield();
    scene.add(this.starfield);
    scene.add(new THREE.AmbientLight(0x9fb6ff, 1.15));
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x08111f, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 1, 1);
    scene.add(key);

    this.fg = fg;
    this.resize();
    this.startRenderLoop();
    this.onSelect(this.nodeData.get(model.centerId) ?? model.nodes[0] ?? null);
  }

  dispose() {
    this.disposed = true;
    this.stopAnimation();
    this.stopRenderLoop();
    this.objects.forEach((group) => group.userData.dispose?.());
    this.objects.clear();
    this.linkObjects.forEach((group) => group.userData.dispose?.());
    this.linkObjects.clear();
    if (this.fg) {
      const scene = this.fg.scene();
      if (this.starfield) {
        scene.remove(this.starfield);
        this.starfield.geometry?.dispose();
        this.starfield.material?.dispose();
      }
      this.fg._destructor?.();
    }
    // `_destructor` tears down the renderer but leaves the canvas it appended in the
    // DOM. Under StrictMode (mount → unmount → remount in dev) that dead canvas stays
    // stacked on top of the live one and eats every pointer event, so clicking a
    // character does nothing. Clear the container ourselves.
    this.container?.replaceChildren();
    this.fg = null;
  }

  /**
   * Keeps the renderer in sync with the container. Without this the canvas stays at the
   * library's default 1200x800 while the container is a different size, and pointer
   * coordinates (which are normalised against the *declared* width/height) no longer
   * line up with what is on screen — hover and click end up hitting the wrong node, or
   * nothing at all.
   */
  resize() {
    if (!this.fg || !this.container) return;
    const width = this.container.clientWidth || 1280;
    const height = this.container.clientHeight || 720;
    this.fg.width(width).height(height);
  }

  // -------------------------------------------------------------- render loop

  /**
   * Places every visual each frame. This runs independently of the physics engine,
   * which stops as soon as the layout settles — the idle float and the link beams both
   * need to keep updating long after that.
   */
  startRenderLoop() {
    const frame = (now) => {
      if (this.disposed) return;
      this.renderNodes(now);
      this.renderLinks();
      this.renderFrameId = requestAnimationFrame(frame);
    };
    this.renderFrameId = requestAnimationFrame(frame);
  }

  stopRenderLoop() {
    if (this.renderFrameId === null) return;
    cancelAnimationFrame(this.renderFrameId);
    this.renderFrameId = null;
  }

  /**
   * The float is a pure render-time offset: node data keeps the resting position, so
   * dragging, focus targets and camera fitting all stay in undisturbed coordinates.
   */
  renderNodes(now) {
    // Ease the float in and out rather than switching it: the layout un-settles whenever
    // a character joins, and a hard cut would read as a hiccup across the whole scene.
    this.floatWeight += ((this.settled ? 1 : 0) - this.floatWeight) * 0.04;
    const amplitude = this.nodeRadius * FLOAT_AMPLITUDE * this.floatWeight;
    const t = (now / FLOAT_PERIOD) * Math.PI * 2;

    this.nodeData.forEach((node, id) => {
      let offset = this.floatOffsets.get(id);
      if (!offset) {
        offset = { x: 0, y: 0, z: 0 };
        this.floatOffsets.set(id, offset);
      }
      if (amplitude < 0.001) {
        offset.x = 0;
        offset.y = 0;
        offset.z = 0;
      } else {
        const phase = this.floatPhase(id);
        offset.x = Math.sin(t * 0.71 + phase * 1.7) * amplitude * 0.42;
        offset.y = Math.sin(t + phase) * amplitude;
        offset.z = Math.cos(t * 0.63 + phase * 2.3) * amplitude * 0.42;
      }

      const group = this.objects.get(id);
      if (group) {
        group.position.set(
          (node.x ?? 0) + offset.x,
          (node.y ?? 0) + offset.y,
          (node.z ?? 0) + offset.z,
        );
      }
    });
  }

  /** Reads the same bobbed positions the balls were just placed at, so beams stay glued. */
  renderLinks() {
    const trim = this.nodeRadius * 1.08;
    const labelLift = this.nodeRadius * 0.34;

    this.linkObjects.forEach((group, id) => {
      const link = this.linkData.get(id);
      if (!link) return;
      const start = this.renderedPosition(link.source);
      const end = this.renderedPosition(link.target);
      if (!start || !end) {
        group.visible = false;
        return;
      }
      const width = link.style === 'enemy' ? 1.5 : link.style === 'rival' ? 1.3 : 1.1;
      group.userData.place(start, end, trim, width, labelLift);
    });
  }

  renderedPosition(endpoint) {
    const id = endpoint?.id ?? endpoint;
    const node = this.nodeData.get(id);
    if (!node) return null;
    const offset = this.floatOffsets.get(id) ?? { x: 0, y: 0, z: 0 };
    return { x: (node.x ?? 0) + offset.x, y: (node.y ?? 0) + offset.y, z: (node.z ?? 0) + offset.z };
  }

  // ------------------------------------------------------------- data plumbing

  graphData() {
    return { nodes: [...this.nodeData.values()], links: [...this.linkData.values()] };
  }

  buildLink(edge) {
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      note: edge.note,
      style: edge.type,
      color: EDGE_COLORS[edge.type] || EDGE_COLORS.neutral,
    };
  }

  /** Same structure, new values: mutate what already exists, touch nothing else. */
  refreshInPlace(model) {
    model.nodes.forEach((node) => {
      const existing = this.nodeData.get(node.id);
      if (existing) Object.assign(existing, node);
    });
    model.edges.forEach((edge) => {
      const link = this.linkData.get(edge.id);
      if (!link) return;
      const changed = link.label !== edge.label || link.style !== edge.type;
      link.label = edge.label;
      link.note = edge.note;
      link.style = edge.type;
      link.color = EDGE_COLORS[edge.type] || EDGE_COLORS.neutral;
      if (changed) this.linkObjects.get(edge.id)?.userData.setStyle(link.color, link.label);
    });
    this.repaintNodes();
  }

  /** A character joined or left, or a relationship appeared: reseed only what is new. */
  rebuildData(model) {
    this.signature = model.signature;
    this.view = viewConfigFor(model.nodes.length);

    const liveNodeIds = new Set(model.nodes.map((node) => node.id));
    [...this.nodeData.keys()].forEach((id) => {
      if (liveNodeIds.has(id)) return;
      this.nodeData.delete(id);
      this.home.delete(id);
      this.floatOffsets.delete(id);
      this.objects.get(id)?.userData.dispose?.();
      this.objects.delete(id);
    });

    model.nodes.forEach((node) => {
      const existing = this.nodeData.get(node.id);
      if (existing) {
        Object.assign(existing, node);
        return;
      }
      // Drop a newcomer next to whoever it already knows, so it doesn't fly in from
      // the other side of the scene. It stays unpinned so the force layout can seat it.
      this.nodeData.set(node.id, { ...node, ...this.seedNear(model, node.id) });
      this.settled = false;
    });

    const liveEdgeIds = new Set(model.edges.map((edge) => edge.id));
    [...this.linkData.keys()].forEach((id) => {
      if (liveEdgeIds.has(id)) return;
      this.linkData.delete(id);
      this.linkObjects.get(id)?.userData.dispose?.();
      this.linkObjects.delete(id);
    });
    model.edges.forEach((edge) => {
      const existing = this.linkData.get(edge.id);
      if (!existing) {
        this.linkData.set(edge.id, this.buildLink(edge));
        return;
      }
      Object.assign(existing, this.buildLink(edge));
      this.linkObjects.get(edge.id)?.userData.setStyle(existing.color, existing.label);
    });

    this.fg.graphData(this.graphData());
    this.fg.d3Force('link').distance(this.view.linkDistance);
    this.fg.d3Force('charge').strength(this.view.chargeStrength);

    if (this.focusId && !this.nodeData.has(this.focusId)) this.clearFocus();
    else if (this.focusId) this.focus(this.focusId, { animate: false });
    else this.applyVisibility();

    this.repaintNodes();
  }

  seedNear(model, id) {
    const known = [...(model.neighbors.get(id) ?? [])]
      .map((neighborId) => this.nodeData.get(neighborId))
      .filter(Boolean);
    const jitter = () => (Math.random() - 0.5) * this.view.linkDistance;
    if (known.length === 0) return { x: jitter(), y: jitter(), z: jitter() };
    const sum = known.reduce((acc, node) => ({
      x: acc.x + (node.x ?? 0), y: acc.y + (node.y ?? 0), z: acc.z + (node.z ?? 0),
    }), { x: 0, y: 0, z: 0 });
    return {
      x: sum.x / known.length + jitter() * 0.4,
      y: sum.y / known.length + jitter() * 0.4,
      z: sum.z / known.length + jitter() * 0.4,
    };
  }

  // ------------------------------------------------------------ three objects

  nodeObject(node) {
    const cached = this.objects.get(node.id);
    // Reuse: the library discards node objects when a node is filtered out by
    // nodeVisibility and asks for them again when it comes back. Rebuilding here would
    // re-download the portrait and leak the old textures on every focus toggle.
    if (cached) return cached;

    // Radius is frozen at init: it is derived from the node count, and letting it drift
    // when a character joins would leave the scene with two different ball sizes.
    const group = createNodeObject(node, this.nodeRadius);
    this.objects.set(node.id, group);

    loadFirstImage(node.avatarCandidates)
      .then((image) => {
        if (this.disposed) return;
        group.userData.image = image;
        this.repaintNode(node.id, { force: true });
      })
      .catch(() => {});

    return group;
  }

  linkObject(link) {
    const cached = this.linkObjects.get(link.id);
    if (cached) return cached;
    const group = createLinkObject(link);
    this.linkObjects.set(link.id, group);
    return group;
  }

  /** In focus mode a node is coloured by its relationship to the focused character. */
  displayType(id) {
    const node = this.nodeData.get(id);
    if (!this.focusId) return node?.type ?? 'neutral';
    if (id === this.focusId) return 'center';
    return relationBetween(this.model, this.focusId, id) ?? node?.type ?? 'mystery';
  }

  /** Redraws a node's canvases, but only when something visible about it changed —
   *  the roster poll otherwise re-uploads every texture every 2.5s for nothing. */
  repaintNode(id, { force = false } = {}) {
    const group = this.objects.get(id);
    const node = this.nodeData.get(id);
    if (!group || !node) return;
    const type = this.displayType(id);
    const paintKey = `${node.label}|${type}|${group.userData.image ? 1 : 0}`;
    if (!force && group.userData.paintKey === paintKey) return;
    group.userData.paintKey = paintKey;
    group.userData.repaint(node, type);
  }

  repaintNodes(options) {
    this.objects.forEach((_, id) => this.repaintNode(id, options));
  }

  // --------------------------------------------------------------- interaction

  handleHover(node) {
    this.objects.forEach((group, id) => {
      group.userData.emphasize(node && id === node.id ? 1.09 : 1);
    });
  }

  handleNodeClick(node) {
    this.onSelect(this.nodeData.get(node.id) ?? node);
    if (this.focusId === node.id) this.clearFocus();
    else this.focus(node.id);
  }

  handleDrag(node) {
    this.stopAnimation();
    // The library drags the *object*, whose position includes the idle float, and then
    // copies it straight back into the node's resting position. Take the float back out,
    // or the node would gain one float offset per pointer event and creep away.
    const offset = this.floatOffsets.get(node.id);
    if (!offset) return;
    node.x = node.fx = node.x - offset.x;
    node.y = node.fy = node.y - offset.y;
    node.z = node.fz = node.z - offset.z;
  }

  handleDragEnd(node) {
    node.fx = node.x;
    node.fy = node.y;
    node.fz = node.z;
    if (!this.focusId) this.home.set(node.id, { x: node.x, y: node.y, z: node.z });
  }

  handleEngineStop() {
    if (this.settled) return;
    this.settled = true;
    // Only the opening layout gets recentred. Doing it again after a newcomer settles
    // would shift every node the user has already placed by hand.
    if (!this.recentred) {
      this.recentred = true;
      this.recenter();
    }
    this.pinAll();
    this.nodeData.forEach((node, id) => this.home.set(id, { x: node.x, y: node.y, z: node.z }));
    this.fitView();
  }

  focus(id, { animate = true } = {}) {
    if (!this.fg || !this.nodeData.has(id)) return;

    this.focusId = id;
    this.settled = true;
    this.pinAll();

    const neighbours = [...(this.model.neighbors.get(id) ?? [])].filter((nid) => this.nodeData.has(nid));
    this.visibleIds = new Set([id, ...neighbours]);

    const targets = new Map([[id, { x: 0, y: 0, z: 0 }]]);
    const radius = this.view.focusRadius * clamp(Math.sqrt(neighbours.length / 5), 0.75, 1.8);
    neighbours.forEach((nid, index) => targets.set(nid, spherePoint(index, neighbours.length, radius)));

    this.applyVisibility();
    this.repaintNodes();
    this.onFocusChange(id);
    this.moveTo(targets, animate ? FOCUS_DURATION : 0);
  }

  clearFocus() {
    if (!this.fg) return;
    if (!this.focusId) {
      this.fitView(); // background click with nothing focused = reframe the whole graph
      return;
    }
    this.focusId = null;
    this.visibleIds = null;
    this.applyVisibility();
    this.repaintNodes();
    this.onFocusChange(null);
    const targets = new Map();
    this.home.forEach((position, id) => {
      if (this.nodeData.has(id)) targets.set(id, position);
    });
    this.moveTo(targets, FOCUS_DURATION);
  }

  /**
   * Visibility accessors must be *fresh function instances* — 3d-force-graph diffs
   * props by value, so re-setting the same closure is a no-op and the scene would
   * never re-digest.
   */
  applyVisibility() {
    const visible = this.visibleIds;
    this.fg
      .nodeVisibility((node) => !visible || visible.has(node.id))
      .linkVisibility((link) => {
        if (!visible) return true;
        const source = link.source?.id ?? link.source;
        const target = link.target?.id ?? link.target;
        return visible.has(source) && visible.has(target);
      });
  }

  pinAll() {
    this.nodeData.forEach((node) => {
      node.fx = node.x;
      node.fy = node.y;
      node.fz = node.z;
    });
  }

  recenter() {
    const nodes = [...this.nodeData.values()];
    if (nodes.length === 0) return;
    const centroid = nodes.reduce((acc, node) => ({
      x: acc.x + (node.x ?? 0), y: acc.y + (node.y ?? 0), z: acc.z + (node.z ?? 0),
    }), { x: 0, y: 0, z: 0 });
    centroid.x /= nodes.length;
    centroid.y /= nodes.length;
    centroid.z /= nodes.length;
    nodes.forEach((node) => {
      node.x = (node.x ?? 0) - centroid.x;
      node.y = (node.y ?? 0) - centroid.y;
      node.z = (node.z ?? 0) - centroid.z;
    });
  }

  /**
   * Animates resting positions through fx/fy/fz. Every node is pinned by the time this
   * runs, so the simulation contributes nothing of its own, and the render loop picks
   * the new positions up on the next frame.
   */
  moveTo(targets, duration) {
    this.stopAnimation();
    if (targets.size === 0) return;

    const from = new Map();
    targets.forEach((_, id) => {
      const node = this.nodeData.get(id);
      if (node) from.set(id, { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 });
    });

    const apply = (progress) => {
      targets.forEach((target, id) => {
        const node = this.nodeData.get(id);
        const start = from.get(id);
        if (!node || !start) return;
        node.x = node.fx = start.x + (target.x - start.x) * progress;
        node.y = node.fy = start.y + (target.y - start.y) * progress;
        node.z = node.fz = start.z + (target.z - start.z) * progress;
      });
    };

    if (duration <= 0) {
      apply(1);
      this.fitView();
      return;
    }

    const startedAt = performance.now();
    const step = () => {
      if (this.disposed || !this.fg) return;
      const elapsed = clamp((performance.now() - startedAt) / duration, 0, 1);
      apply(easeInOutCubic(elapsed));
      if (elapsed < 1) {
        this.animFrame = requestAnimationFrame(step);
        return;
      }
      this.animFrame = null;
      this.fitView();
    };
    this.animFrame = requestAnimationFrame(step);
  }

  stopAnimation() {
    if (this.animFrame === null) return;
    cancelAnimationFrame(this.animFrame);
    this.animFrame = null;
  }

  fitView() {
    if (!this.fg) return;
    const visible = this.visibleIds;
    const shown = visible ? visible.size : this.nodeData.size;
    const padding = clamp(Math.min(this.container.clientWidth || 1280, this.container.clientHeight || 720) * 0.16, 60, 150);
    requestAnimationFrame(() => {
      if (this.disposed || !this.fg) return;
      if (shown < 2) {
        // zoomToFit measures the bounding box against the origin and gives up when it
        // collapses to a point, leaving the camera wherever it was. A lone character
        // (focused with no relationships) needs an explicit distance instead.
        const distance = this.nodeRadius * 9;
        this.fg.cameraPosition({ x: 0, y: 0, z: distance }, { x: 0, y: 0, z: 0 }, FIT_DURATION);
        return;
      }
      this.fg.zoomToFit(FIT_DURATION, padding, (node) => !visible || visible.has(node.id));
    });
  }
}
