import Badge from '../../components/ui/Badge.jsx';
import TransitionImage from '../assets/TransitionImage.jsx';
import {
  emotionFromState,
  generatedPortraitMap,
  portraitCandidates,
  portraitManifestUrl,
} from '../assets/imageAssets.js';
import { useImageCandidate, useJsonAsset } from '../assets/useImageCandidate.js';
import { usePortraitPresentation } from '../assets/usePortraitPresentation.js';
import { slotClassName } from './stageLayout.js';

export default function PortraitLayer({ worldId, location, characters, messages, typingAgentIds, focusAgentIds, stageSnapshot, variant = 'console' }) {
  const generatedByAgent = generatedPortraitMap(messages, focusAgentIds);
  const stage =
    variant === 'immersive' && stageSnapshot
      ? { characters: stageSnapshot.stageActors, hasFocus: stageSnapshot.hasFocus }
      : {
          characters: characters.slice(0, 4).map((character) => ({
            character,
            slot: null,
            role: 'present',
            active: false,
            featured: false,
            style: {},
          })),
          hasFocus: false,
        };
  const visibleCharacters = stage.characters;

  if (visibleCharacters.length === 0) {
    return <div className="stage-empty">当前地点没有角色。</div>;
  }

  return (
    <div className={`portrait-layer ${variant} ${stage.hasFocus ? 'has-focus' : ''}`.trim()}>
      {visibleCharacters.map((entry, index) => (
        <PortraitFigure
          key={entry.character.id}
          worldId={worldId}
          character={entry.character}
          index={index}
          total={visibleCharacters.length}
          generated={generatedByAgent.get(entry.character.id)}
          active={entry.active}
          featured={entry.featured}
          typing={typingAgentIds.includes(entry.character.id)}
          variant={variant}
          slot={entry.slot}
          displayRole={entry.role}
          stageStyle={entry.style}
        />
      ))}
    </div>
  );
}

function PortraitFigure({ worldId, character, index, total, generated, active, featured, typing, variant, slot, displayRole, stageStyle }) {
  const emotion = emotionFromState(character.state);
  const manifest = useJsonAsset(portraitManifestUrl(worldId, character.id));
  const { candidate, status } = useImageCandidate(
    portraitCandidates({ worldId, character, emotion, manifest, generated }),
  );
  const presentation = usePortraitPresentation(candidate?.src);
  const presentationMode = status === 'ready' ? presentation.mode : 'fallback';

  return (
    <figure
      className={`portrait-figure portrait-${index} ${variant} ${slotClassName(slot)} role-${displayRole} presentation-${presentationMode} ${active ? 'active' : ''} ${featured ? 'featured' : ''} ${status === 'missing' ? 'missing' : ''}`}
      style={{ '--portrait-total': total, '--portrait-index': index, ...stageStyle }}
      title={candidate?.source ? `立绘来源：${sourceLabel(candidate.source)} · 展示策略：${presentationMode}` : undefined}
    >
      <TransitionImage
        src={candidate?.src}
        alt={`${character.name} 立绘`}
        className="portrait-image"
        placeholder={<div className="portrait-placeholder">{character.name?.[0] ?? '?'}</div>}
      />
      {variant !== 'immersive' && (
        <figcaption>
          <strong>{character.name}</strong>
          <span>{character.state?.mood || character.state?.action || '在场'}</span>
          <div className="portrait-badges">
            <Badge tone="neutral">{emotion}</Badge>
            {candidate?.source && <Badge tone={candidate.source === 'generated' ? 'success' : 'neutral'}>{sourceLabel(candidate.source)}</Badge>}
            {typing && <Badge tone="success">回复中</Badge>}
          </div>
        </figcaption>
      )}
    </figure>
  );
}

function sourceLabel(source) {
  switch (source) {
    case 'manifest':
    case 'manifest-default':
      return 'manifest';
    case 'fixed-emotion':
    case 'fixed-default':
      return '固定路径';
    case 'generated':
      return '最近生成';
    case 'avatar':
      return '头像兜底';
    default:
      return source;
  }
}
