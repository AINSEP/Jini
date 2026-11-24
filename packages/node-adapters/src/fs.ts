/**
 * @module fs
 *
 * Node bindings of core's `FileLockPort` and `AtomicFileWriterPort` over `@jini-ai/platform`'s own
 * functions, which the host passes in (this package imports no other package's implementation). Every
 * member has the port's shape already (`writeText` is `writeFileAtomicAsync` under the port's name), so
 * this is a naming map, not an adapter; the `extends` bounds are what fail when either side changes,
 * and each builder returns the functions it was handed with their own (wider) types intact. The process
 * binding lives in `@jini-ai/node-adapters/process` (separate entry: subpath isolation keeps the `fs`
 * and `os` domains apart).
 */
import type { AtomicFileWriterPort, FileLockPort } from "@jini-ai/core/contracts/runtime";

/**
 * The Node lock port over the host's `withFileLock` (a Node host passes `@jini-ai/platform/fs`'s).
 * @complexity O(1).
 */
export function createFileLockPort<Lock extends FileLockPort["withFileLock"]>(required: { readonly withFileLock: Lock }, _optional: Record<string, never> = {}): { readonly withFileLock: Lock } {
  return { withFileLock: required.withFileLock };
}

/** The platform file functions the atomic-writer port renames; a Node host passes `@jini-ai/platform/fs`'s. */
export interface AtomicWriterFunctions<Text extends AtomicFileWriterPort["writeText"], Json extends AtomicFileWriterPort["writeJson"]> {
  readonly writeFileAtomicAsync: Text;
  readonly writeJsonFileAtomicAsync: Json;
  readonly backupOriginalOnce: AtomicFileWriterPort["backupOriginalOnce"];
}

/**
 * The Node atomic-writer port: `writeFileAtomicAsync` under the port's `writeText`, `writeJsonFileAtomicAsync`
 * under `writeJson`, `backupOriginalOnce` as is.
 * @complexity O(1).
 */
export function createAtomicWriterPort<Text extends AtomicFileWriterPort["writeText"], Json extends AtomicFileWriterPort["writeJson"]>(
  required: AtomicWriterFunctions<Text, Json>,
  _optional: Record<string, never> = {},
): { readonly writeText: Text; readonly writeJson: Json; readonly backupOriginalOnce: AtomicFileWriterPort["backupOriginalOnce"] } {
  return { writeText: required.writeFileAtomicAsync, writeJson: required.writeJsonFileAtomicAsync, backupOriginalOnce: required.backupOriginalOnce };
}
