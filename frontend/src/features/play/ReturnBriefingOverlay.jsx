import Button from '../../components/ui/Button.jsx';

function formatTime(value) {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  }).format(new Date(value));
}

function eventText(event) {
  if (event.type === 'dialogue') return `${event.actorName}：“${event.content}”`;
  if (event.type === 'life_action') return `${event.actorName}进行了${event.content}`;
  if (event.type === 'decision_resolved') return `${event.actorName}做出决定：${event.content}`;
  return event.content;
}

export default function ReturnBriefingOverlay({ briefing, onDismiss }) {
  if (!briefing) return null;
  return (
    <div className="world-intro-overlay return-briefing-overlay" role="dialog" aria-modal="true" aria-labelledby="return-briefing-title">
      <div className="world-intro-card return-briefing-card">
        <div className="ui-eyebrow">你离开之后</div>
        <h2 id="return-briefing-title">世界没有停下来</h2>
        <p className="return-briefing-range">{formatTime(briefing.from)} — {formatTime(briefing.to)} · {briefing.eventCount} 条变化</p>
        <div className="return-briefing-list">
          {briefing.events.map((event) => (
            <article key={event.id}>
              <time>{formatTime(event.ts)}</time>
              <div>
                <strong>{eventText(event)}</strong>
                <small>{event.locationName || '整个世界'} · {event.type}</small>
              </div>
            </article>
          ))}
        </div>
        <div className="world-intro-actions">
          <Button variant="primary" onClick={onDismiss}>回到当前现场</Button>
        </div>
      </div>
    </div>
  );
}
