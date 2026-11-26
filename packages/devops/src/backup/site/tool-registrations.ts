import { buildDomainRegistrations, requireInputRecord, requireString, adaptLegacyAuthorize, requireToolPermission, type AgentToolDefinition, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration, type ToolExecutionContext, type ToolContributor } from "@jini-ai/core";
import { withModelFacingErrors, type ModelFacingErrorRule } from "@jini-ai/core/model-facing-tool-errors";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { SiteShareBackend } from "./share-backend.js";
import type { parseSiteImportInput } from "./import-backend.js";
import type { parseStaticExportInput } from "./static-export-selection.js";
import { SiteShareRefusal } from "./share-refusal.js";
import { PLAN_TOOL_ID, planSiteBackup, PUSH_PERMISSION, pushSiteBackup, SITE_BACKUP_DOMAIN as DOMAIN, SITE_BACKUP_PUSH_TOOL_ID, type SiteBackupToolDeps as SiteBackupServiceDeps } from "./backup-service.js";

export interface SiteBackupToolDeps extends SiteBackupServiceDeps {
  readonly catalog: ReadonlyMap<string, AgentToolDefinition>;
  readonly toolMetadata: Parameters<typeof buildDomainRegistrations>[0]["metadata"];
  readonly modelFacingErrors: readonly ModelFacingErrorRule[];
  readonly parseStaticExportInput: (required: { input: unknown }) => ReturnType<typeof parseStaticExportInput>;
  readonly parseSiteImportInput: typeof parseSiteImportInput;
  readonly parseSiteImportListQuery: (required: { query: Record<string, unknown> }) => { ok: true; value: { cursor?: string } } | { ok: false; error: { message: string } };
}

const MUTATES_DURABLE_STATE = "mutates-durable-state";

/**
 * @file The site-backup domain's agent tools: Git backup (`site_backup_plan`/`site_backup_push`, whose
 * logic and safety rules live in `backup-service.ts`, shared with the admin Git backup route), site
 * shares (`site_share_*`) and imports (`site_import_*`). This module is the catalog, the risk map and
 * the thin handlers.
 */

/** This wiring layer's own risk classification, cross-checked against the catalog's `sideEffects`. */
export const siteBackupDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  ["site_import_backup", MUTATES_DURABLE_STATE],
  ["site_import_list", "none"],
  // -> a non-decrypting credential list, one decrypting resolve, four read-only host GETs, a
  // database snapshot held in memory (its restore-point file deleted at once), a disk walk, and an
  // in-memory plan. Nothing durable is written anywhere.
  [PLAN_TOOL_ID, "none"],
  // -> blobs, trees, a commit and a non-force ref update in a
  // THIRD-PARTY repository — the same classification custom_credential_write_files carries.
  [SITE_BACKUP_PUSH_TOOL_ID, MUTATES_DURABLE_STATE],
  ["site_share_create", MUTATES_DURABLE_STATE],
  ["site_export_static", MUTATES_DURABLE_STATE],
  ["site_share_list", "none"],
  ["site_share_revoke", MUTATES_DURABLE_STATE],
]);

/**
 * What reaches the model with its real reason instead of a redacted `INTERNAL_ERROR`. Input
 * validation (`CustomCredentialValidationError`) names a field and a rule, never a secret.
 * `CustomCredentialSecretStoreUnconfiguredError` is deliberately absent: it is caught and turned into
 * `CREDENTIAL_UNREADABLE` in `backup-service.ts`, and its own text must never be published.
 */
/** One share tool's effect once authorized: its exact input contract, then the backend call. */
type ShareAction = (required: { backend: SiteShareBackend; raw: Record<string, unknown>; ctx: ToolExecutionContext; deps: SiteBackupToolDeps; format?: "static" }) => Promise<unknown>;

const SHARE_ACTIONS: Record<"create" | "static" | "list" | "revoke", ShareAction> = {
  static: async ({ backend, raw, ctx, deps }) => backend.create({ principalId: ctx.principal.id, signal: ctx.signal, format: "static", ...deps.parseStaticExportInput({ input: raw }) }),
  list: async ({ backend, raw }) => {
    if (Object.keys(raw).length) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "site_share_list takes no fields." });
    return { shares: await backend.list({}) };
  },
  revoke: async ({ backend, raw }) => {
    if (Object.keys(raw).some(key => key !== "shareId")) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "Only shareId is accepted." });
    return await backend.revoke({ shareId: requireString({ input: raw, key: "shareId" }) });
  },
  create: async ({ backend, raw, ctx, format }) => {
    if (Object.keys(raw).some(key => key !== "jobId") || raw.jobId !== undefined && (typeof raw.jobId !== "string" || !/^[0-9a-f-]{36}$/.test(raw.jobId))) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "Only an optional share jobId is accepted." });
    return await backend.create({ principalId: ctx.principal.id, signal: ctx.signal, ...(format ? { format } : {}), ...(typeof raw.jobId === "string" ? { jobId: raw.jobId } : {}) });
  },
};

/** Authorization stays on the existing backup contributor; backend effects are shared with HTTP. */
async function handleShare(required: { deps: SiteBackupToolDeps; ctx: ToolExecutionContext; action: "create" | "static" | "list" | "revoke" }, _optional: Record<string, never> = {}): Promise<unknown> {
  const { deps, ctx, action } = required;
  const raw = requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: PUSH_PERMISSION }, { entityType: DOMAIN });
  if (!deps.siteShareBackend) return { ok: false, code: "UNAVAILABLE", message: "Site sharing requires a site folder and private storage." };
  try {
    return await SHARE_ACTIONS[action]({ backend: deps.siteShareBackend, raw, ctx, deps });
  } catch (error) {
    if (error instanceof SiteShareRefusal) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

/**
 * Builds this domain's `ToolRegistration[]`.
 *
 * @complexity O(1) at registration.
 */
export function buildSiteBackupRegistrations(deps: SiteBackupToolDeps, _surfaces: AssistantSurfaceDeps): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    site_import_backup: ctx => handleImport({ deps, ctx, list: false }),
    site_import_list: ctx => handleImport({ deps, ctx, list: true }),
    [PLAN_TOOL_ID]: (ctx) => planSiteBackup({ deps, call: ctx }),
    [SITE_BACKUP_PUSH_TOOL_ID]: (ctx) => pushSiteBackup({ deps, call: ctx }),
    site_share_create: (ctx) => handleShare({ deps, ctx, action: "create" }),
    site_export_static: (ctx) => handleShare({ deps, ctx, action: "static" }),
    site_share_list: (ctx) => handleShare({ deps, ctx, action: "list" }),
    site_share_revoke: (ctx) => handleShare({ deps, ctx, action: "revoke" }),
  };
  return buildDomainRegistrations({ ...(deps.toolMetadata === undefined ? {} : { metadata: deps.toolMetadata }),
    domain: DOMAIN,
    catalogModule: "features/site-backup/tool-registrations.ts",
    catalog: deps.catalog,
    handlers: withModelFacingErrors({ handlers, rules: deps.modelFacingErrors }),
    derivedRisk: siteBackupDerivedRisk,
  });
}

/** Contributes the site-backup tools — called once by `server/runtime/composition/
 *  tool-catalog-manifest.ts`'s `installFirstPartyToolContributors()`. */
export function contributeSiteBackupTools(): ToolContributor<SiteBackupToolDeps, AssistantSurfaceDeps> {
  return { domain: DOMAIN, build: buildSiteBackupRegistrations, risk: siteBackupDerivedRisk };
}

/** Local creation permissions precede all download, upload consumption and registry effects. */
async function handleImport(required: { deps: SiteBackupToolDeps; ctx: ToolExecutionContext; list: boolean }, _options: Record<string, never> = {}): Promise<unknown> {
  const { deps, ctx, list } = required;
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: list ? "system.read" : "system.write" }, { entityType: "site-registry" });
  if (!deps.siteImportBackend) return { ok: false, code: "UNAVAILABLE", message: "Import requires local site creation and a configured sites home." };
  try {
    const input = requireInputRecord({ input: ctx.input });
    if (list) {
      if (Object.keys(input).some(key => key !== "cursor")) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "site_import_list accepts only cursor." });
      const parsed = deps.parseSiteImportListQuery({ query: input });
      if (!parsed.ok) throw new SiteShareRefusal({ code: "INVALID_CURSOR", message: parsed.error.message });
      return await deps.siteImportBackend.listPage({ ...parsed.value, principalId: ctx.principal.id });
    }
    return await deps.siteImportBackend.importBackup({ ...deps.parseSiteImportInput({ input }), principalId: ctx.principal.id }, { signal: ctx.signal });
  } catch (error) {
    if (error instanceof SiteShareRefusal) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}
