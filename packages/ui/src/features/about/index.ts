export type {
  AboutUpdateControl,
  AboutUpdatePrimaryAction,
  AboutUpdateTone,
  AppVersionInfo,
  SilentUpdatesState,
  UpdateKind,
  UpdaterDownloadProgress,
  UpdaterEnvironment,
  UpdaterModel,
  UpdaterState,
  UpdaterStatus,
} from '@jini-ai/ui-core';
export {
  ABOUT_UPDATE_KEYS,
  beginSilentUpdatesWrite,
  deriveAboutUpdateControl,
  isAboutUpdateActionDisabled,
  resolveSilentUpdatesWriteFailure,
  resolveSilentUpdatesWriteSuccess,
} from '@jini-ai/ui-core';

export { AboutTab } from './react/components/AboutTab.js';
export type { AboutAppVersionInfo, AboutTabLabels, AboutTabProps } from './react/components/AboutTab.js';

export { useSilentUpdatesToggle } from './react/hooks/useSilentUpdatesToggle.js';
export type { UseSilentUpdatesToggleOptions, UseSilentUpdatesToggleResult } from './react/hooks/useSilentUpdatesToggle.js';
