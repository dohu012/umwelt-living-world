import Panel from '../../components/ui/Panel.jsx';
import Badge from '../../components/ui/Badge.jsx';

const STATE_LABELS = {
  pending: '进行中',
  error: '失败',
  done: '完成',
  skipped: '跳过',
  idle: '空闲',
};

const INTENT_LABELS = {
  chitchat: '闲聊',
  address_agent: '点名角色',
  request_image: '请求出图',
  observe: '观察',
};

function Step({ label, state, detail }) {
  const tone = state === 'pending' ? 'warning' : state === 'error' ? 'danger' : state === 'done' ? 'success' : 'neutral';
  return (
    <div className="skill-step">
      <span>{label}</span>
      <Badge tone={tone}>{STATE_LABELS[state] ?? state}</Badge>
      {detail && <p>{detail}</p>}
    </div>
  );
}

export default function SkillRunPanel({ intent, imageStatus, busy, typingAgentIds, roster }) {
  const responderNames = intent?.responderIds?.map((id) => roster.get(id)?.name ?? id).join('、');
  const imageState = imageStatus?.pending
    ? 'pending'
    : imageStatus?.error
      ? 'error'
      : imageStatus?.images?.length
        ? 'done'
        : imageStatus?.skipped
          ? 'skipped'
          : 'idle';

  return (
    <Panel title="技能流水线" eyebrow="当前回合">
      {intent && (
        <div className="pipeline-summary">
          <div>
            <span>识别意图</span>
            <strong>{INTENT_LABELS[intent.intent] ?? intent.intent}</strong>
          </div>
          <div>
            <span>调度角色</span>
            <strong>{responderNames || '无'}</strong>
          </div>
        </div>
      )}
      {!intent && !busy && (
        <div className="pipeline-empty">
          发送消息后，这里会按顺序展示意图调度、角色回复、场景出图、地点结算和状态抽取。
        </div>
      )}
      <div className="skill-steps">
        <Step
          label="意图调度"
          state={intent ? 'done' : busy ? 'pending' : 'idle'}
          detail={intent ? `${INTENT_LABELS[intent.intent] ?? intent.intent}${responderNames ? `，回复角色：${responderNames}` : '，无回复角色'}` : null}
        />
        <Step
          label="角色回合"
          state={typingAgentIds.length > 0 ? 'pending' : busy ? 'done' : 'idle'}
          detail={typingAgentIds.length > 0 ? typingAgentIds.map((id) => roster.get(id)?.name ?? id).join('、') : null}
        />
        <Step
          label="场景出图"
          state={imageState}
          detail={(() => {
            if (imageStatus?.error) return imageStatus.error;
            if (imageStatus?.reason === 'location_change') {
              if (imageStatus.pending) {
                return `换地点：正在生成 ${imageStatus.locationName || imageStatus.location || '新地点'} 环境图`;
              }
              if (imageStatus.images?.length) return `换地点环境图 × ${imageStatus.images.length}`;
            }
            if (imageStatus?.reason) return imageStatus.reason;
            if (imageStatus?.images?.length) return `${imageStatus.images.length} 张图片`;
            return null;
          })()}
        />
        <Step label="地点结算" state={busy ? 'pending' : intent ? 'done' : 'idle'} />
        <Step label="状态抽取" state={busy ? 'pending' : intent ? 'done' : 'idle'} />
      </div>
    </Panel>
  );
}
