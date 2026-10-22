import type { TargetDescription } from "../transfer/postgres-target.js";
export interface SavedDatabaseDestination {
  readonly connectionString: string;
  readonly description: TargetDescription;
  readonly savedAt: string;
}

/** What `database_transfer_status` reports about the last run. Never row data, never the address. */
export type DatabaseTransferRunSummary =
  | { readonly copied: true; readonly snapshotAt: string; readonly tableCount: number; readonly rowCount: number }
  | { readonly copied: false; readonly snapshotAt: string; readonly code: string; readonly message: string };

export interface DatabaseDestinationStorePort {
  /** @throws {DestinationUnreadableError} When a saved address exists but cannot be opened. */
  get(workspaceId: string): Promise<SavedDatabaseDestination | null>;
  /** Replaces any earlier destination for the workspace, and forgets its last run. */
  save(workspaceId: string, destination: SavedDatabaseDestination): Promise<void>;
  lastRun(workspaceId: string): Promise<DatabaseTransferRunSummary | null>;
  recordRun(workspaceId: string, summary: DatabaseTransferRunSummary): Promise<void>;
}

