/** Where a directory-rollback failure is written. The host binds its own log sink (for a server,
 *  its console) and owns how the failure is formatted for the log; this module writes to no console
 *  and hands the sink the raw `error`, so the host decides what is safe to log. */
export type DirectoryRollbackLogSink = (required: { message: string; error: unknown }) => void;

/**
 * Builds the `onRollbackError` callback `unhideIfRemoveThrows` (`../adapters/directory.node.ts`)
 * calls when un-hiding a directory after a failed removal itself fails. The error reaches the sink
 * unformatted: the host's sink must redact it (e.g. through its error-for-log describer) before it
 * writes, so a rollback failure never logs a raw error object (and whatever secrets its fields carry).
 *
 * @complexity O(1) per report.
 */
export function createDirectoryRollbackReporter(
  { log }: { log: DirectoryRollbackLogSink },
  _optional = {},
): (required: { error: unknown }) => void {
  return ({ error }) => log({ message: "[trash] Could not unhide the directory after a failed removal", error });
}
