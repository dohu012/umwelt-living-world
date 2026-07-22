import Panel from '../../../components/ui/Panel.jsx';
import TagChip from '../../../components/ui/TagChip.jsx';

function PatternList({ title, value, setField, field }) {
  return (
    <label className="field">
      <span>{title}</span>
      <textarea rows={5} value={value} onChange={setField(field)} placeholder="每行一条匹配规则" />
    </label>
  );
}

export default function VisibilityTab({ fields, setField, inspect }) {
  const resolved = inspect?.policy;
  return (
    <div className="visibility-grid">
      <Panel title="可编辑策略" eyebrow="角色卡可见性扩展">
        <div className="form-grid compact">
          <PatternList title="允许规则" value={fields.visibilityAllow} setField={setField} field="visibilityAllow" />
          <PatternList title="拒绝规则" value={fields.visibilityDeny} setField={setField} field="visibilityDeny" />
          <label className="field span-2">
            <span>conditionalAllow JSON</span>
            <textarea rows={5} value={fields.conditionalAllowJson} onChange={setField('conditionalAllowJson')} />
          </label>
        </div>
      </Panel>
      <Panel title="解析结果" eyebrow="调试台">
        {resolved ? (
          <>
            <div className="pattern-section">
              <strong>允许</strong>
              <div className="tag-row">
                {resolved.allow.map((pattern) => (
                  <TagChip key={pattern} tone="allow">
                    {pattern}
                  </TagChip>
                ))}
              </div>
            </div>
            <div className="pattern-section">
              <strong>拒绝</strong>
              <div className="tag-row">
                {resolved.deny.map((pattern) => (
                  <TagChip key={pattern} tone="deny">
                    {pattern}
                  </TagChip>
                ))}
              </div>
            </div>
            <pre className="json-block">{JSON.stringify(inspect.stateSnapshot, null, 2)}</pre>
          </>
        ) : (
          <p className="muted-line">请先保存角色，再查看解析后的可见性策略。</p>
        )}
      </Panel>
    </div>
  );
}
