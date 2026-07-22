import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';

export default function ChatMessage({
  message,
  mine,
  label,
  avatarSrc,
  avatarCandidates = [],
  avatarClassName = '',
  state,
  variant = 'console',
}) {
  const immersive = variant === 'immersive';

  if (message.kind === 'narration') {
    return (
      <article className="chat-message narration-message">
        <div className="message-text narration-text">{message.text}</div>
      </article>
    );
  }

  if (message.kind === 'image') {
    return (
      <article className="chat-message image-message">
        <div className="message-meta">
          <span>{message.imageType === 'environment' ? '环境图' : '角色立绘'}</span>
        </div>
        {message.src ? (
          <img className="scene-image" src={message.src} alt={message.imageType || '生成图片'} />
        ) : (
          <div className="image-placeholder">图片事件没有媒体地址</div>
        )}
      </article>
    );
  }

  return (
    <article className={`chat-message ${mine ? 'mine' : 'agent'}`}>
      <Avatar src={avatarSrc} srcCandidates={avatarCandidates} name={label} size="sm" className={avatarClassName} />
      <div className="message-body">
        <div className="message-meta">
          <span>{label}</span>
          <Badge tone={mine ? 'info' : 'neutral'}>{mine ? '玩家' : '角色'}</Badge>
          {!mine && state?.locationName && <Badge tone="neutral">{state.locationName}</Badge>}
          {!mine && state?.mood && <Badge tone="neutral">{state.mood}</Badge>}
          {message.kind === 'agent-streaming' && <span className="live-dot">生成中</span>}
        </div>
        <div className="message-text">{message.text}</div>
        {message.parseError && !immersive && <div className="message-warning">状态解析警告：{message.parseError}</div>}
      </div>
    </article>
  );
}
