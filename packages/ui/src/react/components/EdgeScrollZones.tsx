// The two edge overlays driven by `useEdgeAutoScroll`. Render as siblings of
// the scroll element inside a `position: relative` wrapper. Each zone is only
// visible/interactive when there is content to scroll toward (driven by
// `edges`).
import type { EdgeAutoScroll } from '../hooks/useEdgeAutoScroll.js';
import { Icon } from './Icon.js';

export function EdgeScrollZones({
  edges,
  startAutoScroll,
  stopAutoScroll,
  nudge,
}: Pick<EdgeAutoScroll, 'edges' | 'startAutoScroll' | 'stopAutoScroll' | 'nudge'>) {
  return (
    <>
      <div
        className="jini-edge-scroll-zone jini-edge-scroll-zone--left"
        data-active={edges.left ? 'true' : undefined}
        aria-hidden
        onPointerEnter={() => startAutoScroll(-1)}
        onPointerLeave={stopAutoScroll}
        onPointerDown={stopAutoScroll}
        onClick={() => nudge(-1)}
      >
        <Icon name="chevron-left" size={18} className="jini-edge-scroll-zone-icon" />
      </div>
      <div
        className="jini-edge-scroll-zone jini-edge-scroll-zone--right"
        data-active={edges.right ? 'true' : undefined}
        aria-hidden
        onPointerEnter={() => startAutoScroll(1)}
        onPointerLeave={stopAutoScroll}
        onPointerDown={stopAutoScroll}
        onClick={() => nudge(1)}
      >
        <Icon name="chevron-right" size={18} className="jini-edge-scroll-zone-icon" />
      </div>
    </>
  );
}
