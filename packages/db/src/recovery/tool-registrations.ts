import { AGENT_TOOL_PRINCIPAL_KIND, buildDomainRegistrations, indexCatalogById, isRecord, requireInputRecord, requireNoInput, requireString, ToolInputError, type AgentToolDefinition, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolExecutionContext, type ToolHandler, type ToolMetadataById, type ToolRegistration, type ToolContributor } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { Clock } from "@jini-ai/core/primitives";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { DbOpsPort } from "@jini-ai/core/contracts/site/gated-mutations-ports";
import type { SiteStatusPort } from "@jini-ai/core/contracts/site/recovery-reconcile-interrupted-migration";
import { listRestorePoints, type RestorePointListPort } from "../tools/index.js";
import { resolveDeepLinkContext, type DatabaseContextEnvelope, type DeepLinkRestorePointLookupPort } from "./deep-link.js";
import { computeDisclosure, type DisclosureWatermarkSourcePort } from "./disclosure.js";
import { confirmRestore, executeRestore, planRestore, type PlanRestoreGatewayPort, type ConfirmRestoreGatewayPort, type ExecuteRestoreGatewayPort, type ExecuteRestoreOperationLockPort } from "./recovery-orchestrator.js";
import { resolveDegradedBanner } from "./degraded-banners.js";

const RESTORE_POINT_ENTITY = "restore-point";

export interface RecoveryToolDeps {
  authorize: AuthorizeFn; workspaceId: string; clock: Clock;
  dbOps: Pick<DbOpsPort, "getCapabilities">;
  restorePointsRepo: RestorePointListPort;
  siteStatusRepo: Pick<SiteStatusPort, "get">;
  disclosureWatermarkSource: DisclosureWatermarkSourcePort;
  deepLinkRestorePointLookup: DeepLinkRestorePointLookupPort;
  readonly refuseUnexpectedKeys: (input: Record<string, unknown>, allowed: readonly string[]) => void;
}

type RestorePreparation = { restorePointId: string; plan: { planId: string; planHash: string }; createdAt?: string };

export interface RecoveryToolHost<D extends RecoveryToolDeps> {
  catalog: readonly AgentToolDefinition[]; metadata: ToolMetadataById; catalogModule: string;
  readPermission: string; restorePermission: string; coveredCategories: readonly string[];
  capabilityGuidance: { fullSiteBackup: { discoveryTool: string; planTool: string; pushTool: string; guidance: string }; portableExport: { href: string; guidance: string } };
  authorize(required: { deps: D; ctx: ToolExecutionContext; permission: string; entityType: string }, optional?: Record<string, never>): Promise<void>;
  plan(required: { deps: D; actorId: string; restorePointId: string; principalKind: Parameters<PlanRestoreGatewayPort["plan"]>[0]["principalKind"] }, optional?: Record<string, never>): ReturnType<PlanRestoreGatewayPort["plan"]>;
  confirm(required: { deps: D; actorId: string; restorePointId: string; confirmer: { id: string; kind: "user" }; planId: string; planHash: string; signal: AbortSignal }, optional?: Record<string, never>): ReturnType<ConfirmRestoreGatewayPort["confirm"]>;
  execute(required: { deps: D; actorId: string; restorePointId: string; confirmationToken: string; signal: AbortSignal }, optional?: Record<string, never>): ReturnType<ExecuteRestoreGatewayPort["execute"]>;
  operationLock: ExecuteRestoreOperationLockPort;
  isOperationInFlight(required: { siteId: string }, optional?: Record<string, never>): boolean;
  describe(required: RestorePreparation): { toolId: string; errorCode: string; title: string; details: readonly { label: string; value: string }[]; warning: string; danger: boolean; confirmLabel: string };
  confirmedRestore(required: {
    surfaces: AssistantSurfaceDeps;
    prepare: (required: { ctx: ToolExecutionContext }) => Promise<RestorePreparation>;
    describe: RecoveryToolHost<D>["describe"];
    run: (required: { ctx: ToolExecutionContext; prepared: RestorePreparation; confirmer: { id: string; kind: "user" } }) => Promise<unknown>;
  }, optional?: Record<string, never>): ToolHandler;
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration. Neither excluded tool appears here at all, which is itself the
 * strongest of the guards: an unclassified id cannot be wired.
 */
export const recoveryDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> listRestorePoints (@jini-ai/db/tools, the same repo Database's own list
  //    tool reads): one read.
  ["backup_list_restore_points", "none"],
  // -> dbOps.getCapabilities(): pure, side-effect-free per its own doc comment.
  ["backup_get_capabilities", "none"],
  // -> planRestore (recovery-orchestrator.ts) + gateway.ts's plan() + computeDisclosure(): three
  //    reads composed together, nothing persisted.
  ["backup_plan_restore", "none"],
  // -> dbOps.getCapabilities() + siteStatusRepo.get() + isOperationInFlight() (a lock PEEK, not an
  //    acquire) + resolveDegradedBanner() (pure): all reads.
  ["recovery_get_status", "none"],
  // -> resolveDeepLinkContext (deep-link.ts): one DeepLinkRestorePointLookupPort read; never
  //    mutates the input envelope (see that function's own doc comment).
  ["recovery_resolve_deep_link", "none"],
  // -> gateway confirm() (as the human, after their click) + execute() via buildRestoreHooks,
  //    inside executeRestore's operation lock: swaps the site's data for the restore point's.
  ["backup_execute_restore", "mutates-durable-state"],
]);

const RESTORE_TOOL_ID = "backup_execute_restore";

const UNWIRED_RECOVERY_TOOL_IDS: ReadonlySet<string> = new Set([
  // Pre-existing (SPEC-019) catalog entry, deliberately left unwired HERE: this id collides with
  // `features/database/agent-tools.ts`'s own `backup_create_restore_point`, which
  // `buildDatabaseRegistrations` already wires as the canonical tool (ADR-041 §6 names the
  // Database/Storage domain as this permission's "named tool"). Recovery's OWN local
  // `createRestorePoint` (`recovery/restore-points.ts`) never calls `DbOpsPort.captureRestorePoint()`
  // — wiring it here too would silently mint a SECOND, artifact-less restore point under the same
  // tool id, reintroducing the exact "artifactRef silently dropped" defect
  // `database/restore-points.ts`'s own file header records as already fixed. One tool id, one
  // handler, backed by the real snapshot path.
  "backup_create_restore_point",
]);

/** One field's "must be typeof number" check for {@link requireDeepLinkEnvelope} — same rejection
 *  style as the kit's own `requireNumber`, just scoped to a nested envelope field path. */
function requireEnvelopeNumber({ value, fieldPath }: { value: unknown; fieldPath: string }, _optional = {}): number {
  if (typeof value !== "number") throw new ToolInputError({ message: `'${fieldPath}' (number) is required` });
  return value;
}

/** One field's "must be typeof string" check for {@link requireDeepLinkEnvelope}. */
function requireEnvelopeString({ value, fieldPath }: { value: unknown; fieldPath: string }, _optional = {}): string {
  if (typeof value !== "string") throw new ToolInputError({ message: `'${fieldPath}' (string) is required` });
  return value;
}

/** One field's "must be a string, or explicitly null" check — `ledgerEventId`/`restorePointId`
 *  are the only two nullable fields on the envelope. */
function requireEnvelopeStringOrNull({ value, fieldPath }: { value: unknown; fieldPath: string }, _optional = {}): string | null {
  if (value !== null && typeof value !== "string") throw new ToolInputError({ message: `'${fieldPath}' must be a string or null` });
  return value;
}

/**
 * Validates a raw `envelope` value against `recovery_resolve_deep_link`'s published schema and
 * returns it narrowed to `DatabaseContextEnvelope`.
 *
 * Hand-written rather than delegating to `Jini packages/user-management/src/server/agent-tool-input.ts`'s generic schema
 * interpreter, because this is the only nested-object tool input in the whole wiring layer and that
 * interpreter is flat-only — it cannot express a nested `envelope` object at all.
 *
 * @throws {ToolInputError} Naming the first missing/mistyped field, matching the kit's
 * `requireString`/`requireNumber` rejection style.
 * @complexity O(1) — a fixed number of field checks.
 * @overallScore 100
 */
function requireDeepLinkEnvelope({ raw }: { raw: unknown }, _optional = {}): DatabaseContextEnvelope {
  const candidate = { value: raw };
  if (!isRecord(candidate)) throw new ToolInputError({ message: "'envelope' (object) is required" });
  const value = candidate.value;

  return {
    v: requireEnvelopeNumber({ value: value.v, fieldPath: "envelope.v" }),
    correlationId: requireEnvelopeString({ value: value.correlationId, fieldPath: "envelope.correlationId" }),
    siteId: requireEnvelopeString({ value: value.siteId, fieldPath: "envelope.siteId" }),
    ledgerEventId: requireEnvelopeStringOrNull({ value: value.ledgerEventId, fieldPath: "envelope.ledgerEventId" }),
    restorePointId: requireEnvelopeStringOrNull({ value: value.restorePointId, fieldPath: "envelope.restorePointId" }),
    drift: requireEnvelopeString({ value: value.drift, fieldPath: "envelope.drift" }),
    intent: requireEnvelopeString({ value: value.intent, fieldPath: "envelope.intent" }),
    issuedAt: requireEnvelopeString({ value: value.issuedAt, fieldPath: "envelope.issuedAt" }),
  };
}
function createRecoveryPlanner<D extends RecoveryToolDeps>(routeDeps: D, host: RecoveryToolHost<D>) {
  // Plans a restore as the agent and folds in the discarded-write-window disclosure — shared by
  // `backup_plan_restore` and the confirm dialog of `backup_execute_restore`.
  const planRestoreWithDisclosure = async ({ actorId, restorePointId }: { actorId: string; restorePointId: string }, _optional = {}) => {
    const result = await planRestore({
      deps: {
        dbOps: {
          getCapabilities: async () => {
            const capabilities = await routeDeps.dbOps.getCapabilities();
            return { costClass: capabilities.restorePoint.costClass, restorePointKind: capabilities.restorePoint.kind };
          },
        },
        gateway: {
          plan: input => host.plan({ deps: routeDeps, actorId, restorePointId: input.restorePointId, principalKind: input.principalKind }),
        },
      },
      input: { principalId: actorId, principalKind: AGENT_TOOL_PRINCIPAL_KIND, restorePointId },
    });

    if (!result.ok) throw new Error(result.error.message ?? result.error.code);

    const disclosure = await computeDisclosure({
      deps: { watermarkSource: routeDeps.disclosureWatermarkSource, coveredCategories: host.coveredCategories },
      input: { restorePointId },
    });
    return { plan: result.value, disclosure };
  };
  return { planRestoreWithDisclosure };
}

async function readRecoveryStatus<D extends RecoveryToolDeps>(routeDeps: D, ctx: Parameters<ToolHandler>[0], host: RecoveryToolHost<D>) {
      requireNoInput({ input: ctx.input });
      await host.authorize({ deps: routeDeps, ctx, permission: host.readPermission, entityType: RESTORE_POINT_ENTITY });

      const capabilities = await routeDeps.dbOps.getCapabilities();
      const siteStatus = await routeDeps.siteStatusRepo.get(routeDeps.workspaceId);
      const banner = resolveDegradedBanner({
        capabilities: {
          costClass: capabilities.restorePoint.costClass,
          operationInFlight: host.isOperationInFlight({ siteId: routeDeps.workspaceId }, {}),
          pendingMigration: siteStatus === "PENDING_MIGRATION",
          migrationInterrupted: siteStatus === "BLOCKED_PENDING_RECOVERY",
          // Matches `@jini-ai/cms/admin-http/routes/recovery/status`'s own honest stub — no per-category
          // write-count tracker exists anywhere in this codebase yet (see `disclosure.ts`'s doc).
          watermarkBaselineAvailable: false,
        },
      });

      return { costClass: capabilities.restorePoint.costClass, banner };
    }



    
async function resolveRecoveryDeepLink<D extends RecoveryToolDeps>(routeDeps: D, ctx: Parameters<ToolHandler>[0], host: RecoveryToolHost<D>) {
      const candidate = { value: ctx.input };
      if (!isRecord(candidate)) throw new ToolInputError({ message: "'envelope' (object) is required" });
      const envelope = requireDeepLinkEnvelope({ raw: candidate.value.envelope });

      await host.authorize({ deps: routeDeps, ctx, permission: host.readPermission, entityType: RESTORE_POINT_ENTITY });

      return resolveDeepLinkContext({
        deps: { lookup: routeDeps.deepLinkRestorePointLookup },
        input: { principalId: ctx.principal.id, principalKind: AGENT_TOOL_PRINCIPAL_KIND, envelope },
      });
    }
function createRecoveryRestoreRun<D extends RecoveryToolDeps>(routeDeps: D, host: RecoveryToolHost<D>): Parameters<RecoveryToolHost<D>["confirmedRestore"]>[0]["run"] {
  return async ({ ctx, prepared: { restorePointId, plan }, confirmer }) => {
        const confirmed = await confirmRestore({
          deps: {
            gateway: { confirm: params => host.confirm({ deps: routeDeps, actorId: ctx.principal.id, restorePointId, confirmer, planId: params.planId, planHash: params.planHash, signal: ctx.signal }) },
          },
          input: { principalId: confirmer.id, principalKind: confirmer.kind, planId: plan.planId, planHash: plan.planHash, disclosureAcknowledged: true },
        });
        if (!confirmed.ok) throw new Error(confirmed.error.message ?? confirmed.error.code);
        const candidate = { value: confirmed.value };
        if (!isRecord(candidate) || typeof candidate.value.confirmationToken !== "string") throw new Error("Restore confirmation has no confirmation token");
        const { confirmationToken } = candidate.value;

        const executed = await executeRestore({
          deps: {
            gateway: {
              execute: params => host.execute({ deps: routeDeps, actorId: ctx.principal.id, restorePointId, confirmationToken: params.confirmationToken, signal: ctx.signal }),
            },
            operationLock: host.operationLock,
            clock: routeDeps.clock,
          },
          input: {
            principalId: ctx.principal.id,
            principalKind: "agent",
            confirmationToken,
            siteId: routeDeps.workspaceId,
            delegatedByPrincipalId: confirmer.id,
          },
        });
        if (!executed.ok) throw new Error(executed.error.message ?? executed.error.code);
        return { restored: true, ...executed.value };
      };
}




    // Plans as the agent, asks the human, then confirms as the human and executes as the agent
    // inside the same operation lock the admin execute route uses. No restore point is taken
    // first, so the dialog says the current data is replaced and it can't be undone. The human's
    // confirm click is the disclosure acknowledgment (CIC U-002).
    
function createRecoveryRestoreHandler<D extends RecoveryToolDeps>(routeDeps: D, surfaces: AssistantSurfaceDeps, host: RecoveryToolHost<D>, { planRestoreWithDisclosure }: ReturnType<typeof createRecoveryPlanner<D>>): ToolHandler {
  return host.confirmedRestore({ surfaces,
      prepare: async ({ ctx }) => {
        const input = requireInputRecord({ input: ctx.input });
        routeDeps.refuseUnexpectedKeys(input, ["restorePointId"]);
        const restorePointId = requireString({ input: input, key: "restorePointId" });
        await host.authorize({ deps: routeDeps, ctx, permission: host.restorePermission, entityType: RESTORE_POINT_ENTITY });
        const { plan } = await planRestoreWithDisclosure({ actorId: ctx.principal.id, restorePointId });
        const { items } = await listRestorePoints({ repo: routeDeps.restorePointsRepo });
        const createdAt = items.find((item) => item.id === restorePointId)?.createdAt;
        const candidate = { value: plan };
        if (!isRecord(candidate) || typeof candidate.value.planId !== "string" || typeof candidate.value.planHash !== "string") throw new Error("Restore plan has no plan id or hash");
        return { restorePointId, plan: { planId: candidate.value.planId, planHash: candidate.value.planHash }, ...(createdAt === undefined ? {} : { createdAt }) };
      },
      describe: host.describe,
      run: createRecoveryRestoreRun(routeDeps, host),
    });
}


function createRecoveryListHandler<D extends RecoveryToolDeps>(routeDeps: D, host: RecoveryToolHost<D>): ToolHandler {
  return async ctx => {
      requireNoInput({ input: ctx.input });
      await host.authorize({ deps: routeDeps, ctx, permission: host.readPermission, entityType: RESTORE_POINT_ENTITY });
      // Same repo/function Database's own `database_list_restore_points` reads — one persisted
      // list, two gated views (ADR-045 §1, "Database and Recovery are sibling faces").
      return listRestorePoints({ repo: routeDeps.restorePointsRepo });
  };
}

function createRecoveryCapabilitiesHandler<D extends RecoveryToolDeps>(routeDeps: D, host: RecoveryToolHost<D>): ToolHandler {
  return async ctx => {
      requireNoInput({ input: ctx.input });
      await host.authorize({ deps: routeDeps, ctx, permission: host.readPermission, entityType: RESTORE_POINT_ENTITY });
      const capabilities = await routeDeps.dbOps.getCapabilities();
      return { costClass: capabilities.restorePoint.costClass, kind: capabilities.restorePoint.kind,
        ...host.capabilityGuidance,
      };
  };
}

export function buildRecoveryRegistrations<D extends RecoveryToolDeps>({ deps: routeDeps, surfaces, host }: {
  deps: D; surfaces: AssistantSurfaceDeps; host: RecoveryToolHost<D>;
}, _optional: Record<string, never> = {}): ToolRegistration[] {
  const planner = createRecoveryPlanner(routeDeps, host);
  const { planRestoreWithDisclosure } = planner;
  const handlers: Record<string, ToolHandler> = {
    backup_list_restore_points: createRecoveryListHandler(routeDeps, host),
    backup_get_capabilities: createRecoveryCapabilitiesHandler(routeDeps, host),
    backup_plan_restore: async (ctx) => {
      const restorePointId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "restorePointId" });

      // Defensive, explicit check ahead of `planRestore()`: that function's own cost-class
      // short-circuit (COST_CLASS_UNAVAILABLE) returns BEFORE the gateway's internal authorize()
      // ever runs — a pre-existing gap this wiring found in the real HTTP route too (it calls
      // `planRestore` with no authorize() of its own either). This tool stays strictly more
      // conservative than that route by never skipping the check, rather than reproducing the gap.
      await host.authorize({ deps: routeDeps, ctx, permission: host.readPermission, entityType: RESTORE_POINT_ENTITY });

      // An unknown id is a caller mistake, not a planning question — reject it here rather than
      // letting it reach `planRestore()`/the gateway, which have no reason to name a nonexistent
      // restore point in a way that points the caller back to the list tool.
      const points = await routeDeps.restorePointsRepo.list();
      if (!points.some((point) => point.id === restorePointId)) {
        throw new ToolInputError({ message: `restore point '${restorePointId}' was not found — call backup_list_restore_points for valid ids` });
      }

      // Folds in the discarded-write-window disclosure, matching this tool's own catalog
      // description ("including the discarded-write-window disclosure") — the human admin UI reads
      // this from a separate `/recovery/disclosure` request; a tool call composes both in one turn.
      return planRestoreWithDisclosure({ actorId: ctx.principal.id, restorePointId });
    },
    recovery_get_status: ctx => readRecoveryStatus(routeDeps, ctx, host),
    recovery_resolve_deep_link: ctx => resolveRecoveryDeepLink(routeDeps, ctx, host),
    [RESTORE_TOOL_ID]: createRecoveryRestoreHandler(routeDeps, surfaces, host, planner),
  };
  return buildDomainRegistrations({ metadata: host.metadata, domain: "recovery", catalogModule: host.catalogModule,
    catalog: indexCatalogById({ catalog: host.catalog }), handlers, derivedRisk: recoveryDerivedRisk }, { unwiredToolIds: UNWIRED_RECOVERY_TOOL_IDS });
}

export function contributeRecoveryTools<D extends RecoveryToolDeps>({ host }: { host: RecoveryToolHost<D> }, _optional: Record<string, never> = {}): ToolContributor<D, AssistantSurfaceDeps> {
  return { domain: "recovery", build: (deps, surfaces) => buildRecoveryRegistrations({ deps, surfaces, host }), risk: recoveryDerivedRisk };
}
