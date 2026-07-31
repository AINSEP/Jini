/**
 * Origin: `AppearanceSection` in `SettingsDialog.tsx` (theme segmented
 * control + accent-color swatch grid + custom color picker), GENERIC per
 * `foundry/docs/jini-port/recon/r6-god-component-internals.md` §1.3. See
 * `packages/ui/source-map.md` for the full provenance note.
 */

/** `'system'` in addition to this package's `AppearanceTheme` ('light' |
 *  'dark') — the origin's segmented control has a third "follow the OS"
 *  option that `applyAppearanceToDocument` already models as "theme
 *  omitted." */
export type SettingsThemeChoice = 'system' | 'light' | 'dark';
