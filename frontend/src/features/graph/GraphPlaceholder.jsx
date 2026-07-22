import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GraphScene from './GraphScene.js';
import { buildGraphModel, NODE_TITLES } from './graphModel.js';

function GraphCanvas({ model, onSelectNode }) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const [focusId, setFocusId] = useState(null);

  // The scene is built once and lives for the whole mount; callbacks reach the latest
  // React state through this ref instead of being baked into the WebGL instance.
  const selectRef = useRef(onSelectNode);
  selectRef.current = onSelectNode;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new GraphScene(container, {
      onSelect: (node) => selectRef.current(node),
      onFocusChange: setFocusId,
    });
    sceneRef.current = scene;

    const observer = new ResizeObserver(() => scene.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setModel(model);
  }, [model]);

  const handleReset = useCallback(() => sceneRef.current?.clearFocus(), []);

  return (
    <div className="kg-shell">
      <div className="kg-shell__nebula kg-shell__nebula--left" />
      <div className="kg-shell__nebula kg-shell__nebula--right" />
      <div className="kg-shell__mesh" />
      <div ref={containerRef} className="kg-shell__canvas" />
      {focusId ? (
        <button type="button" className="kg-shell__reset" onClick={handleReset}>
          返回全局视图
        </button>
      ) : null}
      <div className="kg-shell__hint">
        {focusId
          ? '已聚焦该角色 · 点击空白处或按钮返回全局'
          : '拖拽旋转 · 滚轮缩放 · 拖动角色可搬动节点 · 点击角色聚焦其关系网'}
      </div>
    </div>
  );
}

export default function GraphPlaceholder({ roster, worldId, location }) {
  const model = useMemo(() => buildGraphModel(roster, worldId, location), [location, roster, worldId]);
  const [selectedId, setSelectedId] = useState(null);

  const handleSelect = useCallback((node) => setSelectedId(node?.id ?? null), []);

  // Track by id, not by object: the roster poll rebuilds the model every 2.5s, and
  // holding a stale node object would freeze the inspector on old mood/location values.
  const selectedNode = model.nodes.find((node) => node.id === selectedId)
    ?? model.nodes.find((node) => node.id === model.centerId)
    ?? model.nodes[0]
    ?? null;

  if (model.nodes.length === 0) {
    return (
      <section className="graph-viewport graph-viewport--immersive card">
        <div className="graph-empty">当前还没有可展示的角色关系数据。</div>
      </section>
    );
  }

  return (
    <section className="graph-viewport graph-viewport--immersive card">
      <div className="graph-viewport__header">
        <div>
          <h3>{model.title}</h3>
          <p>{model.nodes.length} 个角色 · {model.edges.length} 条关系</p>
        </div>
        <div className="graph-legend">
          <span><i className="center" /> 核心</span>
          <span><i className="ally" /> 友好</span>
          <span><i className="enemy" /> 敌对</span>
          <span><i className="mystery" /> 未知</span>
        </div>
      </div>

      <div className="graph-stage-wrap graph-stage-wrap--3d">
        <GraphCanvas model={model} onSelectNode={handleSelect} />
      </div>

      <div className="graph-inspector graph-inspector--rich">
        <div>
          <div className="graph-inspector__label">角色</div>
          <strong>{selectedNode?.label ?? '未选择'}</strong>
        </div>
        <div>
          <div className="graph-inspector__label">职业 / 性别</div>
          <span>{selectedNode?.profession ?? '未设定'} / {selectedNode?.gender ?? '未设定'}</span>
        </div>
        <div>
          <div className="graph-inspector__label">地点 / 状态</div>
          <span>{selectedNode?.location ?? '未知'} / {selectedNode?.mood || selectedNode?.action || '未知'}</span>
        </div>
        <div>
          <div className="graph-inspector__label">关系判断</div>
          <span>{selectedNode?.relationshipText ?? NODE_TITLES[selectedNode?.type] ?? '未知'}</span>
        </div>
        <div className="graph-inspector__description">
          {selectedNode?.description || '把鼠标移到头像上，可以直接查看该角色的设定卡片。'}
        </div>
      </div>
    </section>
  );
}
