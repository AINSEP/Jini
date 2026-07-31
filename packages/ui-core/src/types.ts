/**
 * Generic "tabbed settings dialog" shell types.
 *
 * Origin: `SettingsDialog.tsx` (8,538 lines) in the vendored OD reference
 * tree — see `packages/ui/source-map.md` for the full provenance note. Only
 * the dialog SHELL (sidebar nav + active-panel switching + modal chrome) is
 * modeled here; a host supplies its own tabs (both the ones this package
 * also ships under `tabs/*` and any product-specific ones) as tab entries.
 *
 * Kept free of a `panel`/`icon` field on purpose: those are inherently
 * React-shaped (JSX to render), so they live on the `react/`-layer prop type
 * (`SettingsDialogTab` in `react/components/SettingsDialogShell.tsx`), which
 * extends `SettingsDialogTabMeta` below with the render-specific fields.
 * This file stays free of any `react` import, per this package's
 * React-layout policy (see `packages/ui/README.md`).
 */

/** The non-rendering identity/copy of one settings tab. */
export interface SettingsDialogTabMeta<TId extends string = string> {
  id: TId;
  /** Short label shown in the sidebar nav item. */
  label: string;
  /** Optional sidebar nav item sub-label (e.g. a one-line hint). */
  navHint?: string;
  /** Header title shown above the active tab's panel. Defaults to `label`. */
  title?: string;
  /** Header subtitle shown under the title. */
  subtitle?: string;
}

/** Labels the shell renders itself (chrome, not any one tab). All optional —
 *  every field has a plain-English default; a host wanting localization
 *  wraps these through its own `useT()` before passing them in, or mounts
 *  `I18nProvider` around the shell, which reads its own defaults through
 *  `useT()` too. */
export interface SettingsDialogChromeLabels {
  kicker?: string;
  welcomeKicker?: string;
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  closeLabel?: string;
  fullscreenLabel?: string;
  exitFullscreenLabel?: string;
  collapseSidebarLabel?: string;
  expandSidebarLabel?: string;
  sidebarAriaLabel?: string;
}
