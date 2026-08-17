/**
 * Generic "tabbed dialog" shell types.
 *
 * Extracted (2026-08-13) from `SettingsDialogShell` (`../settings/dialog/`) once Tovu was
 * mounting that shell for five different screens — only one of them (`SettingsUi.tsx`)
 * was actually Settings; `AgentPlugins.tsx`, `AiAssistant.tsx`, `Authentication.tsx`, and
 * `PlaceholderTabs.tsx` were reusing "the settings dialog" purely for its generic tabbed
 * chrome. `SettingsDialogShell` now composes this module and supplies its own
 * settings-flavoured label defaults (`t('Settings')`, `t('Settings sections')`, …) — see
 * that component's doc comment. Original provenance: `SettingsDialog.tsx` (8,538 lines) in
 * the vendored OD reference tree — see `packages/ui/source-map.md`.
 *
 * Only the dialog SHELL (sidebar nav + active-panel switching + modal chrome) is modeled
 * here; a host supplies its own tabs as tab entries.
 *
 * Kept free of a `panel`/`icon` field on purpose: those are inherently React-shaped (JSX to
 * render), so they live on the `react/`-layer prop type (`TabbedDialogTab` in
 * `react/components/TabbedDialog.tsx`), which extends `TabbedDialogTabMeta` below with the
 * render-specific fields. This file stays free of any `react` import, per this package's
 * React-layout policy (see `packages/ui/README.md`).
 */

/** The non-rendering identity/copy of one tab. */
export interface TabbedDialogTabMeta<TId extends string = string> {
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
 *  every field has a plain-English, product-neutral default; a host wanting localization
 *  wraps these through its own `useT()` before passing them in, or mounts
 *  `I18nProvider` around the shell, which reads its own defaults through
 *  `useT()` too. */
export interface TabbedDialogChromeLabels {
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
