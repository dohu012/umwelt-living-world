import Panel from '../../components/ui/Panel.jsx';
import Avatar from '../../components/ui/Avatar.jsx';

export default function AgentInspector({ worldId, agents, selectedAgentId, onSelect }) {
  return (
    <Panel title="智能体调试器" eyebrow="选择观察视角">
      <div className="agent-picker-list">
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className={`agent-picker ${selectedAgentId === agent.id ? 'active' : ''}`}
            onClick={() => onSelect(agent.id)}
          >
            <Avatar
              src={agent.avatar ? `/media/${worldId}/agents/${agent.id}/${agent.avatar}` : null}
              name={agent.name}
              size="sm"
            />
            <span>{agent.name}</span>
            <small>{agent.state?.locationName ?? agent.state?.location ?? '未知'}</small>
          </button>
        ))}
      </div>
    </Panel>
  );
}
