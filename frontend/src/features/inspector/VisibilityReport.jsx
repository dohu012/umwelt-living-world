import Panel from '../../components/ui/Panel.jsx';
import TagChip from '../../components/ui/TagChip.jsx';

function explainPolicy(report) {
  const allowCount = report.policy.allow.length;
  const denyCount = report.policy.deny.length;
  const stateLocation = report.stateSnapshot?.locationName ?? report.stateSnapshot?.location;
  return [
    `允许规则 ${allowCount} 条，拒绝规则 ${denyCount} 条。`,
    stateLocation ? `当前状态地点为「${stateLocation}」，会影响 local:{state.location} 这类规则。` : '当前状态里还没有明确地点。',
    '前端按当前报告解释：先看解析后的策略，再对照可见事件和被拒绝事件列表定位原因。',
  ];
}

function EventList({ events, empty }) {
  if (!events?.length) return <p className="muted-line">{empty}</p>;
  return (
    <div className="inspect-event-list">
      {events.map((event) => (
        <article key={event.id}>
          <div className="inspect-event-head">
            <span>#{event.id} · 序号 {event.seq}</span>
            <strong>{event.type}</strong>
            <em>{event.actor}</em>
          </div>
          <p>{event.content || '（无内容）'}</p>
          <div className="tag-row">
            {(event.tags ?? []).map((tag) => (
              <TagChip key={tag}>{tag}</TagChip>
            ))}
          </div>
          {event.reasons?.length > 0 && <small>{event.reasons.join('; ')}</small>}
        </article>
      ))}
    </div>
  );
}

export default function VisibilityReport({ report }) {
  return (
    <Panel title="可见性报告" eyebrow={report ? `${report.agentName} · ${report.world}` : '策略'}>
      {!report ? (
        <p className="muted-line">选择一个智能体后，可以查看解析后的策略、可见事件和被拒绝事件。</p>
      ) : (
        <div className="visibility-report">
          <div className="visibility-summary-grid">
            <div>
              <span>可见事件</span>
              <strong>{report.visibleEvents.length}</strong>
            </div>
            <div>
              <span>被拒绝事件</span>
              <strong>{report.denied?.length ?? 0}</strong>
            </div>
            <div>
              <span>状态快照</span>
              <strong>{report.stateSnapshot ? '已返回' : '暂无'}</strong>
            </div>
          </div>
          <div className="policy-explainer">
            {explainPolicy(report).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <div className="pattern-section">
            <strong>解析后的允许规则</strong>
            <div className="tag-row">
              {report.policy.allow.map((pattern) => (
                <TagChip key={pattern} tone="allow">
                  {pattern}
                </TagChip>
              ))}
            </div>
          </div>
          <div className="pattern-section">
            <strong>解析后的拒绝规则</strong>
            <div className="tag-row">
              {report.policy.deny.map((pattern) => (
                <TagChip key={pattern} tone="deny">
                  {pattern}
                </TagChip>
              ))}
            </div>
          </div>
          <pre className="json-block">{JSON.stringify(report.stateSnapshot, null, 2)}</pre>
          <div className="panel-subtitle">可见事件 · {report.visibleEvents.length}</div>
          <EventList events={report.visibleEvents} empty="当前窗口里没有可见事件。" />
          <div className="panel-subtitle">被拒绝事件 · {report.denied?.length ?? 0}</div>
          <EventList events={report.denied ?? []} empty="这份报告没有返回被拒绝事件。" />
        </div>
      )}
    </Panel>
  );
}
