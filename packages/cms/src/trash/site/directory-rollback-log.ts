import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";

/** Where a directory-rollback failure is written. The host binds its own log sink (for a server,
 *  its console); this module never writes to a console itself. */
export type DirectoryRollbackLogSink = (message: string, detail: unknown) => void;

/**
 * Builds the `onRollbackError` callback `unhideIfRemoveThrows` (`../adapters/directory.node.ts`)
 * calls when un-hiding a directory after a failed removal itself fails. The error is passed through
 * `describeErrorForLog` before it reaches the sink, so a rollback failure never logs a raw error
 * object (and whatever secrets its fields carry).
 *
 * @complexity O(1) per report.
 */
export function createDirectoryRollbackReporter(
  { log }: { log: DirectoryRollbackLogSink },
  _optional = {},
): (required: { error: unknown }) => void {
  return ({ error }) => log("[trash] Could not unhide the directory after a failed removal", describeErrorForLog({ err: error }));
}
