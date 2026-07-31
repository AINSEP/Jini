export type {
  AboutUpdateControl,
  AboutUpdatePrimaryAction,
  AboutUpdateTone,
  AppVersionInfo,
  UpdateKind,
  UpdaterDownloadProgress,
  UpdaterEnvironment,
  UpdaterModel,
  UpdaterState,
  UpdaterStatus,
} from './types.js';

export { ABOUT_UPDATE_KEYS, deriveAboutUpdateControl, isAboutUpdateActionDisabled } from './rules.js';
