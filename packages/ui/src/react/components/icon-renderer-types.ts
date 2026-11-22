import type { ReactElement, SVGProps } from 'react';

// The fully-resolved props every icon renders with: size, stroke, and any
// caller overrides already merged in (see `Icon` below). A lookup table
// keyed by every `IconName` — TypeScript enforces the key set is exhaustive,
// so a name added to the union without a matching entry here is a compile
// error rather than a silent `default: return null`.
export type CommonIconProps = SVGProps<SVGSVGElement>;
export type IconRenderer = (common: CommonIconProps) => ReactElement;

