import type { DenyRules, GuardedFileReader, GuardedReaderLimits } from '@jini-ai/core/filesystem';

/** Filesystem capabilities required by the local project adapter. Composition binds the existing
 * platform implementations so containment, locking and atomic writes keep a single owner.
 * @example const filesystem: ProjectFilesystemPort = { createReader, withFileLock, writeFileAtomicAsync, writeJsonFileAtomicAsync };
 */
export interface ProjectFilesystemPort {
  createReader(required: { rootPath: string; denyRules: DenyRules; limits: GuardedReaderLimits }, options?: {
    excludedListingDirs?: ReadonlySet<string>;
  }): GuardedFileReader;
  withFileLock<T>(required: { lockPath: string; run: () => Promise<T> }, options?: {
    staleMs?: number; createParent?: boolean;
  }): Promise<T>;
  writeFileAtomicAsync(required: { filePath: string; content: string | Uint8Array }, options?: {
    createParent?: boolean; refuseSymlink?: boolean; defaultMode?: number;
  }): Promise<void>;
  writeJsonFileAtomicAsync(required: { filePath: string; data: unknown }, options?: { createParent?: boolean }): Promise<void>;
}
