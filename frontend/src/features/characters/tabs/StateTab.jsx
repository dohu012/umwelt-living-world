import Panel from '../../../components/ui/Panel.jsx';
import RelationshipTable from '../../play/RelationshipTable.jsx';

export default function StateTab({ state, resolveName }) {
  return (
    <div className="state-workspace">
      <Panel title="当前事实" eyebrow="facts_current 投影">
        {state ? (
          <div className="state-lines large">
            <div>
              <span>地点</span>
              <strong>{state.locationName ?? state.location ?? '未知'}</strong>
            </div>
            <div>
              <span>心情</span>
              <strong>{state.mood ?? '暂无'}</strong>
            </div>
            <div>
              <span>动作</span>
              <strong>{state.action ?? '暂无'}</strong>
            </div>
          </div>
        ) : (
          <p className="muted-line">还没有可用的状态快照。</p>
        )}
      </Panel>
      <Panel title="关系" eyebrow="结构化状态">
        <RelationshipTable relationship={state?.relationship} resolveName={resolveName} />
      </Panel>
    </div>
  );
}
