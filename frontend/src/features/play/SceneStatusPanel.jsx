import Panel from '../../components/ui/Panel.jsx';
import Badge from '../../components/ui/Badge.jsx';
import RelationshipTable from './RelationshipTable.jsx';
import { hereAndElsewhere, resolveIdsInText } from './playUtils.js';

function StateLines({ state, resolveText }) {
  if (!state?.mood && !state?.action) return <div className="muted-line">暂无当前心情 / 动作状态</div>;
  return (
    <div className="state-lines">
      {state?.mood && (
        <div>
          <span>心情</span>
          <strong>{state.mood}</strong>
        </div>
      )}
      {state?.action && (
        <div>
          <span>动作</span>
          <strong>{resolveText(state.action)}</strong>
        </div>
      )}
    </div>
  );
}

function SubjectStatus({ title, state, resolveName, resolveText, badge }) {
  return (
    <div className="subject-status">
      <div className="subject-head">
        <strong>{title}</strong>
        {badge && <Badge tone="neutral">{badge}</Badge>}
      </div>
      <StateLines state={state} resolveText={resolveText} />
      <RelationshipTable relationship={state?.relationship} resolveName={resolveName} />
    </div>
  );
}

export default function SceneStatusPanel({ location, currentLocation, roster, persona, personaState, idToName }) {
  const { here, elsewhere } = hereAndElsewhere(roster, location);
  const resolveName = (id) => idToName.get(id) ?? id;
  const resolveText = (text) => resolveIdsInText(text, idToName);

  return (
    <Panel title="场景状态" eyebrow="状态">
      <div className="location-summary">
        <strong>{currentLocation?.name ?? location}</strong>
        {currentLocation?.description && <p>{currentLocation.description}</p>}
      </div>
      <SubjectStatus
        title={persona?.name ?? '你'}
        state={personaState}
        resolveName={resolveName}
        resolveText={resolveText}
        badge={personaState?.locationName ?? currentLocation?.name ?? location}
      />

      <div className="panel-subtitle">在场角色</div>
      {here.length === 0 && <div className="muted-line">当前地点没有角色</div>}
      {here.map((character) => (
        <SubjectStatus
          key={character.id}
          title={character.name}
          state={character.state}
          resolveName={resolveName}
          resolveText={resolveText}
        />
      ))}

      {elsewhere.length > 0 && (
        <>
          <div className="panel-subtitle">其他地点</div>
          {elsewhere.map((character) => (
            <SubjectStatus
              key={character.id}
              title={character.name}
              state={character.state}
              resolveName={resolveName}
              resolveText={resolveText}
              badge={character.state?.locationName ?? character.state?.location}
            />
          ))}
        </>
      )}
    </Panel>
  );
}
