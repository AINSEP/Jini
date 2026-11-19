/**
 * @module fs
 *
 * Node bindings of core's `FileLockPort` and `AtomicFileWriterPort` over `@jini-ai/platform`'s own
 * functions. Every member has the port's shape already (`writeText` is `writeFileAtomicAsync` under
 * the port's name), so this is a naming map, not an adapter; the `satisfies` clause is what fails
 * when either side changes. The process binding lives in `@jini-ai/node-adapters/process` (separate
 * entry: subpath isolation keeps the `fs` and `os` domains apart).
 */
import type { AtomicFileWriterPort } from "@jini-ai/core/contracts/runtime";
import { backupOriginalOnce, writeFileAtomicAsync, writeJsonFileAtomicAsync } from "@jini-ai/platform/fs";

/** The host-bound Node implementation of the lock port. */
export { createNodeFileLock } from "@jini-ai/platform/fs";

/** The Node implementation of the atomic-writer port. */
export const nodeAtomicWriter = { writeText: writeFileAtomicAsync, writeJson: writeJsonFileAtomicAsync, backupOriginalOnce } satisfies AtomicFileWriterPort;
