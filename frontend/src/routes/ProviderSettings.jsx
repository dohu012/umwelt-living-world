import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import StatusBanner from '../components/ui/StatusBanner.jsx';

const KIND_OPTIONS = [
  { value: 'dialogue', label: '对话', hint: '角色对白等 LLM 调用', placeholder: 'step-3.7-flash' },
  { value: 'image', label: '生图', hint: '文生图 / 立绘生成', placeholder: 'step-2x-large' },
  { value: 'imageEdit', label: '改图', hint: '图像编辑（换衣服等）', placeholder: 'step-image-edit-2' },
];

const BLANK = {
  name: '',
  kind: 'dialogue',
  baseUrl: 'https://api.stepfun.com',
  model: 'step-3.7-flash',
  apiKey: '',
  temperature: 0.8,
  maxTokens: 900,
  reasoningEffort: '',
};

function kindMeta(kind) {
  return KIND_OPTIONS.find((k) => k.value === kind) || KIND_OPTIONS[0];
}

export default function ProviderSettings() {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.get('/api/settings/providers'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['providers'] });

  const resetForm = () => {
    setFields(BLANK);
    setEditingId(null);
  };

  const bodyFromFields = () => ({
    name: fields.name,
    kind: fields.kind,
    baseUrl: fields.baseUrl,
    model: fields.model,
    temperature: Number(fields.temperature),
    maxTokens: Number(fields.maxTokens),
    reasoningEffort: fields.reasoningEffort || null,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/api/settings/providers', {
        ...bodyFromFields(),
        apiKey: fields.apiKey,
      }),
    onSuccess: () => {
      resetForm();
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      const body = bodyFromFields();
      if (fields.apiKey.trim()) body.apiKey = fields.apiKey.trim();
      return api.put(`/api/settings/providers/${editingId}`, body);
    },
    onSuccess: () => {
      resetForm();
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const activateMutation = useMutation({
    mutationFn: (id) => api.post(`/api/settings/providers/${id}/activate`, {}),
    onSuccess: invalidate,
    onError: (err) => setError(err.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id) => api.post(`/api/settings/providers/${id}/deactivate`, {}),
    onSuccess: invalidate,
    onError: (err) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.del(`/api/settings/providers/${id}`),
    onSuccess: () => {
      if (editingId) resetForm();
      invalidate();
    },
  });

  if (isLoading) return <div className="skeleton-page">正在加载模型服务...</div>;

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const setKind = (e) => {
    const kind = e.target.value;
    const meta = kindMeta(kind);
    setFields((f) => ({
      ...f,
      kind,
      // Only auto-fill model when still on a default placeholder from another kind
      model:
        KIND_OPTIONS.some((k) => k.placeholder === f.model) || !f.model ? meta.placeholder : f.model,
    }));
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setFields({
      name: p.name || '',
      kind: p.kind || 'dialogue',
      baseUrl: p.baseUrl || '',
      model: p.model || '',
      apiKey: '',
      temperature: p.temperature ?? 0.8,
      maxTokens: p.maxTokens ?? 900,
      reasoningEffort: p.reasoningEffort || '',
    });
    setError(null);
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const activeByKind = data?.activeByKind || {};
  const labels = data?.kindLabels || Object.fromEntries(KIND_OPTIONS.map((k) => [k.value, k.label]));

  return (
    <>
      <PageHeader
        title="模型服务"
        subtitle="每条只配置一种用途（对话 / 生图 / 改图）。名称写服务商即可（如 StepFun），用途用标签区分。不同用途可同时启用；不必配齐。"
      />

      {error && <StatusBanner tone="error">{error}</StatusBanner>}

      <div className="provider-list">
        {data.providers.map((p) => {
          const kind = p.kind || 'dialogue';
          const enabled = activeByKind[kind] === p.id;
          return (
            <div className="provider-row card" key={p.id}>
              <div className="meta">
                <strong>
                  {p.name}{' '}
                  <Badge>{labels[kind] || kind}</Badge>
                  {enabled && <Badge>已启用</Badge>}
                </strong>
                <span>
                  模型 {p.model} · {p.baseUrl} · 密钥 {p.hasApiKey ? p.apiKeyPreview : '未配置'}
                </span>
              </div>
              <div className="actions">
                <Button onClick={() => startEdit(p)} disabled={editingId === p.id}>
                  编辑
                </Button>
                {enabled ? (
                  <Button onClick={() => deactivateMutation.mutate(p.id)}>停用</Button>
                ) : (
                  <Button onClick={() => activateMutation.mutate(p.id)}>启用</Button>
                )}
                <Button variant="danger" onClick={() => deleteMutation.mutate(p.id)}>
                  删除
                </Button>
              </div>
            </div>
          );
        })}
        {data.providers.length === 0 && (
          <p>还没有配置模型服务。按用途分别添加即可（例如只有对话 API 就只加一条对话）。</p>
        )}
      </div>

      <form
        className="form settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (editingId) updateMutation.mutate();
          else createMutation.mutate();
        }}
      >
        <h3>{editingId ? '编辑模型服务' : '添加模型服务'}</h3>
        <p className="form-hint">
          一次只填一个用途、一个模型名。接口地址与密钥按该条服务填写；没有的用途可以不配。
        </p>
        <label>
          名称
          <input value={fields.name} onChange={set('name')} placeholder="例如：StepFun" required />
        </label>
        <label>
          用途
          <select value={fields.kind} onChange={setKind} required>
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label} — {k.hint}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            接口地址
            <input
              value={fields.baseUrl}
              onChange={set('baseUrl')}
              placeholder="https://api.stepfun.com"
              required
            />
          </label>
          <label>
            模型
            <input
              value={fields.model}
              onChange={set('model')}
              placeholder={kindMeta(fields.kind).placeholder}
              required
            />
          </label>
        </div>
        <label>
          API 密钥
          <input
            type="password"
            value={fields.apiKey}
            onChange={set('apiKey')}
            placeholder={editingId ? '留空则保持原密钥' : 'sk-...'}
            required={!editingId}
          />
        </label>
        {fields.kind === 'dialogue' ? (
          <div className="form-row">
            <label>
              温度
              <input type="number" step="0.1" value={fields.temperature} onChange={set('temperature')} />
            </label>
            <label>
              最大 token
              <input type="number" value={fields.maxTokens} onChange={set('maxTokens')} />
            </label>
            <label>
              推理强度
              <select value={fields.reasoningEffort} onChange={set('reasoningEffort')}>
                <option value="">不设置</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
          </div>
        ) : null}
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={saving}>
            {editingId ? '保存' : '添加'}
          </Button>
          {editingId && (
            <Button type="button" onClick={resetForm}>
              取消
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
