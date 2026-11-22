import { useLayoutEffect, useState, type RefObject } from 'react';

type Measure = (required: { element: HTMLElement }, optional?: Record<string, never>) => { scrollWidth: number; clientWidth: number };

function measureElement({ element }: { element: HTMLElement }) {
  return { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
}

/** Measures horizontal overflow before paint, rechecking on dependency and layout changes. */
export function useOverflowTitle(
  { ref, deps }: { ref: RefObject<HTMLElement | null>; deps: readonly unknown[] },
  { doc = document, measure = measureElement }: { doc?: Document; measure?: Measure } = {},
): boolean {
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) { setTruncated(false); return undefined; }
    const update = () => {
      const { scrollWidth, clientWidth } = measure({ element });
      setTruncated(scrollWidth > clientWidth);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    doc.defaultView?.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      doc.defaultView?.removeEventListener('resize', update);
    };
  }, [ref, ...deps, doc, measure]);
  return truncated;
}
