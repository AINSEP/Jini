import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";

export function reportDirectoryRollbackFailure({ error }: { error: unknown }, optional = {}): void {
  console.error("[trash] Could not unhide the directory after a failed removal", describeErrorForLog({ err: error }));
}
