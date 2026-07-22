import TransitionImage from '../assets/TransitionImage.jsx';
import { backgroundCandidates } from '../assets/imageAssets.js';
import { useImageCandidate } from '../assets/useImageCandidate.js';

export default function BackgroundLayer({ worldId, location, messages }) {
  const { candidate } = useImageCandidate(backgroundCandidates({ worldId, location, messages }));

  return (
    <div className="stage-background-layer">
      <TransitionImage
        src={candidate?.src}
        alt={candidate?.label ?? '场景背景'}
        className="stage-background-image"
        placeholder={<div className="stage-background-fallback" />}
      />
    </div>
  );
}
