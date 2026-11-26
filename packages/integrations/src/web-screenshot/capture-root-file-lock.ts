import path from "node:path";
import type { CaptureRootLock } from "./capture-files.js";

/** The lock file's name inside the captures root; it is not a `<date>/<name>.jpg`, so cleanup never offers it. */
export const CAPTURE_LOCK_NAME = ".writer.lock";

/** The slice of `@jini-ai/platform/fs`'s `withFileLock` this lock uses. */
export type CaptureFileLockRunner = <T>(
  required: { lockPath: string; run: () => Promise<T> },
  options: { createParent: boolean },
) => Promise<T>;

/**
 * A cross-process lock keyed by the resolved captures root: the agent's capture writer and the
 * owner's cleanup may run in different processes (desktop and server share one site folder), so an
 * in-memory mutex would not keep a cleanup from deleting a capture mid-publication.
 * @complexity O(1) per acquisition beyond the file lock's own polling.
 */
export function createCaptureRootFileLock({ withFileLock }: { withFileLock: CaptureFileLockRunner }, _optional: Record<string, never> = {}): CaptureRootLock {
  return {
    withLock: ({ key, run }) => withFileLock({ lockPath: path.join(path.resolve(key), CAPTURE_LOCK_NAME), run }, { createParent: true }),
  };
}

