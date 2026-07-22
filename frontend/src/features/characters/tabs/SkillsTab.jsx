import Panel from '../../../components/ui/Panel.jsx';
import Badge from '../../../components/ui/Badge.jsx';

const BUILT_IN_SKILLS = [
  ['intent-dispatch', '把玩家消息路由给合适的本地回复角色。'],
  ['state-extraction', '总结心情、动作、关系和结构化状态事实。'],
  ['scene-image', '识别视觉请求，并写入生成图片事件。'],
  ['scene-location', '结算场景后玩家和在场角色最终所在地点。'],
];

export default function SkillsTab({ fields, setField }) {
  return (
    <div className="skills-grid">
      <Panel title="运行时钩子" eyebrow="前端只读视图">
        <div className="skill-card-list">
          {BUILT_IN_SKILLS.map(([id, description]) => (
            <div className="skill-card" key={id}>
              <strong>{id}</strong>
              <p>{description}</p>
              <Badge tone="neutral">系统钩子</Badge>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="角色技能元数据" eyebrow="extensions.skills">
        <label className="field">
          <span>skills JSON</span>
          <textarea rows={14} value={fields.skillsJson} onChange={setField('skillsJson')} />
        </label>
        <p className="muted-line">
          后端目前还没有 skill 权限接口。这里先保持角色卡级别的元数据可编辑，不改变运行时行为。
        </p>
      </Panel>
    </div>
  );
}
