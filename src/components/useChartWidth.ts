import { useLayoutEffect, useState } from 'react';

/** Grow the plotting width, never the height, labels or point size. */
export function useChartWidth(minimum: number) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(minimum);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setAvailable(Math.round(element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { chartRef: setElement, width: Math.max(minimum, available) };
}
