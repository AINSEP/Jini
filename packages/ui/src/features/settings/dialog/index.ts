export { findActiveTab, resolveInitialActiveTabId } from './rules.js';
export type { SettingsDialogChromeLabels, SettingsDialogTabMeta } from './types.js';

export { useSettingsDialogShell } from './react/hooks/useSettingsDialogShell.js';
export type {
  SettingsDialogShellController,
  UseSettingsDialogShellParams,
} from './react/hooks/useSettingsDialogShell.js';
export { SettingsDialogShell } from './react/components/SettingsDialogShell.js';
export type { SettingsDialogShellProps, SettingsDialogTab } from './react/components/SettingsDialogShell.js';
