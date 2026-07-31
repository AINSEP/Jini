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
} from './types.js';

export {
  ABOUT_UPDATE_KEYS,
  beginSilentUpdatesWrite,
  deriveAboutUpdateControl,
  isAboutUpdateActionDisabled,
  resolveSilentUpdatesWriteFailure,
  resolveSilentUpdatesWriteSuccess,
} from './rules.js';
