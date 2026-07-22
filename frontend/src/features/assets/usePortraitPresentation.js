import { useEffect, useState } from 'react';

const DEFAULT_PRESENTATION = {
  status: 'idle',
  mode: 'fallback',
  hasAlpha: false,
  lightEdgeRatio: 0,
  lightRatio: 0,
  transparentEdgeRatio: 0,
  aspectRatio: 0,
};

export function usePortraitPresentation(src) {
  const [presentation, setPresentation] = useState(DEFAULT_PRESENTATION);

  useEffect(() => {
    let cancelled = false;
    setPresentation(src ? { ...DEFAULT_PRESENTATION, status: 'analyzing' } : DEFAULT_PRESENTATION);
    if (!src) return undefined;

    analyzePortraitImage(src)
      .then((result) => {
        if (!cancelled) setPresentation(result);
      })
      .catch(() => {
        if (!cancelled) setPresentation({ ...DEFAULT_PRESENTATION, status: 'unknown', mode: 'framed' });
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return presentation;
}

function analyzePortraitImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        resolve(analyzeLoadedImage(image));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = reject;
    image.src = src;
  });
}

function analyzeLoadedImage(image) {
  const maxSide = 80;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const border = Math.max(2, Math.round(Math.min(width, height) * 0.08));

  let edgeCount = 0;
  let lightEdgeCount = 0;
  let lightCount = 0;
  let transparentEdgeCount = 0;
  let transparentCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      const isEdge = x < border || x >= width - border || y < border || y >= height - border;

      if (alpha < 245) transparentCount += 1;
      if (alpha > 245 && luma > 220 && chroma < 26) lightCount += 1;
      if (!isEdge) continue;

      edgeCount += 1;
      if (alpha < 245) transparentEdgeCount += 1;
      if (alpha > 245 && luma > 220 && chroma < 30) lightEdgeCount += 1;
    }
  }

  const total = width * height;
  const transparentEdgeRatio = edgeCount ? transparentEdgeCount / edgeCount : 0;
  const transparentRatio = total ? transparentCount / total : 0;
  const lightEdgeRatio = edgeCount ? lightEdgeCount / edgeCount : 0;
  const lightRatio = total ? lightCount / total : 0;
  const hasAlpha = transparentEdgeRatio > 0.08 || transparentRatio > 0.03;
  const aspectRatio = image.naturalWidth / image.naturalHeight;

  let mode = 'framed';
  if (hasAlpha) {
    mode = 'cutout';
  } else if (lightEdgeRatio > 0.42 || lightRatio > 0.38) {
    mode = 'light-background';
  } else if (aspectRatio > 0.95 || aspectRatio < 0.42) {
    mode = 'framed';
  } else {
    mode = 'soft-framed';
  }

  return {
    status: 'ready',
    mode,
    hasAlpha,
    lightEdgeRatio,
    lightRatio,
    transparentEdgeRatio,
    aspectRatio,
  };
}
