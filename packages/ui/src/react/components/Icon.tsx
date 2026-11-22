import type { SVGProps } from 'react';

// The union itself lives at this package's root (`icon-name.ts`) — it is
// data, and framework-free modules elsewhere in this package name icons
// too. Re-exported here so every existing importer of this module keeps
// resolving.
import type { IconName } from '../../icon-name.js';
export type { IconName } from '../../icon-name.js';
import { LINE_GLYPH_RENDERERS } from './icon-line-glyphs.js';
import type { CommonIconProps, IconRenderer } from './icon-renderer-types.js';
import { ACTION_ICON_RENDERERS } from './icon-action-renderers.js';
import { WORKSPACE_ICON_RENDERERS } from './icon-workspace-renderers.js';
import { CONTROL_ICON_RENDERERS } from './icon-control-renderers.js';

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number | string;
}

// Exported as a test seam only — call it directly to assert key-set
// completeness and per-entry validity without rendering. NOT part of the
// package's public API: do not re-export it from `packages/ui/src/index.ts`
// or any entry point.
export const ICON_RENDERERS: Record<IconName, IconRenderer> = {
    ...LINE_GLYPH_RENDERERS,
    ...ACTION_ICON_RENDERERS,
    ...WORKSPACE_ICON_RENDERERS,
    ...CONTROL_ICON_RENDERERS,
  };

/**
 * Lightweight inline-SVG icon set tuned to the design system. Stroke-based
 * (Feather/Lucide style) so they pair cleanly with `currentColor` and adopt
 * the local text color. Use sparingly inside buttons that already have
 * accessible labels — set `aria-hidden` by default.
 */
export function Icon({ name, size = 14, strokeWidth = 1.6, ...rest }: Props) {
  const common: CommonIconProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: 'false' as const,
    ...rest,
  };
  const render = ICON_RENDERERS[name];
  return render ? render(common) : null;
}
