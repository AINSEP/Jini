import type { SettingsThemeChoice } from './types.js';

export interface ThemeOption {
  value: SettingsThemeChoice;
  label: string;
  icon?: 'sun' | 'moon';
}

/** Plain-English defaults for the three segmented-control options — a host
 *  wanting localized copy overrides via `AppearanceTabProps.themeLabels` (the
 *  component wraps each through `useT()` regardless, so this is only the
 *  fallback text, same convention as every other tab in this feature). */
export const THEME_OPTIONS: ThemeOption[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

/** Neutral default accent — hosts are expected to override via their own
 *  config/branding; this only guarantees the CSS vars are always set. */
export const DEFAULT_ACCENT_COLOR = '#2563eb';

export const ACCENT_SWATCHES = [
  DEFAULT_ACCENT_COLOR,
  '#c96442',
  '#7c3aed',
  '#059669',
  '#dc2626',
  '#d97706',
  '#0891b2',
  '#db2777',
] as const;
