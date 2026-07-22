import Panel from '../../../components/ui/Panel.jsx';

export default function MemoryTab({ inspect }) {
  const memories = (inspect?.visibleEvents ?? []).filter((event) => event.type === 'memory');
  return (
    <Panel title="记忆摘要" eyebrow="可见记忆事件">
      {memories.length === 0 ? (
        <p className="muted-line">
          当前调试窗口里还没有可见记忆事件。后续如果需要更深历史，可以再扩展后端查询限制。
        </p>
      ) : (
        <div className="memory-list">
          {memories.map((event) => (
            <article key={event.id}>
              <span>序号 {event.seq}</span>
              <p>{event.content}</p>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
