import type { TransferNaming } from "./transfer-naming.js";

/** Copy-only display defaults; actual persisted schema/marker names remain required host inputs. */
export interface DbTransferMessages {
  plan(required: { naming: Pick<TransferNaming, "defaultSchema" | "schemaPrefix"> }): string;
  readonly setDestination: string;
  readonly status: string;
  readonly run: string;
  readonly planIdDescription: string;
}

/** Host-replaceable runtime prose only. Persisted names, codes and SQL bytes are separate required inputs. */
export interface DbMessages extends DbTransferMessages {
  readonly restorePointUnavailable: string;
  readonly restorePointCostAck: string;
  readonly databaseHealth: string;
  readonly databaseSchemaState: string;
  readonly databasePendingMigrations: string;
  readonly databaseRestorePoints: string;
  readonly databasePlanMigrate: string;
  readonly databaseExecuteMigrate: string;
  readonly databaseCreateRestorePoint: string;
  readonly databaseRestoreGuidance: string;
  privateAreasTaken(required: { where: string }): string;
  readonly noDestination: string;
  readonly uncheckedLinks: string;
  destinationSaved(required: { database: string; host: string }): string;
  missingSourceTable(required: { table: string }): string;
  missingSourceColumn(required: { table: string; column: string }): string;
}

/** Neutral model-facing copy, replaceable as a whole by the host. No UI navigation assumptions. */
export const defaultDbMessages: DbMessages = {
  planIdDescription: "The planId database_transfer_plan returned. Single-use; valid for 10 minutes.",
  plan: ({ naming }) => `Plans a COPY of the source's data into a Postgres database (for example 'move/transfer/copy my data to Postgres'). The source keeps running on its built-in storage; this only makes a copy, into the source's own private area (Postgres schema) on that database: '${naming.defaultSchema}' for the first source copied there, '${naming.schemaPrefix}<source name>' for any other, and always the same one for this source afterwards. Several sources can share one database; each copy replaces only its own area. Read-only: it snapshots the source database, connects to the saved destination, and counts what would be copied. Logins, saved keys and secret settings are never copied; photos and files stay where they are. No input: the destination is the one the human saved with database_transfer_set_destination. Returns {planned: true, planId, expiresAt, destination: {host, port, database, user}, area (the schema), snapshotAt, tableCount, rowCount, replaces (the earlier copy's time, or null), leftOut, notes, nextStep}, or {planned: false, code, message} (codes: NO_DESTINATION, UNREACHABLE, SERVER_TOO_OLD, NO_CREATE_PERMISSION, TARGET_NOT_OURS, DATABASE_SNAPSHOT_FAILED, SCHEMA_MISMATCH, UNAVAILABLE). Tell the human in plain words what will be copied, then call database_transfer_run with the planId.`,
  setDestination: "Asks the human where a copy of the source's data should go: shows a private form where they paste a Postgres database address. HUMAN-GATED: this one call shows the form and WAITS. You never see the address, and must never ask for it in chat; if the human pastes one into the chat anyway, do not repeat it, call this tool, and suggest they change that database password. Checks that the database can be reached before saving it (one destination per source; saving replaces the earlier one). Returns {saved: true, destination: {host, port, database, user}, replaces (the time of a copy this source already made there, or null)}, {saved: false, code, message} (INVALID_CONNECTION_STRING, UNREACHABLE, SERVER_TOO_OLD, NO_CREATE_PERMISSION, TARGET_NOT_OURS), or {saved: false, reason} (cancelled, expired, abandoned). Then call database_transfer_plan.",
  status: "Reports where the source's data copy goes and how the last copy went ('is my data copied?', 'when was the last copy?'). Read-only. Returns {destination: {host, port, database, user} or null, lastRun: {copied: true, snapshotAt, tableCount, rowCount} or {copied: false, snapshotAt, code, message} or null (since the server started), copyOnDestination: {site, snapshotAt} or null, or {unreachable: message}}.",
  run: "Copies the data planned by database_transfer_plan. A first copy runs immediately without a confirmation card. Replacing an earlier copy permanently deletes its destination schema: this one call shows a Copy/Cancel card and WAITS; there is no second call. On Copy it writes the planned snapshot as one transaction into the source's private area (the source's earlier copy is replaced; other sources' copies and anything else in the database are untouched), checks every table's row count, and returns {copied: true, destination, area, snapshotAt, tableCount, rowCount, tables: [{name, rows}]}. Any failure throws the copy away and keeps the earlier one: {copied: false, cancelled: false, code, message} (TARGET_NOT_OURS, COPY_FAILED, COUNT_MISMATCH, PLAN_NOT_FOUND, PLAN_EXPIRED). Cancel returns {copied: false, cancelled: true}.",
  restorePointUnavailable: "no restore-point mechanism is available for the source; migration is refused with no attestation override",
  restorePointCostAck: "Explicit cost acknowledgment. Required (must be true) only when the source's restore-point cost class is 'expensive'; ignored when 'cheap'. The call is refused with no override at all when cost class is 'unavailable' (no attestation override).",
  databaseHealth: "Reports a summary of the source's database health (connectivity, disk headroom, pending-migration/interrupted-migration state).",
  databaseSchemaState: "Reports the source's schema drift status (in-sync/ahead/diverged/behind) between its persisted schema snapshot and the runtime's current schema.",
  databasePendingMigrations: "Lists migrations pending against the source that have not yet been applied.",
  databaseRestorePoints: "Lists every restore point recorded for the source, newest first, with its trigger, cost class, and capture time.",
  databasePlanMigrate: "Previews what forward-migrating the source's schema would do — cost class and a plan hash — without applying anything.",
  databaseExecuteMigrate: "Moves the source's database forward to the current schema. Shows the user a confirm dialog first and only runs if they " +
        "confirm. A restore point is taken first. Call database_plan_migrate_forward first to see the cost class.",
  databaseCreateRestorePoint: "Mints a new restore point for the source independent of any migration, subject to the source's cost-acknowledgment rule.",
  databaseRestoreGuidance: "Returns a deep-link routing envelope pointing at a host-provided restore destination for restoring the source to an earlier snapshot. Never itself a restore lever.",
  privateAreasTaken: ({ where }) => `every private area the source could use in ${where} already holds other data. Nothing will be overwritten.`,
  noDestination: "no destination database is saved for the source yet",
  uncheckedLinks: "Some copied rows point at records that no longer exist in the source's data. Those links are kept but marked unchecked on the destination; everything was still copied.",
  destinationSaved: ({ database, host }) => `Copies of the source's data will go to ${database} on ${host}.`,
  missingSourceTable: ({ table }) => `the source's database has no '${table}' table`,
  missingSourceColumn: ({ table, column }) => `the source's database has no '${table}.${column}' column`,
};

