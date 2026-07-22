import { useEffect, useState } from 'react';

export default function TransitionImage({ src, alt, className = '', placeholder }) {
  const [current, setCurrent] = useState(src);
  const [previous, setPrevious] = useState(null);

  useEffect(() => {
    if (src === current) return undefined;
    setPrevious(current);
    setCurrent(src);
    const timer = window.setTimeout(() => setPrevious(null), 280);
    return () => window.clearTimeout(timer);
  }, [src, current]);

  if (!current) return placeholder ?? null;

  return (
    <div className={`transition-image ${className}`.trim()}>
      {previous && <img className="transition-image-old" src={previous} alt="" aria-hidden="true" />}
      <img className="transition-image-new" src={current} alt={alt} />
    </div>
  );
}
