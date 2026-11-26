import { toolMetadata } from '@jini-ai/core/tool-metadata/database';
import type { Clock } from "@jini-ai/core/primitives";
/**
 * @file Database's half of ADR-049 Decision 4 (SPEC-017/ADR-041): maps the wireable subset of
 * `agent-tools.ts`'s nine catalog entries onto the timeline/restore-point/introspection reads and
 * the one clearly-reversible write, as `ToolRegistration`s.
 *
 * Risk framing: this domain is meaningfully higher-risk than Forms/Identity/content-types — a
 * migrate-forward can rewrite schema and data across every other domain at once, sometimes
 * irreversibly — so the surface is deliberately reads plus one write rather than full parity with
 * the admin UI. One of the nine entries is still declared unwired, with its reason recorded on
 * {@link UNWIRED_DATABASE_TOOL_IDS}. `database_execute_migrate_forward` asks the human
 * in chat first and only runs on their click — see `contracts/core/human-confirm.ts`'s
 * `humanConfirmedToolHandler`.
 *
 * Authorization shape: none of the underlying read functions (`getTimeline`, `listRestorePoints`,
 * `createRestorePoint`, `DatabaseIntrospectionPort`'s three methods) call `authorize()` internally
 * — the admin routes gate inline (or, for the introspection trio, there is no admin route to
 * mirror yet, so this file's own inline check is the only gate) — so those handlers call the kit's
 * `requireToolPermission` themselves. The one exception is `database_plan_migrate_forward`,
 * documented at its own handler.
 */
import { createDatabaseReadTools, type InputReaders, type RestorePointListPort, type RestorePointSavePort } from "@jini-ai/db/tools";
import { AGENT_TOOL_PRINCIPAL_KIND, buildDomainRegistrations, indexCatalogById, isRecord, optionalBoolean, optionalNumber, optionalString, requireInputRecord, requireString, requireNoInput, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { requireToolPermission, type ToolPermissionAuthorizationPort, type ToolExecutionContext } from "@jini-ai/core";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";
import { type AuthorizeFn, type MutationActor } from "@jini-ai/core/contracts/events";
// `ToolInputError` specifically — the marker `@jini-ai/daemon`'s `ToolExecutor` reads to tag a
// rejection `errorKind: 'validation'` rather than the redacted-500 `'internal'` bucket a bare
// `Error` gets. Same reasoning as `features/post/tool-registrations.ts`'s identical import.
import { ToolInputError } from "@jini-ai/core";
import type { confirm as gatewayConfirm, execute as gatewayExecute, plan as gatewayPlan, GatewayDeps } from "@jini-ai/core/gated-mutations";
import type { GatedMutationHooks } from "@jini-ai/core/gated-mutations";
import type { DbOpsPort } from "@jini-ai/core/contracts/site/gated-mutations-ports";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { ToolContributor } from "@jini-ai/core";
import type { buildMigrateForwardHooks, BuildMigrateForwardHooksInput } from "../recovery/migrate-forward-hooks.js";
import type { LedgerAppendPort } from "@jini-ai/db/recovery/migrate-forward-hooks";
import type { DbMessages } from "../tools/index.js";
import { executeMigrateForward, type OperationLockPort } from "../recovery/migrate-forward-execute.js";
import type { DatabaseIntrospectionPort } from "@jini-ai/core/contracts/site/database-introspection";
import type { LedgerReadPort } from "@jini-ai/db/tools";


/**
 * The exact slice of the route-deps bag Database's tool handlers read. Declared structurally
 * (rather than importing `server/routes/types`'s `RouteDeps`) so this module carries no back-edge
 * into the composition root for the `RouteDeps` god type. This domain's `buildMigrateForwardHooks`/
 * `LedgerAppendPort` now live in this module's own `gated-hooks.ts` (moved out of
 * `server/gated-mutations-composition.ts`, closing the back-edge into `server/` that file's import
 * previously required), so `server/routes/*` satisfies this interface structurally by passing its
 * existing `RouteDeps` object; nothing there changes.
 */
/** A core gateway call's input with the host's own deps type in place of core's. */
type HostDeps<T, G> = Omit<T, 'deps'> & { deps: G };

/** `G` is the host's own gateway deps: Jini only hands them back to the host's gateway functions. */
export interface DatabaseToolDeps<G = GatewayDeps> {
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: Clock;
  idGen: { newId(): string };
  databaseLedgerRepo: LedgerReadPort & LedgerAppendPort;
  restorePointsRepo: RestorePointListPort & RestorePointSavePort;
  databaseIntrospection: DatabaseIntrospectionPort;
  dbOps: DbOpsPort;
  gatedMutations: { gatewayDeps: G };
  catalog: readonly import('@jini-ai/core').AgentToolDefinition[]; messages: DbMessages;
  surfaces: AssistantSurfaceDeps; migrateForwardDialog: Omit<HumanConfirmSpec, 'toolId'>;
  gatewayPlan: (required: HostDeps<Parameters<typeof gatewayPlan>[0], G>, optional?: Record<string, never>) => ReturnType<typeof gatewayPlan>;
  gatewayConfirm: (required: HostDeps<Parameters<typeof gatewayConfirm>[0], G>, optional?: Record<string, never>) => ReturnType<typeof gatewayConfirm>;
  gatewayExecute: <TResult>(required: HostDeps<Parameters<typeof gatewayExecute<TResult>>[0], G>, optional?: Record<string, never>) => ReturnType<typeof gatewayExecute<TResult>>;
  buildMigrateForwardHooks(input: Omit<BuildMigrateForwardHooksInput, 'planHashOf' | 'resolveActorClassIdentity'>): ReturnType<typeof buildMigrateForwardHooks>;
  operationLock: OperationLockPort; mutationActor: DatabaseMutationActorBinding;
  adaptLegacyAuthorize(input: { authorize: AuthorizeFn }): ToolPermissionAuthorizationPort;
  refuseUnexpectedKeys(input: Record<string, unknown>, allowed: readonly string[]): void;
  humanConfirmedToolHandler(surfaces: AssistantSurfaceDeps, steps: {
    flag: string;
    prepare(input: { ctx: ToolExecutionContext }): Promise<{ hooks: GatedMutationHooks<unknown, { migrated: true }>; plan: Awaited<ReturnType<typeof gatewayPlan>>; costClass: 'cheap' | 'expensive' | 'unavailable' }>;
    dialog(): HumanConfirmSpec;
    run(input: { ctx: ToolExecutionContext; prepared: Awaited<ReturnType<Parameters<DatabaseToolDeps<G>['humanConfirmedToolHandler']>[1]['prepare']>>; confirmer: { id: string; kind: 'user' } }): Promise<unknown>;
  }): ToolHandler;
}

type DatabaseMutationActorBinding = (required: { readonly principalId: string }, optional?: Record<string, never>) => MutationActor;

/**
 * Widened this dispatch (ADR-041 §3, closing `agent-tools.ts`'s own disclosed gap) with the three
 * `DatabaseIntrospectionPort`-backed reads below — `database_get_health`, `database_get_schema_state`,
 * `database_list_pending_migrations`. All three are pure passthroughs to `routeDeps.databaseIntrospection`
 * (`features/database/adapter.sqlite.ts`); none of that port's methods call `authorize()`
 * internally, so each handler runs the identical inline `requireToolPermission` check every other
 * read handler in this file already runs.
 */


/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const databaseDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> getTimeline (timeline.ts): one LedgerReadPort.query() read.
  ["database_query_timeline", "none"],
  // -> listRestorePoints (restore-points.ts): one RestorePointListPort.list() read.
  ["database_list_restore_points", "none"],
  // -> gateway.ts's plan() via buildMigrateForwardHooks: authorizes, then recomputes a plan and
  //    returns it — verified directly against plan()'s own body, which persists nothing.
  ["database_plan_migrate_forward", "none"],
  // -> createRestorePoint (restore-points.ts) + dbOps.captureRestorePoint() +
  //    restorePointsRepo.save(): a real file snapshot plus a persisted row. The canonical wiring for
  //    this tool id — see `features/recovery/tool-registrations.ts` for why Recovery's own catalog
  //    entry of the same name is deliberately left unwired instead of double-registered.
  ["backup_create_restore_point", "mutates-durable-state"],
  // -> routeDeps.databaseIntrospection.getHealth() (adapter.sqlite.ts): read-only queries against
  //    an already-open connection plus one `.site-meta.json` file read. No write of any kind.
  ["database_get_health", "none"],
  // -> routeDeps.databaseIntrospection.getSchemaState(): same read-only shape as getHealth() above.
  ["database_get_schema_state", "none"],
  // -> routeDeps.databaseIntrospection.listPendingMigrations(): one bundled-journal file read plus
  //    one bounded `__drizzle_migrations` query. No write of any kind.
  ["database_list_pending_migrations", "none"],
  // -> gateway confirm() (as the human, after their click) + execute() via buildMigrateForwardHooks,
  //    inside executeMigrateForward's operation lock: dbOps.captureRestorePoint() +
  //    restorePointsRepo.save() + databaseLedgerRepo.append().
  ["database_execute_migrate_forward", "mutates-durable-state"],
]);

const MIGRATE_TOOL_ID = "database_execute_migrate_forward";

/** Database catalog entries this pass does not wire, and why — see `features/database/agent-tools.ts`'s own per-entry comments for the full reasoning. */
const UNWIRED_DATABASE_TOOL_IDS = new Set([
  // No envelope-minting function exists (only the receiving side, `resolveDeepLinkContext`, does),
  // and minting one honestly needs a schema-drift computation this pass has no adapter for.
  "database_get_restore_guidance",
]);


    async function planDatabaseMigrateForward<G>(routeDeps: DatabaseToolDeps<G>, ctx: Parameters<ToolHandler>[0], mutationActor: DatabaseMutationActorBinding) {
      const { buildMigrateForwardHooks, gatewayPlan } = routeDeps;
      requireNoInput({ input: ctx.input });
      // No explicit pre-check here: `gateway.ts`'s plan() calls authorize() unconditionally,
      // BEFORE hooks.computePlan() ever runs — verified directly against its body (see
      // `databaseDerivedRisk`'s comment for this tool). Adding a second check here would be the
      // duplicate evaluator ADR-021 §2 forbids.
      const hooks = buildMigrateForwardHooks({
        workspaceId: routeDeps.workspaceId,
        actor: mutationActor({ principalId: ctx.principal.id }),
        clock: routeDeps.clock,
        idGen: routeDeps.idGen,
        dbOps: routeDeps.dbOps,
        restorePointsRepo: routeDeps.restorePointsRepo,
        databaseLedgerRepo: routeDeps.databaseLedgerRepo,
      });

      return gatewayPlan({
        deps: routeDeps.gatedMutations.gatewayDeps,
        principalId: ctx.principal.id,
        principalKind: AGENT_TOOL_PRINCIPAL_KIND,
        hooks: hooks as unknown as GatedMutationHooks<unknown, unknown>,
      });
    }
function createMigrateHooks<G>(routeDeps: DatabaseToolDeps<G>, mutationActor: DatabaseMutationActorBinding) {
  const { buildMigrateForwardHooks } = routeDeps;
  return ({ actorId }: { actorId: string }, _options = {}) =>
    buildMigrateForwardHooks({
      workspaceId: routeDeps.workspaceId,
      actor: mutationActor({ principalId: actorId }),
      clock: routeDeps.clock,
      idGen: routeDeps.idGen,
      dbOps: routeDeps.dbOps,
      restorePointsRepo: routeDeps.restorePointsRepo,
      databaseLedgerRepo: routeDeps.databaseLedgerRepo,
    }) as unknown as GatedMutationHooks<unknown, { migrated: true }>;
}


function createMigrateForwardHandler<G>(routeDeps: DatabaseToolDeps<G>, surfaces: AssistantSurfaceDeps, mutationActor: DatabaseMutationActorBinding): ToolHandler {
const migrateHooks = createMigrateHooks(routeDeps, mutationActor);
  const { humanConfirmedToolHandler, refuseUnexpectedKeys, adaptLegacyAuthorize, gatewayPlan, gatewayConfirm, gatewayExecute } = routeDeps;
  return humanConfirmedToolHandler(surfaces, {
      flag: "migrated",
      prepare: async ({ ctx }) => {
        refuseUnexpectedKeys(ctx.input === undefined ? {} : requireInputRecord({ input: ctx.input }), []);
        await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: "database.migrate" }, { entityType: "database" });
        const hooks = migrateHooks({ actorId: ctx.principal.id });
        const plan = await gatewayPlan({
          deps: routeDeps.gatedMutations.gatewayDeps,
          principalId: ctx.principal.id,
          principalKind: AGENT_TOOL_PRINCIPAL_KIND,
          hooks: hooks as GatedMutationHooks<unknown, unknown>,
        });
        const costClass = (plan.details as { costClass: "cheap" | "expensive" | "unavailable" }).costClass;
        if (costClass === "unavailable") {
          throw new ToolInputError({ message: "DATABASE_RESTORE_POINT_UNAVAILABLE: this site can't take a restore point, so the database update is refused. Nothing was changed." });
        }
        return { hooks, plan, costClass };
      },
      dialog: () => ({ ...routeDeps.migrateForwardDialog, toolId: MIGRATE_TOOL_ID }),
      run: async ({ ctx, prepared: { hooks, plan, costClass }, confirmer }) => {
        const record = await gatewayConfirm({
          deps: routeDeps.gatedMutations.gatewayDeps,
          signal: ctx.signal,
          principalId: confirmer.id,
          principalKind: confirmer.kind,
          hooks: hooks as GatedMutationHooks<unknown, unknown>,
          planId: plan.planId,
          planHash: plan.planHash,
        });
        return executeMigrateForward({
          siteId: routeDeps.workspaceId,
          confirmationToken: record.confirmationToken,
          costClass,
          operationLock: routeDeps.operationLock,
          gatewayExecute: () =>
            gatewayExecute({
              deps: routeDeps.gatedMutations.gatewayDeps,
              signal: ctx.signal,
              principalId: ctx.principal.id,
              principalKind: AGENT_TOOL_PRINCIPAL_KIND,
              hooks,
              confirmationToken: record.confirmationToken,
            }),
        });
      },
    });
}



export function buildDatabaseRegistrations<G = GatewayDeps>(
  routeDeps: DatabaseToolDeps<G>,
  _optional = {},
): ToolRegistration[] {
  const { surfaces, mutationActor, adaptLegacyAuthorize } = routeDeps;
  const CATALOG_BY_ID = indexCatalogById({ catalog: routeDeps.catalog });
  const portable = createDatabaseReadTools({
    readers: databaseInputReaders,
    workspaceId: routeDeps.workspaceId, introspection: routeDeps.databaseIntrospection,
    ledger: routeDeps.databaseLedgerRepo, restorePoints: routeDeps.restorePointsRepo,
    dbOps: routeDeps.dbOps, clock: routeDeps.clock, idGen: routeDeps.idGen,
    requirePermission: request => requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: request.principalId, permission: request.permission }, { entityType: request.entityType }),
  }, { messages: routeDeps.messages });
  const restorePointTool = portable.find(tool => tool.descriptor.id === "backup_create_restore_point");
  if (restorePointTool === undefined) throw new Error("Database tools have no backup restore point registration");
  const handlers: Record<string, ToolHandler> = {
    ...Object.fromEntries(portable.filter(tool => tool.descriptor.id !== "backup_create_restore_point").map(tool => [tool.descriptor.id, tool.handler])),
    database_plan_migrate_forward: (ctx) => planDatabaseMigrateForward(routeDeps, ctx, mutationActor),


    backup_create_restore_point: restorePointTool.handler,

    // Plans as the agent, asks the human, then confirms as the human and executes as the agent
    // inside the same operation lock and cost-class refusal the admin execute route uses.
    [MIGRATE_TOOL_ID]: createMigrateForwardHandler(routeDeps, surfaces, mutationActor),
  };

  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "database",
    catalogModule: "@jini-ai/db/tools",
    catalog: CATALOG_BY_ID,
    handlers,
    derivedRisk: databaseDerivedRisk,
  }, { unwiredToolIds: UNWIRED_DATABASE_TOOL_IDS });
}

/**
 * Contributes Database's AI tools; called once by the composition root's
 * `installFirstPartyToolContributors()`, never as an import side effect.
 * Database drift logic belongs to the low-level database module, which must not value-import
 * this feature: that would close a runtime cycle through assistant tool discovery.
 */
export function contributeDatabaseTools(): ToolContributor<DatabaseToolDeps, AssistantSurfaceDeps> {
  return { domain: "database", build: buildDatabaseRegistrations, risk: databaseDerivedRisk };
}

/** Host kit is the validation authority; factories receive the same reader behavior through ports. */
const databaseInputReaders: InputReaders = {
  isRecord: (input): input is Record<string, unknown> => isRecord({ value: input }), inputRecord: input => requireInputRecord({ input }), noInput: input => requireNoInput({ input }),
  string: (input, key) => requireString({ input, key }),
  optionalString: (input, key) => optionalString({ input, key }),
  optionalNumber: (input, key) => optionalNumber({ input, key }),
  optionalBoolean: (input, key) => optionalBoolean({ input, key }),
};
