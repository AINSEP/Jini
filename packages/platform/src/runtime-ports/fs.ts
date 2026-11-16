/**
 * @module runtime-ports/fs
 *
 * Node bindings of core's `FileLockPort` and `AtomicFileWriterPort` over this package's own
 * functions. Every member has the port's shape already (`writeText` is `writeFileAtomicAsync` under
 * the port's name), so this is a naming map, not an adapter; the `satisfies` clause is what fails
 * when either side changes. The process binding lives in `./runtime-ports/process` (separate entry:
 * subpath isolation keeps the `fs` and `os` domains apart).
 */
import type { AtomicFileWriterPort, FileLockPort } from "@jini-ai/core/contracts/runtime";
import { backupOriginalOnce } from "../fs/backup-once.js";
import { writeFileAtomicAsync, writeJsonFileAtomicAsync } from "../fs/atomic-write.js";
import { withFileLock } from "../fs/file-lock.js";

/** The Node implementation of the lock port. */
export const nodeFileLock = { withFileLock } satisfies FileLockPort;

/** The Node implementation of the atomic-writer port. */
export const nodeAtomicWriter = { writeText: writeFileAtomicAsync, writeJson: writeJsonFileAtomicAsync, backupOriginalOnce } satisfies AtomicFileWriterPort;
