/**
 * The host-specific half of a folder-path drop: resolving a dropped `File` to its absolute OS path.
 * Browsers never expose one (`File` has no path by design — see `utils/file-transfer.ts`'s header),
 * so only a host with native file access can supply this, e.g. an Electron preload passing
 * `webUtils.getPathForFile` through `contextBridge`. A page with no such host has no port at all,
 * and every drop falls through to its ordinary file handling.
 */
export interface FolderPathDropPort {
  /**
   * Synchronous on purpose: the path must be read off the raw drop before any bubble-phase handler
   * expands the folder into synthesized leaf files (see `rules.ts`'s header). Returns `''` for a
   * `File` it cannot resolve — Electron's `webUtils.getPathForFile` contract.
   */
  getPathForFile(file: File): string;
}
