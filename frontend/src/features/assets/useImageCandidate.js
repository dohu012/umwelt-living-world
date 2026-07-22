import { useEffect, useMemo, useState } from 'react';

export function useJsonAsset(url) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    if (!url) return undefined;

    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return data;
}

export function useImageCandidate(candidates) {
  const signature = JSON.stringify((candidates ?? []).map((candidate) => candidate?.src).filter(Boolean));
  const stableCandidates = useMemo(
    () => (candidates ?? []).filter((candidate) => candidate?.src),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  );
  const [result, setResult] = useState({ status: 'idle', candidate: null });

  useEffect(() => {
    let cancelled = false;
    setResult({ status: stableCandidates.length ? 'loading' : 'missing', candidate: null });

    async function probe() {
      for (const candidate of stableCandidates) {
        const ok = await imageExists(candidate.src);
        if (cancelled) return;
        if (ok) {
          setResult({ status: 'ready', candidate });
          return;
        }
      }
      setResult({ status: 'missing', candidate: null });
    }

    probe();
    return () => {
      cancelled = true;
    };
  }, [stableCandidates]);

  return result;
}

function imageExists(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}
