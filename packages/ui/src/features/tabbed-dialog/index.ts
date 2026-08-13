export { findActiveTab, resolveInitialActiveTabId } from './rules.js';
export type { TabbedDialogChromeLabels, TabbedDialogTabMeta } from './types.js';

export { useTabbedDialog } from './react/hooks/useTabbedDialog.js';
export type {
  TabbedDialogController,
  UseTabbedDialogParams,
} from './react/hooks/useTabbedDialog.js';
export { TabbedDialog } from './react/components/TabbedDialog.js';
export type { TabbedDialogProps, TabbedDialogTab } from './react/components/TabbedDialog.js';
