/**
 * Small, generic inline-SVG icon set for the preview-modal shell's chrome
 * (close button, split-button caret, stage fullscreen toggle). Not a port of
 * the origin's `Icon` component (a product-specific named icon set, out of
 * scope for this package — same call already made for `AnnotationCanvas`'s
 * `icons.tsx`). A host can override every icon via
 * `PreviewModalShellProps.icons`.
 */
import type { ReactElement, SVGProps } from 'react';

export type PreviewModalIconName = 'close' | 'chevron-down' | 'fullscreen' | 'fullscreen-exit';

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    />
  );
}

export const DEFAULT_PREVIEW_MODAL_ICONS: Record<PreviewModalIconName, () => ReactElement> = {
  close: () => (
    <Svg>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </Svg>
  ),
  'chevron-down': () => (
    <Svg>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
  fullscreen: () => (
    <Svg width={15} height={15}>
      <path d="M3 9V3h6M3 3l6 6M21 15v6h-6M21 21l-6-6" />
    </Svg>
  ),
  'fullscreen-exit': () => (
    <Svg width={15} height={15}>
      <path d="M9 3v6H3M3 9l6-6M15 21v-6h6M21 15l-6 6" />
    </Svg>
  ),
};
