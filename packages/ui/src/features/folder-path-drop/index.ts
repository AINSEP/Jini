export type { FolderPathDropPort } from './ports.js';
export type {
  CaptureFolderPathDropInput,
  FolderPathDropEvent,
  FolderPathDropInsertTarget,
  FolderPathDropInsertTargetRef,
} from './types.js';
export { captureFolderPathDrop, folderPathsFromDataTransfer, formatDroppedFolderPaths } from './rules.js';

export { useFolderPathDropCapture } from './react/hooks/useFolderPathDropCapture.js';
export type { UseFolderPathDropCaptureOptions } from './react/hooks/useFolderPathDropCapture.js';
