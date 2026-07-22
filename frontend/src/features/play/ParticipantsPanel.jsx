import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Panel from '../../components/ui/Panel.jsx';
import { avatarFor, hereAndElsewhere } from './playUtils.js';

export default function ParticipantsPanel({ worldId, location, roster, typingAgentIds }) {
  const { here, elsewhere } = hereAndElsewhere(roster, location);

  return (
    <Panel title="在场角色" eyebrow="角色阵容">
      <div className="participant-list">
        {here.map((character) => (
          <div className="participant-row" key={character.id}>
            <Avatar src={avatarFor(worldId, character)} name={character.name} size="sm" />
            <div>
              <strong>{character.name}</strong>
              <span>{character.state?.mood || character.state?.action || '在场景中'}</span>
            </div>
            {typingAgentIds.includes(character.id) && <Badge tone="success">回复中</Badge>}
          </div>
        ))}
        {here.length === 0 && <div className="muted-line">当前地点没有可互动角色</div>}
      </div>
      {elsewhere.length > 0 && (
        <>
          <div className="panel-subtitle">其他地点</div>
          <div className="compact-list">
            {elsewhere.map((character) => (
              <span key={character.id}>
                {character.name} · {character.state?.locationName ?? character.state?.location ?? '未知'}
              </span>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
