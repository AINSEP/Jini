/**
 * @file the Database domain's
 * agent-tool catalog, instantiating naming/callability convention.
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes and the
 * permission/actor-class rule each one carries. Reads are freely agent-callable under
 * `database.read`; the one destructive tool (`database_execute_migrate_forward`) is token-gated,
 * restricted to `confirmer-must-equal-own-delegatedBy`, and asks the human in chat before it runs. Restore is deliberately absent from this
 * catalog — an agent asking to "roll back" only ever reaches a guidance/deep-link tool, never a
 * lever ("Restore is a Recovery tool, not a Database tool").
 *
 * Widened this dispatch (`assistant/tool-registrations.ts`'s wiring pass) with `description` and
 * `inputSchema` — this file previously declared id/sideEffects/authorization only, one layer short
 * of what `tool-registrations.ts` requires to actually publish a tool to the model (mirrors
 * core's `AgentToolDefinition` shape; `inputSchema` stays OPTIONAL, as in
 * `features/content-types/agent-tools.ts`, because 1 of these 9 entries is still declared but
 * deliberately never wired — see `tool-registrations.ts`'s `UNWIRED_DATABASE_TOOL_IDS`:
 * `database_get_restore_guidance` has no envelope-minting function to compose (only the RECEIVING
 * side, `recovery/deep-link.ts`'s `resolveDeepLinkContext`, exists — building one would mean
 * composing a fresh `correlationId`/`restorePointId`/ledger-event lookup on top of a cross-domain
 * envelope format, new backend work well past a wiring pass, not a natural extension of the
 * read-only introspection adapter below).
 *
 * A later dispatch built `features/database/adapter.sqlite.ts` (`DatabaseIntrospectionPort`,
 * composed into `RouteDeps` as `databaseIntrospection` in both `server/deps.ts` and `server/app.ts`)
 * and wired `database_get_health`/`database_get_schema_state`/`content_read.database_pending_migration`
 * against it — see each entry's own comment below and `tool-registrations.ts`'s handlers.
 *
 * How it relates to the project:
 * The server-side tool filter consumes this catalog to decide which tool names an agent
 * session may even see; `authorize`  and the confirmation-token gateway
 * (`core/gated-mutations`) enforce the actual permission/actor-class checks at call time — this
 * module only declares the catalog shape, it performs no I/O and no enforcement itself.
 *
 * Shared catalog types (AgentToolSideEffect, AgentToolActorClassRule and AgentToolDefinition)
 * live once in core. JSON Schema for a tool's input is published to the model through
 * ToolDescriptor.inputSchema; the host wiring refuses to publish an entry without one.
 * The property remains optional on the catalog contract: deliberately unwired entries
 * carry no schema because the model never sees them. Adopting core's wider side-effect
 * vocabulary does not change the independently checked risk of any catalog entry.
 *
 * Architectural role:
 * Database tool contracts use the shared core catalog vocabulary; no driver dependencies.
 * See docs/decisions/DR-001-bounded-operational-timeline.md.
 */

import type { AgentToolDefinition } from "@jini-ai/core";
import { defaultDbMessages, type DbMessages } from "../core/messages.js";

/** No arguments — shared by every parameterless read tool in this catalog. */
const NO_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {},
} as const;

/** `database_query_timeline`'s filter — mirrors `features/database/timeline.ts`'s `getTimeline` filter shape and `routes/admin/database/timeline.ts`'s query-string parsing 1:1. */
const TIMELINE_QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {
    kind: { type: "string", description: "Filter by ledger row kind (e.g. 'core.migration', 'restore.executed'). Omit for all kinds." },
    outcome: { type: "string", description: "Filter by outcome (e.g. 'success', 'failure'). Omit for all outcomes." },
    fromDate: { type: "string", description: "ISO-8601 inclusive lower bound on createdAt. Omit for no lower bound." },
    toDate: { type: "string", description: "ISO-8601 inclusive upper bound on createdAt. Omit for no upper bound." },
    cursor: { type: "string", description: "Opaque pagination cursor from a previous call's own nextCursor. Omit to start from the newest row." },
    limit: { type: "integer", minimum: 1, maximum: 200, description: "Max rows to return. Server-capped at 200 regardless of what is requested; defaults to 50 when omitted." },
  },
} as const;

/**
 * The Database domain's fixed agent-tool contracts (D4), with fresh host-facing prose.
 * @param _optional.messages Host copy; omitted messages use the neutral defaultDbMessages.
 * @returns Nine definitions with unchanged IDs, permissions, risk and input validation.
 *
 * @complexity O(1) — a fixed, statically-defined list.
 * @overallScore 100
 * See docs/decisions/DR-001-bounded-operational-timeline.md.
 */
export function getDatabaseAgentToolCatalog(
  _required: Record<string, never> = {},
  _optional: { messages?: DbMessages } = {}
): AgentToolDefinition[] {
  const messages = _optional.messages ?? defaultDbMessages;
  /** `backup_create_restore_point`'s input. `trigger` is deliberately NOT a model-settable field —
   * every agent-initiated restore point is stamped `trigger:'manual'` server-side regardless of what
   * is asked for, so the ledger's provenance trail cannot be mislabeled (e.g. as `'pre-migration-auto'`,
   * a value that is only ever true when the SYSTEM itself takes the snapshot). */
  const CREATE_RESTORE_POINT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: [],
    properties: {
      costAck: {
        type: "boolean",
        description:
          // See docs/decisions/DR-001-bounded-operational-timeline.md for the invariant behind this refusal; keep external identifiers out of caller-facing messages.
          messages.restorePointCostAck,
      },
    },
  } as const;

  return [
    {
      // WIRED (tool-registrations.ts) against `adapter.sqlite.ts`'s `DatabaseIntrospectionPort.getHealth()`
      // — connectivity + `__drizzle_migrations` readability + drift status, exactly what that
      // method computes. Deliberately does NOT report disk headroom or interrupted-migration state
      // despite this description's own wording — no adapter for either exists yet (disk headroom
      // has no seam anywhere in this codebase; interrupted-migration state lives on
      // `migrationRunsRepo`/`siteStatusRepo`, a separate port this tool does not read), so this
      // stays a minimal, honest subset rather than fabricating fields the description implies.
      name: "database_get_health",
      description: messages.databaseHealth,
      sideEffects: "none",
      authorization: { permission: "database.read" },
      inputSchema: NO_INPUT_SCHEMA,
    },
    {
      // WIRED (tool-registrations.ts) against `adapter.sqlite.ts`'s `DatabaseIntrospectionPort.getSchemaState()`,
      // which reads the two real `SchemaSnapshot`s (`.site-meta.json`, `__drizzle_migrations`) this
      // entry's own comment used to say no adapter supplied, and passes them through `drift.ts`'s
      // `getDriftStatus` unchanged.
      name: "database_get_schema_state",
      description: messages.databaseSchemaState,
      sideEffects: "none",
      authorization: { permission: "database.read" },
      inputSchema: NO_INPUT_SCHEMA,
    },
    {
      // WIRED (tool-registrations.ts) against `adapter.sqlite.ts`'s `DatabaseIntrospectionPort.listPendingMigrations()`
      // — diffs the bundled `db/drizzle/meta/_journal.json` against `__drizzle_migrations`'s
      // applied rows. Note this is the Drizzle-migration-file sense of "pending", distinct from
      // `migration_runs`'s own in-flight-migration-run tracking (`boot/reconcile-interrupted-migration.ts`).
      name: "database_list_pending_migrations",
      description: messages.databasePendingMigrations,
      sideEffects: "none",
      authorization: { permission: "database.read" },
      inputSchema: NO_INPUT_SCHEMA,
    },
    {
      name: "database_query_timeline",
      description:
        "Returns a filtered, cursor-paginated page of the append-only database ledger (migrations, snapshots, restores, interrupted migrations), newest first.",
      sideEffects: "none",
      authorization: { permission: "database.read" },
      inputSchema: TIMELINE_QUERY_SCHEMA,
    },
    {
      name: "database_list_restore_points",
      description: messages.databaseRestorePoints,
      sideEffects: "none",
      authorization: { permission: "database.read" },
      inputSchema: NO_INPUT_SCHEMA,
    },
    {
      // database_plan_migrate_forward is a read : it recomputes and returns a plan,. See docs/decisions/DR-001-bounded-operational-timeline.md.
      // never mutates durable state. Verified directly against `core/gated-mutations/gateway.ts`'s
      // `plan()`, which persists nothing — it authorizes, calls `hooks.computePlan()`, and returns
      // the result. Safe to wire despite migrate-forward's overall high-risk classification: the
      // step that actually redeems a plan into a mutation (`confirm()`) can never be reached by an
      // agent principal at all (the gateway's own actor-class rule reserves `confirm()` for a
      // human/api_key caller — ), and no tool in this catalog exposes `confirm`. See docs/decisions/DR-001-bounded-operational-timeline.md.
      name: "database_plan_migrate_forward",
      description: messages.databasePlanMigrate,
      sideEffects: "none",
      authorization: { permission: "database.read" },
      inputSchema: NO_INPUT_SCHEMA,
    },
    {
      // Asks the human in chat first (2026-09-24): wired with `humanConfirmedToolHandler`, which
      // shows a confirm dialog and, only on the human's own click, confirms as that human and
      // executes as the agent acting for them. A migrate-forward affects every domain at once, so
      // it stays gated; the model never sees or supplies a token.
      name: "database_execute_migrate_forward",
      description:
        messages.databaseExecuteMigrate,
      sideEffects: "mutates-durable-state",
      authorization: { permission: "database.migrate" },
      inputSchema: NO_INPUT_SCHEMA,
      actorClassRule: "confirmer-must-equal-own-delegatedBy",
    },
    {
      // Canonical wiring lives in `buildDatabaseRegistrations` (tool-registrations.ts) — §6. See docs/decisions/DR-001-bounded-operational-timeline.md.
      // names this as "the named tool for the `backup.create` permission" on the Storage/Database
      // domain. `features/recovery/agent-tools.ts` also declares an entry of this same name (a
      // pre-existing cross-domain id collision this dispatch found, not introduced by it); that
      // entry is deliberately left unwired in Recovery's own build function — see its file header.
      name: "backup_create_restore_point",
      description: messages.databaseCreateRestorePoint,
      sideEffects: "mutates-durable-state",
      authorization: { permission: "backup.create" },
      inputSchema: CREATE_RESTORE_POINT_SCHEMA,
    },
    {
      // NOT WIRED (tool-registrations.ts): the rollback hand-off — an agent never gets a restore
      // lever from this domain, only a deep-link routing envelope pointing at the Recovery surface
      //. No envelope-MINTING function exists in this codebase yet (only the receiving. See docs/decisions/DR-001-bounded-operational-timeline.md.
      // side, `recovery/deep-link.ts`'s `resolveDeepLinkContext`, does) and minting one honestly
      // needs a real schema-drift computation this dispatch has no adapter for — see
      // `database_get_schema_state`'s own note. Fabricating a placeholder `drift` value would
      // violate this codebase's own "never fabricate" discipline (`disclosure.ts`'s identical rule).
      name: "database_get_restore_guidance",
      description:
        messages.databaseRestoreGuidance,
      sideEffects: "none",
      authorization: { permission: "database.read" },
    },
  ];
}
