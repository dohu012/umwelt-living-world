import { useMemo, useState } from 'react';
import Panel from '../../components/ui/Panel.jsx';
import TagChip from '../../components/ui/TagChip.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

export default function EventTimeline({ events }) {
  const [typeFilter, setTypeFilter] = useState(null);
  const [tagFilter, setTagFilter] = useState(null);

  const types = useMemo(() => [...new Set((events ?? []).map((event) => event.type))].sort(), [events]);
  const tags = useMemo(() => {
    const set = new Set();
    for (const event of events ?? []) {
      for (const tag of event.tags ?? []) set.add(tag);
    }
    return [...set].sort();
  }, [events]);

  const filtered = useMemo(() => {
    return (events ?? []).filter((event) => {
      if (typeFilter && event.type !== typeFilter) return false;
      if (tagFilter && !(event.tags ?? []).includes(tagFilter)) return false;
      return true;
    });
  }, [events, typeFilter, tagFilter]);

  return (
    <Panel title="事件时间线" eyebrow="当前地点原始事件">
      <div className="timeline-summary">
        <span>总事件：{events?.length ?? 0}</span>
        <span>筛选后：{filtered.length}</span>
        <span>类型：{types.length}</span>
        <span>标签：{tags.length}</span>
      </div>
      <div className="filter-row">
        <TagChip active={!typeFilter} onClick={() => setTypeFilter(null)}>
          全部类型
        </TagChip>
        {types.map((type) => (
          <TagChip key={type} active={typeFilter === type} onClick={() => setTypeFilter(type)}>
            {type}
          </TagChip>
        ))}
      </div>
      <div className="filter-row compact">
        <TagChip active={!tagFilter} onClick={() => setTagFilter(null)}>
          全部 tag
        </TagChip>
        {tags.map((tag) => (
          <TagChip key={tag} active={tagFilter === tag} onClick={() => setTagFilter(tag)}>
            {tag}
          </TagChip>
        ))}
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="没有符合筛选条件的事件" />
      ) : (
        <div className="timeline-list">
          {filtered.map((event) => (
            <article className={`timeline-event ${event.type}`} key={event.id}>
              <div className="timeline-rail" />
              <div>
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
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
