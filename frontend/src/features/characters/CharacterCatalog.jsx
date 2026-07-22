import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import Avatar from '../../components/ui/Avatar.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import TagChip from '../../components/ui/TagChip.jsx';
import PageHeader from '../../components/layout/PageHeader.jsx';
import StatusBanner from '../../components/ui/StatusBanner.jsx';

function characterAvatar(worldId, character) {
  return character.avatar ? `/media/${worldId}/agents/${character.id}/${character.avatar}` : null;
}

export default function CharacterCatalog() {
  const { worldId } = useParams();
  const [tagFilter, setTagFilter] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['characters', worldId],
    queryFn: () => api.get(`/api/worlds/${worldId}/characters`),
  });

  const allTags = useMemo(() => {
    const set = new Set();
    for (const character of data?.characters ?? []) {
      for (const tag of character.tags ?? []) set.add(tag);
    }
    return [...set].sort();
  }, [data]);

  const characters = useMemo(() => {
    if (!tagFilter) return data?.characters ?? [];
    return (data?.characters ?? []).filter((character) => (character.tags ?? []).includes(tagFilter));
  }, [data, tagFilter]);

  if (isLoading) return <div className="skeleton-page">正在加载角色...</div>;
  if (error) return <StatusBanner tone="error">{error.message}</StatusBanner>;

  return (
    <div className="workspace">
      <PageHeader
        title="角色"
        subtitle="管理智能体的角色卡、外观资产、可见性策略、状态和记忆。"
        actions={
          <Link to={`/worlds/${worldId}/characters/new`}>
            <Button variant="primary">新建角色</Button>
          </Link>
        }
      />

      <div className="filter-row">
        <TagChip active={!tagFilter} onClick={() => setTagFilter(null)}>
          全部
        </TagChip>
        {allTags.map((tag) => (
          <TagChip key={tag} active={tagFilter === tag} onClick={() => setTagFilter(tag)}>
            {tag}
          </TagChip>
        ))}
      </div>

      {characters.length === 0 ? (
        <EmptyState title="没有找到角色" body="创建智能体角色卡后，这个世界才能开始游玩。" />
      ) : (
        <div className="character-grid">
          {characters.map((character) => (
            <Link key={character.id} to={`/worlds/${worldId}/characters/${character.id}`} className="character-card">
              <Avatar
                src={characterAvatar(worldId, character)}
                name={character.name}
                size="xl"
                shape="soft"
                className="headshot"
              />
              <div className="character-card-body">
                <div className="character-card-title">
                  <h2>{character.name}</h2>
                  <span>{character.state?.locationName ?? character.state?.location ?? '未放置'}</span>
                </div>
                <p>{character.description}</p>
                <div className="character-state-row">
                  <span>{character.state?.mood || '暂无心情'}</span>
                  <span>{character.state?.action || '空闲'}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
