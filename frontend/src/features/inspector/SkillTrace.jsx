import Panel from '../../components/ui/Panel.jsx';
import Badge from '../../components/ui/Badge.jsx';

function imageEvents(events) {
  return (events ?? []).filter((event) => event.type === 'image');
}

export default function SkillTrace({ events }) {
  const images = imageEvents(events);
  return (
    <Panel title="技能链路" eyebrow="由当前前端数据推导">
      <div className="skill-steps">
        <div className="skill-step">
          <span>intent-dispatch</span>
          <Badge tone="neutral">仅实时</Badge>
          <p>WebSocket 场景运行时会在游玩页展示。</p>
        </div>
        <div className="skill-step">
          <span>state-extraction</span>
          <Badge tone="neutral">状态面板</Badge>
          <p>通过角色页和场景面板中的智能体 / 玩家身份状态事实展示。</p>
        </div>
        <div className="skill-step">
          <span>scene-image</span>
          <Badge tone={images.length ? 'success' : 'neutral'}>{images.length ? `${images.length} 个事件` : '暂无'}</Badge>
          <p>{images.length ? '当前地点已经写入图片事件。' : '当前地点窗口里没有图片事件。'}</p>
        </div>
        <div className="skill-step">
          <span>scene-location</span>
          <Badge tone="neutral">地点事实</Badge>
          <p>移动结果会反映在当前地点和在场角色状态中。</p>
        </div>
      </div>
    </Panel>
  );
}
