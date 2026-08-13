/**
 * `SettingsDialogShell`'s dialog-shell state (active tab, sidebar-collapsed, fullscreen,
 * escape-to-close, scroll-to-top-on-tab-change) is owned entirely by the generic
 * `useTabbedDialog` (`../../../tabbed-dialog/react/hooks/useTabbedDialog.js`) as of the
 * 2026-08-13 extraction — this file re-exports it under the historical
 * `useSettingsDialogShell` name so anything still importing that name directly keeps
 * resolving, without a second, duplicate implementation to keep in sync.
 */
export { useTabbedDialog as useSettingsDialogShell } from '../../../../tabbed-dialog/react/hooks/useTabbedDialog.js';
export type {
  TabbedDialogController as SettingsDialogShellController,
  UseTabbedDialogParams as UseSettingsDialogShellParams,
} from '../../../../tabbed-dialog/react/hooks/useTabbedDialog.js';
