import { useEffect, useMemo, useState } from 'react';

export default function Avatar({ src, srcCandidates = [], name = '?', size = 'md', shape = 'round', className = '' }) {
  const initial = name?.trim()?.[0]?.toUpperCase() ?? '?';
  const sources = useMemo(
    () => [...new Set([src, ...srcCandidates.map((candidate) => candidate?.src ?? candidate)].filter(Boolean))],
    [src, srcCandidates],
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  const [failedAll, setFailedAll] = useState(false);

  useEffect(() => {
    setSourceIndex(0);
    setFailedAll(false);
  }, [sources.join('|')]);

  const currentSrc = sources[sourceIndex];

  return currentSrc && !failedAll ? (
    <img
      className={`avatar ${size} ${shape} ${className}`.trim()}
      src={currentSrc}
      alt={name}
      onError={() => {
        setSourceIndex((index) => {
          if (index + 1 < sources.length) return index + 1;
          setFailedAll(true);
          return index;
        });
      }}
    />
  ) : (
    <div className={`avatar placeholder ${size} ${shape} ${className}`.trim()}>{initial}</div>
  );
}
