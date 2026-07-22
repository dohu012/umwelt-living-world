import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useActivePersona } from '../hooks/useActivePersona.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import Avatar from '../components/ui/Avatar.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import StatusBanner from '../components/ui/StatusBanner.jsx';

export default function PersonaEditor() {
  const queryClient = useQueryClient();
  const [activePersonaId, setActivePersonaId] = useActivePersona();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  const { data, isLoading } = useQuery({ queryKey: ['personas'], queryFn: () => api.get('/api/personas') });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['personas'] });

  const createMutation = useMutation({
    mutationFn: () => api.post('/api/personas', { name }),
    onSuccess: (created) => {
      setName('');
      invalidate();
      setActivePersonaId(created.id);
    },
    onError: (err) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.del(`/api/personas/${id}`),
    onSuccess: (_data, id) => {
      invalidate();
      if (activePersonaId === id) setActivePersonaId(null);
    },
  });

  const avatarMutation = useMutation({
    mutationFn: async ({ id, file }) => {
      const form = new FormData();
      form.append('avatar', file);
      return api.postForm(`/api/personas/${id}/avatar`, form);
    },
    onSuccess: invalidate,
    onError: (err) => setError(err.message),
  });

  if (isLoading) return <div className="skeleton-page">正在加载玩家身份...</div>;

  return (
    <>
      <PageHeader title="玩家身份" subtitle="选择玩家在角色视角中的身份，再进入场景游玩。" />
      <p className="page-intro">
        玩家身份会作为角色感知你的方式。进入场景前，请先选择一个当前使用的身份。
      </p>

      {error && <StatusBanner tone="error">{error}</StatusBanner>}

      <div className="persona-list">
        {data.personas.map((p) => (
          <div className="persona-row card" key={p.id}>
            <div className="persona-identity">
              <Avatar src={p.avatar ? `/media/personas/${p.id}/${p.avatar}` : null} name={p.name} size="md" />
              <div className="meta">
                <strong>{p.name}</strong>
                {activePersonaId === p.id && <Badge>当前使用</Badge>}
              </div>
            </div>
            <div className="actions">
              <label className="file-control">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) avatarMutation.mutate({ id: p.id, file });
                  }}
                />
                <span className="ui-button sm">头像</span>
              </label>
              <Button onClick={() => setActivePersonaId(p.id)} disabled={activePersonaId === p.id}>
                使用
              </Button>
              <Button variant="danger" onClick={() => deleteMutation.mutate(p.id)}>
                删除
              </Button>
            </div>
          </div>
        ))}
        {data.personas.length === 0 && <p>还没有玩家身份。</p>}
      </div>

      <form
        className="form settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) createMutation.mutate();
        }}
      >
        <label>
          新身份名称
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：zjh" required />
        </label>
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={createMutation.isPending}>
            创建身份
          </Button>
        </div>
      </form>
    </>
  );
}
