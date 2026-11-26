import type { ChatDeleteSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { toolMetadata } from '@jini-ai/core/tool-metadata/permanent-delete';
import { adaptLegacyAuthorize } from "@jini-ai/core";
import { ToolInputError } from "@jini-ai/core";
import {
  buildDomainRegistrations,
  indexCatalogById,
  requireInputRecord,
  requireString,
  type DerivedRiskByToolId,
  type ToolHandler,
  type ToolRegistration,
} from "@jini-ai/core";
import { requireToolPermission } from "@jini-ai/core";
import { type AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { SurfaceDetail } from "@jini-ai/core/contracts/cards";
import type { ToolContributor } from "@jini-ai/core";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";
import type { ToolExecutionContext, ToolExecutionOptions, HumanConfirmer, AgentToolDefinition } from "@jini-ai/core";
import { createPermanentDeleteAgentToolCatalog, createPermanentDeleteSpecs, type PermanentDeleteToolId } from "@jini-ai/cms/trash/permanent/agent-tools";

const MUTATES_DURABLE_STATE = "mutates-durable-state" as const;

/** A prepared effect fixes the target before consent; callback params never enter execute(). */
export interface PermanentDeletePlan {
  readonly details: readonly SurfaceDetail[];
  readonly warning?: string;
  execute(): Promise<Record<string, unknown>>;
}

/** Inject the existing resource services at the composition root; no DB/provider coupling here. */
export interface PermanentDeleteToolDeps {
  specs: ReturnType<typeof createPermanentDeleteSpecs>;
  catalog: readonly AgentToolDefinition[];
  refuseUnexpectedKeys: (input: Record<string, unknown>, allowed: readonly string[]) => void;
  notConfirmedResult: (required: { confirmed: false; reason: "abandoned" }) => Record<string, unknown>;
  approvalToolHandler<TPrepared>(required: {
    surfaces: ChatDeleteSurfaceDeps;
    prepare: (required: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions) => Promise<TPrepared>;
    describe: (required: { ctx: ToolExecutionContext; prepared: TPrepared }) => HumanConfirmSpec | Promise<HumanConfirmSpec>;
    run: (required: { ctx: ToolExecutionContext; prepared: TPrepared; confirmer: HumanConfirmer; choice?: string }, optional: ToolExecutionOptions) => Promise<unknown>;
  }, optional?: { flag?: string; batch?: boolean }): ToolHandler;
  workspaceId: string;
  authorize: AuthorizeFn;
  prepare(toolId: PermanentDeleteToolId, id: string | null, principalId: string): Promise<PermanentDeletePlan>;
}

export const permanentDeleteDerivedRisk: DerivedRiskByToolId = new Map([
  // -> TrashPort.purgeSelected on the confirmed snapshot; per-row auth and compare-delete retained.
  ["trash_empty", MUTATES_DURABLE_STATE],
  // -> TrashPort.purgeSelected for one confirmed Trash row.
  ["trash_purge_item", MUTATES_DURABLE_STATE],
  // -> purgeMedia + forgetRemovedMedia: asset/rendition removal and blob tombstone.
  ["media_purge_asset", MUTATES_DURABLE_STATE],
  // -> CommentWriteService.purge: row/index removal plus audit event.
  ["comments_purge_comment", MUTATES_DURABLE_STATE],
  // -> TrashPort.purgeSelected -> user adapter / SqlUserPurge: identity cascade.
  ["identity_user_delete", MUTATES_DURABLE_STATE],
  // -> deleteExternalMcpServer: saved server/config/auth removal.
  ["external_mcp_delete", MUTATES_DURABLE_STATE],
  // -> deleteCustomCredential: deletes the saved encrypted credential.
  ["custom_credential_delete", MUTATES_DURABLE_STATE],
  // -> deletePublishCredential: deletes vendor credential, promotes next default.
  ["deployment_delete_provider_credential", MUTATES_DURABLE_STATE],
  // -> deleteSourceControlCredential: deletes source-control credential, promotes next default.
  ["source_control_delete_credential", MUTATES_DURABLE_STATE],
]);

/**
 * Wire every delete through the existing human-confirm exchange. Parse -> authorize -> prepare ->
 * card -> reauthorize -> effect. The second authorization closes revocation during the human wait.
 * @param deps - Permission evaluator and resource-specific preparation/effect adapter.
 * @param surfaces - The transport's shared exchange store, also used by the authenticated callback.
 * @returns Nine non-read-only registrations; no headless or model-input confirmation fallback.
 * @throws ToolInputError for invalid input, no confirmation channel, not-found or changed targets.
 * @complexity O(t) to build for t tools; execution adds the resource service cost and human latency.
 */
export function buildPermanentDeleteRegistrations(deps: PermanentDeleteToolDeps, surfaces: ChatDeleteSurfaceDeps): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {};
  for (const spec of deps.specs) {
    handlers[spec.name] = deps.approvalToolHandler({ surfaces, prepare: async ({ ctx }) => {
      const input = requireInputRecord({ input: ctx.input });
      deps.refuseUnexpectedKeys(input, spec.key === null ? [] : [spec.key]);
      const id = spec.key === null ? null : requireString({ input: input, key: spec.key }).trim();
      if (id === "") throw new ToolInputError({ message: `${spec.name}: '${spec.key}' must be a non-empty id.` });
      const authorize = () => requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: spec.permission }, { entityType: spec.entityType, ...(id === null ? {} : { entityId: id }) });
      await authorize();
      const plan = await deps.prepare(spec.name, id, ctx.principal.id);
      return { plan, authorize };
    }, describe: ({ prepared: { plan } }) => ({
        toolId: spec.name, errorCode: "PERMANENT_DELETE", title: `Permanently delete ${spec.subject}?`,
        description: "Review the exact saved items below. This action cannot be undone.",
        details: plan.details, warning: plan.warning ?? "Permanent deletion has no undo or restore.",
        danger: true, confirmLabel: "Permanently delete",
    }), run: async ({ ctx, prepared: { plan, authorize } }) => {
      await authorize();
      // Already-aborted calls cannot ask the human or perform an irreversible effect.
      if (ctx.signal.aborted) return { removed: false, ...deps.notConfirmedResult({ confirmed: false, reason: "abandoned" }) };
      return plan.execute();
    } }, { flag: "removed", batch: spec.key !== null });
  }
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "permanent-delete", catalogModule: "@jini-ai/cms/trash/permanent/agent-tools.ts", catalog: indexCatalogById({ catalog: deps.catalog }), handlers, derivedRisk: permanentDeleteDerivedRisk });
}

/** Compose with host adapters without importing server/assistant implementations into the feature. */
export function contributePermanentDeleteTools<TDeps>(spec: { buildDeps: (routeDeps: TDeps) => PermanentDeleteToolDeps }): ToolContributor<TDeps, ChatDeleteSurfaceDeps> {
  return { domain: "permanent-delete", build: (routeDeps, surfaces) => buildPermanentDeleteRegistrations(spec.buildDeps(routeDeps), surfaces), risk: permanentDeleteDerivedRisk };
}
