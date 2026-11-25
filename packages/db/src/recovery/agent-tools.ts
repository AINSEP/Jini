import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
/**
 * @file Recovery's agent-tool catalog: no agent may hold a direct restore lever.
 *
 * Purpose:
 * A static catalog. No `backup_confirm_restore`-equivalent tool ever exists — the human
 * confirmation step is exactly the one act the gated-mutation gateway reserves for `kind='user'`/api_key
 * principals; no description in this catalog may even claim to perform that step, so a future
 * addition can't quietly reintroduce the capability by wording alone.
 *
 * Catalog notes:
 *   - `inputSchema` is part of `AgentToolDefinition` (optional, mirroring the other domain catalogs).
 *   - `backup_create_restore_point` is declared here but deliberately left UNWIRED by the host's
 *     recovery registrations. Short version: this tool id collides with the Database catalog's own
 *     `backup_create_restore_point` (the Database domain is that permission's "named tool"), and a
 *     recovery-local restore-point mint that never calls `DbOpsPort.captureRestorePoint()` would
 *     silently mint restore-point rows with no real snapshot artifact, reintroducing the
 *     "artifactRef silently dropped" defect the Database restore-points module records as fixed.
 *   - `recovery_get_status` and `recovery_resolve_deep_link` are read-only, zero-side-effect
 *     admin-UI sections (the recovery status bar and the deep-link re-resolution), added under the
 *     same "read-only admin-UI section is safe to wrap directly" bar the rest of this catalog uses.
 *
 * How it relates to the project:
 * The server-side tool filter consumes this catalog to decide which tool names an agent
 * session may see at all; `authorize()` and the confirmation-token gateway enforce the actual
 * checks at call time — this module declares shape only, no I/O.
 *
 * The host supplies the wording that names its own tools and screens (the repository-backup
 * workflow, its export path, and the read tools that return restore point ids); the engine never
 * hard-codes a host tool name or product path.
 */

const BACKUP_READ_PERMISSION = "backup.read" as const;

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "mints-token";

export type { AgentToolActorClassRule } from "@jini-ai/core";

/**
 * JSON Schema for this tool's `input`, published via `ToolDescriptor.inputSchema` (the host's
 * registration pass refuses to wire any tool lacking one). Optional, matching the other catalogs.
 */
export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

/** Host wording bound into the recovery catalog's model-facing guidance. */
export interface RecoveryAgentToolCatalogArgs {
  /** Sentences inserted into `backup_get_capabilities`: the host's repository-backup tools and its portable export path. */
  readonly backupWorkflowGuidance: string;
  /** The host read tool(s) that return a restore point id, named in the `restorePointId` field description. */
  readonly restorePointIdSource: string;
}

/** No arguments — shared by every parameterless read tool in this catalog. */
const NO_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [],
  properties: {},
} as const;

/** `recovery_resolve_deep_link`'s input — mirrors `./deep-link`'s
 * `DatabaseContextEnvelope` shape field-for-field. Every id inside is untrusted and re-looked-up
 * server-side on arrival; nothing in this schema grants authority, it only carries display
 * continuity. */
const DEEP_LINK_ENVELOPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["envelope"],
  properties: {
    envelope: {
      type: "object",
      additionalProperties: false,
      required: ["v", "correlationId", "siteId", "ledgerEventId", "restorePointId", "drift", "intent", "issuedAt"],
      properties: {
        v: { type: "integer", description: "Envelope schema version." },
        correlationId: { type: "string", description: "The incident/correlation id minted when this deep-link's chain began." },
        siteId: { type: "string", description: "The site/workspace id the envelope was minted for. Re-verified server-side, never trusted as-is." },
        ledgerEventId: { type: ["string", "null"], description: "The database ledger row id this envelope points at, or null." },
        restorePointId: {
          type: ["string", "null"],
          description: "The restore point id this envelope points at, or null. Re-looked-up server-side; a stale or forged id resolves to found:false rather than being trusted.",
        },
        drift: { type: "string", description: "The drift status carried for display continuity only; never trusted as authoritative." },
        intent: { type: "string", description: "The carried intent (e.g. 'view'), for display continuity only." },
        issuedAt: { type: "string", description: "ISO-8601 timestamp the envelope was minted at." },
      },
    },
  },
} as const;

/** `backup_plan_restore`'s and `backup_execute_restore`'s shared input, naming the host tool that returns ids. */
function planRestoreInputSchema({ restorePointIdSource }: { restorePointIdSource: string }) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["restorePointId"],
    properties: {
      restorePointId: { type: "string", minLength: 1, description: `A restore point id, as returned by ${restorePointIdSource}.` },
    },
  } as const;
}

/** The restore flow: list, capabilities, plan, and the one destructive execute tool. */
function restoreFlowTools({ backupWorkflowGuidance, planRestoreSchema }: {
  backupWorkflowGuidance: string;
  planRestoreSchema: ReturnType<typeof planRestoreInputSchema>;
}): AgentToolDefinition[] {
  return [
    {
      name: "backup_list_restore_points",
      description: "Lists restore points for the current site, newest first, with their capture trigger and cost class.",
      sideEffects: "none",
      authorization: { permission: BACKUP_READ_PERMISSION },
      inputSchema: NO_INPUT_SCHEMA,
    },
    {
      name: "backup_get_capabilities",
      description: `Reports this site's restore-point cost class and mechanism kind. ${backupWorkflowGuidance} Rendered static output commits are a separate publishing workflow.`,
      sideEffects: "none",
      authorization: { permission: BACKUP_READ_PERMISSION },
      inputSchema: NO_INPUT_SCHEMA,
    },
    {
      name: "backup_plan_restore",
      description: "Previews what restoring to a given restore point would change, including the discarded-write-window disclosure.",
      sideEffects: "none",
      authorization: { permission: BACKUP_READ_PERMISSION },
      inputSchema: planRestoreSchema,
    },
    {
      // Asks the human in chat first (2026-09-24): wired with `humanConfirmedToolHandler`, which
      // shows a confirm dialog and, only on the human's own click, confirms as that human and
      // executes as the agent acting for them. The model never sees or supplies a token.
      name: "backup_execute_restore",
      description:
        "Replaces this site's current data with a restore point. Shows the user a confirm dialog first and only runs if they confirm. " +
        "No restore point is taken first, so it can't be undone. Call backup_plan_restore first to see what would be lost.",
      sideEffects: "mutates-durable-state",
      authorization: { permission: "backup.restore" },
      actorClassRule: "confirmer-must-equal-own-delegatedBy",
      inputSchema: planRestoreSchema,
    },
  ];
}

/** The restore-point mint plus the two read-only admin-UI sections (status bar, deep-link resolution). */
function restoreAdminTools({ citation }: { citation: string }): AgentToolDefinition[] {
  return [
    {
      // Catalog entry deliberately left UNWIRED — see this file's header and the host's recovery
      // registrations for the full reasoning: an id collision with the Database catalog's own
      // `backup_create_restore_point`, whose wiring is the canonical one.
      name: "backup_create_restore_point",
      description: "Mints a new restore point independent of any migration, subject to the site's cost-acknowledgment rule.",
      sideEffects: "mutates-durable-state",
      authorization: { permission: "backup.create" },
    },
    {
      // Read-only "Recovery status bar + degraded banner" admin-UI section.
      name: "recovery_get_status",
      description:
        "Reports this site's current restore-point cost class plus the single highest-precedence degraded-state banner (migration interrupted, pending migration, an operation already in flight, cost class unavailable, or watermark baseline unavailable), if any.",
      sideEffects: "none",
      authorization: { permission: BACKUP_READ_PERMISSION },
      inputSchema: NO_INPUT_SCHEMA,
    },
    {
      // Read-only re-resolution of a deep-link envelope. Never trusts the envelope's own carried
      // values; every id is re-looked-up server-side.
      name: "recovery_resolve_deep_link",
      description:
        `Re-resolves a Database-Timeline deep-link envelope server-side${citation}: looks up the envelope's restorePointId against the current restore-points list rather than trusting the envelope's own carried value. A stale or forged id resolves to found:false.`,
      sideEffects: "none",
      authorization: { permission: BACKUP_READ_PERMISSION },
      inputSchema: DEEP_LINK_ENVELOPE_SCHEMA,
    },
  ];
}

/**
 * Recovery's fixed agent-tool catalog: reads are freely agent-callable under `backup.read`;
 * `backup_execute_restore` is the one destructive, token-gated tool
 * (`confirmer-must-equal-own-delegatedBy`); `backup_create_restore_point` is an ordinary
 * mutation, never wrapped in a plan/confirm/execute sequence — but see this file's header for why
 * it is nonetheless left unwired from the recovery registrations.
 *
 * @param args.backupWorkflowGuidance - the host's repository-backup / export sentences.
 * @param args.restorePointIdSource - the host read tool(s) that return restore point ids.
 * @param _optional.resolveDeepLinkCitation - a host specification id cited in the deep-link tool description.
 * @returns Seven definitions; ids, permissions, side effects and schemas are fixed by the engine.
 */
export function createRecoveryAgentToolCatalog(
  { backupWorkflowGuidance, restorePointIdSource }: RecoveryAgentToolCatalogArgs,
  _optional: { resolveDeepLinkCitation?: string } = {}
): AgentToolDefinition[] {
  // A host that cites its own specification ids passes one; the engine carries none.
  const citation = _optional.resolveDeepLinkCitation === undefined ? "" : ` (${_optional.resolveDeepLinkCitation})`;
  const planRestoreSchema = planRestoreInputSchema({ restorePointIdSource });
  return [...restoreFlowTools({ backupWorkflowGuidance, planRestoreSchema }), ...restoreAdminTools({ citation })];
}
