import Panel from '../../components/ui/Panel.jsx';
import TagChip from '../../components/ui/TagChip.jsx';

export default function GraphView({ agents, events }) {
  const tagCounts = new Map();
  for (const event of events ?? []) {
    for (const tag of event.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  return (
    <Panel title="关系图" eyebrow="轻量可见性地图">
      <div className="graph-lite">
        <div className="graph-column">
          <strong>智能体</strong>
          {agents.map((agent) => (
            <span key={agent.id}>{agent.name}</span>
          ))}
        </div>
        <div className="graph-column">
          <strong>当前时间线中的标签</strong>
          {[...tagCounts.entries()].map(([tag, count]) => (
            <TagChip key={tag}>
              {tag} · {count}
            </TagChip>
          ))}
          {tagCounts.size === 0 && <p className="muted-line">当前窗口里没有标签。</p>}
        </div>
      </div>
    </Panel>
  );
}
