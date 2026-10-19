/**
 * @module Icon
 *
 * A minimal inline-SVG icon set covering only the glyphs this package's own
 * components use. Kept private so low-level chat leaves remain small; the
 * higher-level ChatPane composition also reuses `@jini-ai/ui`'s generic
 * AgentIcon and WorkingDirPicker.
 */
import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'spinner'
  | 'check'
  | 'close'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'attach'
  | 'file'
  | 'image'
  | 'x'
  | 'comment'
  | 'search'
  | 'plus'
  | 'pencil'
  | 'copy';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number | string;
}

const CROSS = <><path d="M20 4 4 20" /><path d="m4 4 16 16" /></>;

// Each glyph's SVG children; `Icon` wraps them in the shared `<svg>` shell.
const ICON_GLYPHS: Record<IconName, ReactNode> = {
  spinner: <path d="M21 12a9 9 0 1 1-6.22-8.56" />,
  check: <path d="M20 6 9 17l-5-5" />,
  close: CROSS,
  x: CROSS,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  /** Conversation-switcher trigger — a speech bubble reads as "chat history" without a label. */
  comment: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  attach: <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h6" /></>,
  image: <><rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>,
  pencil: <><path d="m16 3 5 5L8 21H3v-5L16 3Z" /><path d="m14 5 5 5" /></>,
  /** Per-message copy affordance (MessageRow.tsx). Two overlapping squares -- the conventional copy glyph. */
  copy: <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
};

export function Icon({ name, size = 14, strokeWidth = 1.6, ...rest }: IconProps) {
  // The spinner alone puts its spin class in front of any caller-supplied one.
  const className = name === 'spinner' ? `jini-icon-spin ${rest.className ?? ''}`.trim() : rest.className;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
      className={className}
    >
      {ICON_GLYPHS[name]}
    </svg>
  );
}
