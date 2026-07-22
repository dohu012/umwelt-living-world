import Badge from '../../components/ui/Badge.jsx';
import BackgroundLayer from './BackgroundLayer.jsx';
import PortraitLayer from './PortraitLayer.jsx';
import { hereAndElsewhere } from './playUtils.js';

export default function SceneStage({
  worldId,
  location,
  currentLocation,
  roster,
  persona,
  personaState,
  typingAgentIds,
  connected,
  busy,
  messages,
  focusAgentIds,
  imageStatus,
}) {
  const { here } = hereAndElsewhere(roster, location);
  const activeCount = here.filter((character) => character.state?.action || character.state?.mood).length;
  const imageProgress =
    imageStatus?.pending && imageStatus.reason === 'location_change'
      ? `正在生成 ${imageStatus.locationName || imageStatus.location || '新地点'} 环境图`
      : imageStatus?.pending
        ? '正在处理场景图片'
        : null;

  return (
    <section className="scene-stage">
      <BackgroundLayer worldId={worldId} location={location} messages={messages} />
      <div className="scene-stage-overlay" />
      {imageProgress && (
        <div className="scene-stage-toast">
          <span className="connection-dot" />
          <strong>{imageProgress}</strong>
        </div>
      )}
      <div className="scene-stage-content">
        <div className="scene-title-block">
          <div className="ui-eyebrow">当前地点</div>
          <h1>{currentLocation?.name ?? location}</h1>
          {currentLocation?.description && <p>{currentLocation.description}</p>}
          <div className="scene-meta-row">
            <Badge tone="info">在场 {here.length} 人</Badge>
            <Badge tone={connected ? 'success' : 'warning'}>{connected ? '实时连接' : '连接中'}</Badge>
            {busy && <Badge tone="warning">场景结算中</Badge>}
            {activeCount > 0 && <Badge tone="neutral">{activeCount} 个角色有状态</Badge>}
            {personaState?.locationName && <Badge tone="neutral">你在：{personaState.locationName}</Badge>}
          </div>
        </div>

        <div className="stage-right">
          <div className="persona-stage-card">
            <div className="ui-eyebrow">玩家身份</div>
            <strong>{persona?.name ?? '未命名身份'}</strong>
            <span>{personaState?.mood || personaState?.action || '等待输入'}</span>
          </div>
          <PortraitLayer
            worldId={worldId}
            location={location}
            characters={here}
            messages={messages}
            typingAgentIds={typingAgentIds}
            focusAgentIds={focusAgentIds}
          />
        </div>
      </div>
    </section>
  );
}
