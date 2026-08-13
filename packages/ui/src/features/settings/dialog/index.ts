// `SettingsDialogShell` is now a thin, settings-flavoured wrapper around the generic
// `TabbedDialog` (`../../tabbed-dialog/`, extracted 2026-08-13) — every export below is a
// direct alias/re-export of that module's equivalent, kept under its historical name so
// nothing importing `@jini-ai/ui`'s settings-dialog surface needs to change.
export { findActiveTab, resolveInitialActiveTabId } from '../../tabbed-dialog/rules.js';
export type {
  TabbedDialogChromeLabels as SettingsDialogChromeLabels,
  TabbedDialogTabMeta as SettingsDialogTabMeta,
} from '../../tabbed-dialog/types.js';

export { useSettingsDialogShell } from './react/hooks/useSettingsDialogShell.js';
export type {
  SettingsDialogShellController,
  UseSettingsDialogShellParams,
} from './react/hooks/useSettingsDialogShell.js';
export { SettingsDialogShell } from './react/components/SettingsDialogShell.js';
export type { SettingsDialogShellProps, SettingsDialogTab } from './react/components/SettingsDialogShell.js';
