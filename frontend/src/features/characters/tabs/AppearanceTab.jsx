import { useEffect, useMemo } from 'react';
import Avatar from '../../../components/ui/Avatar.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Panel from '../../../components/ui/Panel.jsx';
import TransitionImage from '../../assets/TransitionImage.jsx';
import { IMAGE_EXTENSIONS, assetPath } from '../../assets/imageAssets.js';
import { useImageCandidate } from '../../assets/useImageCandidate.js';

const PORTRAIT_SLOTS = [
  ['neutral', '默认立绘', '常态站姿，Play 舞台优先展示。'],
  ['happy', '积极表情', '适合好感提升、轻松回应或成功状态。'],
  ['angry', '紧张表情', '适合冲突、拒绝或低信任状态。'],
  ['sad', '低落表情', '适合悲伤、失落或关系下降状态。'],
  ['fear', '警惕表情', '适合紧张、害怕或不确定状态。'],
];

export default function AppearanceTab({ worldId, agentId, fields, avatarFile, setAvatarFile, existingAvatar }) {
  const objectUrl = useMemo(() => (avatarFile ? URL.createObjectURL(avatarFile) : null), [avatarFile]);
  const preview = objectUrl ?? existingAvatar;

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  return (
    <div className="appearance-grid">
      <Panel title="当前头像" eyebrow="资产">
        <div className="appearance-preview">
          <Avatar src={preview} name={fields.name} size="portrait" shape="soft" />
          <div>
            <label className="file-button">
              <input type="file" accept="image/*" onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)} />
              选择头像
            </label>
            <p className="muted-line">
              文件会存放在 <code>agents/{agentId || '<new-agent>'}/</code> 下，并由 <code>profile.avatar</code> 引用。
            </p>
          </div>
        </div>
      </Panel>
      <Panel title="立绘约定" eyebrow="预留能力">
        <div className="portrait-slot-grid">
          {PORTRAIT_SLOTS.map(([emotion, label, description]) => (
            <PortraitSlot
              key={emotion}
              worldId={worldId}
              agentId={agentId}
              name={fields.name}
              emotion={emotion}
              label={label}
              description={description}
            />
          ))}
        </div>
        <p className="muted-line">
          前端会按固定路径探测这些槽位；如果存在图片，Play 舞台会优先使用对应情绪立绘。
          新建角色后会根据简介异步自动生成一套表情立绘（约半分钟），可在此页刷新查看「已检测」。
        </p>
        {existingAvatar && (
          <p className="muted-line">
            当前媒体地址：<code>/media/{worldId}/agents/{agentId}/{fields.avatar || 'avatar'}</code>
          </p>
        )}
      </Panel>
    </div>
  );
}

function PortraitSlot({ worldId, agentId, name, emotion, label, description }) {
  const base = worldId && agentId ? assetPath(worldId, 'agents', agentId, 'portraits', emotion) : null;
  const candidates = base
    ? IMAGE_EXTENSIONS.map((ext) => ({ src: `${base}.${ext}`, label: `${label}.${ext}` }))
    : [];
  const { candidate, status } = useImageCandidate(candidates);

  return (
    <div className={`portrait-slot ${candidate ? 'ready' : 'missing'}`}>
      <TransitionImage
        src={candidate?.src}
        alt={label}
        className="portrait-slot-image"
        placeholder={<div className="portrait-slot-preview">{name?.[0] || '?'}</div>}
      />
      <div>
        <div className="portrait-slot-head">
          <strong>{label}</strong>
          <Badge tone={candidate ? 'success' : status === 'loading' ? 'warning' : 'neutral'}>
            {candidate ? '已检测' : status === 'loading' ? '检查中' : '缺失'}
          </Badge>
        </div>
        <p>{description}</p>
        <code>portraits/{emotion}.webp|png|jpg</code>
      </div>
    </div>
  );
}
