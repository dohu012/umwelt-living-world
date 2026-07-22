export default function EmptyState({ title = '暂无数据', body, action }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
