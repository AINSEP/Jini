export {
  FILE_SYSTEM_READ_ERROR_MESSAGE,
  createFileSystemReadError,
  isFileSystemReadError,
} from './file-system-errors.js';

// `filesFromDataTransfer`/`filesFromFileSystemEntry`/`filesFromClipboardData`/
// `normalizePastedFile`/`extensionForMimeType`/`shouldIgnoreClipboardFilePaste`
// live in `./file-transfer.js` but are deliberately NOT re-exported here —
// `features/asset-tree-browser/index.js` already re-exports them (its own
// pre-existing public surface, unchanged by the 2026-07-18 promotion into
// this file) and is itself part of this package's top-level barrel; adding a
// second `export *` source for the same names would make them ambiguous
// (TypeScript/Rollup silently drop a name duplicated across `export *`
// sources) at `packages/ui/src/index.ts`.

export { isImeComposing } from './ime-composing.js';

export {
  SUCCESS_SOUNDS,
  FAILURE_SOUNDS,
  DEFAULT_SUCCESS_SOUND_ID,
  DEFAULT_FAILURE_SOUND_ID,
  playSound,
  previewSuccess,
  previewFailure,
  notificationPermission,
  requestNotificationPermission,
  showCompletionNotification,
} from './notifications.js';
export type {
  SoundId,
  SoundOption,
  CompletionNotificationOpts,
  CompletionNotificationResult,
} from './notifications.js';

export { isMacPlatform } from './platform.js';

export { smoothScrollToTop } from './smooth-scroll-to-top.js';

export { randomUUID } from './uuid.js';

export {
  DEFAULT_VISUAL_STABILITY_STORAGE_KEY,
  isVisualStabilityMode,
} from './visual-stability.js';
