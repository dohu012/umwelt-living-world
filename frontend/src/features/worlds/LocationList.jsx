import { Link } from 'react-router-dom';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Panel from '../../components/ui/Panel.jsx';

export default function LocationList({ worldId, locations, characters, embedded = false }) {
  const countByLocation = new Map();
  for (const character of characters ?? []) {
    const location = character.state?.location;
    if (!location) continue;
    countByLocation.set(location, (countByLocation.get(location) ?? 0) + 1);
  }

  const content = (
      <div className="location-list">
        {locations.map((location) => (
          <div className="location-row" key={location.id}>
            <div>
              <strong>{location.name}</strong>
              <span>{location.description || location.id}</span>
            </div>
            <Badge tone="neutral">{countByLocation.get(location.id) ?? 0} 个角色</Badge>
            <Link to={`/worlds/${worldId}/play/${encodeURIComponent(location.id)}`}>
              <Button size="sm">进入</Button>
            </Link>
          </div>
        ))}
        {locations.length === 0 && <p className="muted-line">还没有登记地点。</p>}
      </div>
  );

  if (embedded) return content;

  return (
    <Panel title="地点" eyebrow="世界地图">
      {content}
    </Panel>
  );
}
