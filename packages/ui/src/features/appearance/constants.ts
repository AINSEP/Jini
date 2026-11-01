import { defaultAdminTheme } from '../../core/theme/default.js';
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
export const DEFAULT_ACCENT_COLOR = defaultAdminTheme.light.primary;

/** One owner for each preset's color and English translation key. Hosts supply translations. */
export const ACCENT_SWATCH_PRESETS = [
  { color: DEFAULT_ACCENT_COLOR, nameKey: 'Charcoal' },
  { color: '#c96442', nameKey: 'Clay' },
  { color: '#7c3aed', nameKey: 'Violet' },
  { color: '#059669', nameKey: 'Green' },
  { color: '#dc2626', nameKey: 'Red' },
  { color: '#d97706', nameKey: 'Amber' },
  { color: '#0891b2', nameKey: 'Teal' },
  { color: '#db2777', nameKey: 'Pink' },
] as const;

/** Keep the existing string palette API for hosts that compose their own swatch lists. */
export const ACCENT_SWATCHES: readonly string[] = ACCENT_SWATCH_PRESETS.map(({ color }) => color);
