import { relationshipTone, signed } from './playUtils.js';

export default function RelationshipTable({ relationship, resolveName }) {
  const entries = Object.entries(relationship ?? {});
  if (entries.length === 0) return <div className="muted-line">暂无关系记录</div>;

  return (
    <table className="rel-table">
      <thead>
        <tr>
          <th>对象</th>
          <th>好感</th>
          <th>信任</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([id, rel]) => (
          <tr key={id}>
            <td title={rel?.notes || undefined}>{resolveName(id)}</td>
            <td>
              <span className={`rel-pill ${relationshipTone(rel?.affinity)}`}>{signed(rel?.affinity)}</span>
            </td>
            <td>{signed(rel?.trust)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
