export type { SettingsDialogChromeLabels, SettingsDialogTabMeta } from '@jini-ai/ui-core';
export { findActiveTab, resolveInitialActiveTabId } from '@jini-ai/ui-core';

export { useSettingsDialogShell } from './react/hooks/useSettingsDialogShell.js';
export type {
  SettingsDialogShellController,
  UseSettingsDialogShellParams,
} from './react/hooks/useSettingsDialogShell.js';
export { SettingsDialogShell } from './react/components/SettingsDialogShell.js';
export type { SettingsDialogShellProps, SettingsDialogTab } from './react/components/SettingsDialogShell.js';
