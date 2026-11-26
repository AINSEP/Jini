import { buildDomainRegistrations, indexCatalogById, requireInputRecord, requireString, adaptLegacyAuthorize, requireToolPermission, type AgentToolDefinition, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration, type ToolExecutionContext, type ToolContributor } from "@jini-ai/core";
import { withModelFacingErrors, type ModelFacingErrorRule } from "@jini-ai/core/model-facing-tool-errors";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { SiteImportBackend } from "./import-backend.js";
import type { SiteShareBackend } from "./share-backend.js";
import type { parseSiteImportInput } from "./import-backend.js";
import type { StaticExportInput } from "./static-export-selection.js";
import { SiteShareRefusal } from "./share-refusal.js";
import { PLAN_TOOL_ID, PUSH_PERMISSION, SITE_BACKUP_DOMAIN as DOMAIN, SITE_BACKUP_PUSH_TOOL_ID } from "./backup-service.js";

export interface SiteBackupToolDeps {
  readonly authorize: AuthorizeFn; readonly workspaceId: string;
  readonly siteImportBackend?: Pick<SiteImportBackend, "importBackup" | "listPage">; readonly siteShareBackend?: Pick<SiteShareBackend, "create" | "list" | "revoke">;
}

const MUTATES_DURABLE_STATE = "mutates-durable-state";

/** The host binds its own `StaticExportSelectionPolicy` into the injected parser, so the wiring layer never owns path policy or refusal text. */
type ParseStaticExportInput = (required: { input: unknown }) => StaticExportInput;

/**
 * @file The site-backup domain's agent tools: Git backup (`site_backup_plan`/`site_backup_push`, whose
 * logic and safety rules live in `backup-service.ts`, shared with the admin Git backup route), site
 * shares (`site_share_*`) and imports (`site_import_*`). This module is the catalog, the risk map and
 * the thin handlers.
 */

const INCLUDE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description: "Which parts of the site to back up. Every switch defaults to true; set one to false to leave it out.",
  properties: {
    database: { type: "boolean", description: "The site database: content, menus, media records and settings. No accounts, members, form submissions, sessions or saved credentials. Credential-looking content is retained with warnings." },
    media: { type: "boolean", description: "Uploaded media files (not chat attachments)." },
    themes: { type: "boolean", description: "Installed themes." },
    plugins: { type: "boolean", description: "Installed agent plugins and skills (never plugin OAuth data)." },
    settings: { type: "boolean", description: "The site's config.json and .site-meta.json." },
  },
} as const;

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["owner", "repo"],
  properties: {
    credential: {
      type: "string",
      description: "Label of the saved custom credential or host connection to push with. Optional when exactly one saved custom credential points at a host's apiOrigin (source_control_get_capabilities lists each host's apiOrigin), or when none does and the host has a saved connection.",
    },
    owner: { type: "string", description: "Owner or organization (the account) of the target repository on the host." },
    repo: { type: "string", description: "Target repository name. It must be PRIVATE and already have at least one commit." },
    branch: { type: "string", description: "Branch to commit to. Optional; defaults to the repository's default branch. Must already exist." },
    folder: {
      type: "string",
      description: "Repository-relative folder the backup is written to; it is REPLACED as a whole by each backup. Optional; defaults to the site's folder name.",
    },
    include: INCLUDE_SCHEMA,
    commitMessage: { type: "string" },
  },
} as const;

const PUSH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["planId"],
  properties: { planId: { type: "string", description: "The planId site_backup_plan returned. Single-use; valid for 10 minutes." } },
} as const;

export function createSiteBackupCatalog(required: { importDescription: string; commitDescription: string; shareDescription: string }, _optional = {}): AgentToolDefinition[] {
  return [
  { name: "site_import_backup",
    description: required.importDescription,
    sideEffects: MUTATES_DURABLE_STATE, authorization: { permission: "system.write" },
    inputSchema: { type: "object", additionalProperties: false, oneOf: [{ required: ["url"] }, { required: ["uploadId"] }], properties: { url: { type: "string", description: "Public HTTPS share URL." }, uploadId: { type: "string", description: "ID from the authenticated application/zip upload endpoint; never a filesystem path." }, displayName: { type: "string", maxLength: 200 }, requestId: { type: "string", maxLength: 128, description: "Reuse for a retry of the same import. Omit for a separate import." } } },
  },
  { name: "site_import_list", description: "List your private import history: date, source, new site, status and opening/setup instructions. Does not include other principals' imports or credentials.",
    sideEffects: "none", authorization: { permission: "system.read" }, inputSchema: { type: "object", additionalProperties: false, properties: { cursor: { type: "string", maxLength: 96, description: "nextCursor from the previous page." } } },
  },
  { name: PLAN_TOOL_ID,
    description: "Plans a BACKUP OF THIS SITE to a private repository on a git host a turned-on Agent Plugin provides (source_control_get_capabilities lists each host with its label, apiOrigin and maxFileBytes) — the site's database (content and settings; never accounts, members, form submissions, sessions or saved credentials), media, themes, installed plugins and skills, and settings — as one folder, through the host's connection saved with credential_save with kind source-control or a saved custom credential (Access Tokens page -> 'Add custom provider', base URL = that host's apiOrigin). With no connection yet, tell the person the repository rules below and ask which repository first, then open that form. Use this to back up or keep a copy of the site itself; to publish the RENDERED site to a repository use source_control_execute_commit instead. Read-only: it writes nothing anywhere. It checks the credential, that the repository is PRIVATE (public and internal repositories are refused, because the backup holds unpublished content), that the credential can push, that the branch exists (defaults to the repository's default branch; an empty repository is refused — it needs a first commit such as a README), snapshots the database through the share policy, lists every file with its size, and checks the limits (a media, theme or plugin file over the host's maxFileBytes is left out and listed in skipped; the database over it fails the plan; at most 3000 files and 1 GiB). Returns {planned: true, planId, expiresAt, credential, repository, visibility, branch, folder, folderExists, include, fileCount, totalBytes, totalSize, files: [{path, bytes}], skipped, credentialWarnings, notes, nextStep}, or {planned: false, code, message} naming what to fix (codes: CREDENTIAL_NOT_FOUND, CREDENTIAL_AMBIGUOUS, CREDENTIAL_UNREADABLE, REPOSITORY_NOT_FOUND, REPOSITORY_NOT_PRIVATE, NO_PUSH_PERMISSION, REPOSITORY_EMPTY, BRANCH_NOT_FOUND, FOLDER_IS_FILE, DATABASE_SNAPSHOT_FAILED, UNSUPPORTED_DATA, UNSUPPORTED_SCHEMA, LIMIT_EXCEEDED, PROVIDER_ERROR, NETWORK_UNREACHABLE, UNAVAILABLE). Show the human the plan (repository, branch, folder, what is included, file count and size, anything skipped, and credentialWarnings), then call site_backup_push with the planId.",
    sideEffects: "none",
    authorization: { permission: PUSH_PERMISSION },
    inputSchema: { ...PLAN_SCHEMA, properties: { ...PLAN_SCHEMA.properties, commitMessage: { ...PLAN_SCHEMA.properties.commitMessage, description: required.commitDescription } } },
  },
  { name: SITE_BACKUP_PUSH_TOOL_ID,
    description: "Pushes the single-use plan from site_backup_plan immediately in one non-force Git commit. Requires the original permissions and principal binding, and re-checks that the repository is private, the branch is unchanged and the planned files are fresh. Replaces only the backup folder; previous contents remain recoverable in Git history. Returns {pushed:true, commitSha, commitUrl, repository, branch, folder, filesWritten, totalBytes}. A large backup can take longer than one call: then it returns {pushed:false, cancelled:false, inProgress:true, planId, progress:{filesDone, filesTotal, bytesDone, bytesTotal}, message} while the upload keeps running; tell the human how far it is and call site_backup_push again with the SAME planId to keep waiting (it never starts a second upload). Failures return {pushed:false, cancelled:false, code, message}, including expired/missing plans, changed branches or files, public repositories and credential/provider/network errors; a failed upload names the file. Transient network errors, host errors and rate limits are already retried with backoff, so do not retry NETWORK_UNREACHABLE in a loop. Plan again after PLAN_STALE, DIVERGED_BRANCH or plan expiry.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: PUSH_PERMISSION },
    inputSchema: PUSH_SCHEMA,
  },
  { name: "site_share_create",
    description: required.shareDescription,
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: PUSH_PERMISSION },
    inputSchema: { type: "object", additionalProperties: false, properties: { jobId: { type: "string", description: "Only when polling: the jobId returned by this same create operation." } } },
  },
  { name: "site_export_static",
    description: "Export THIS SITE as rendered HTML, CSS, JavaScript and assets through selected installed themes (themeIds, in selection order; omit for the active theme). Creates one private ZIP download with a date-time filename; extract the ZIP, then open index.html in a browser; it lists every exported theme and its pages. Includes README.txt with its time, theme and known gaps, sites/<theme>/ pages and theme assets, and referenced public media in media/. Links are relative to each file so the copy opens from disk. Private Library documents are excluded. No database backup or public upload. Returns {shareId,file,downloadUrl}, or {jobId,phase,progress}; poll with ONLY the SAME jobId, without themeIds. Partial renders include their successful pages and disclose gaps. Does not require an already-running public server.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: PUSH_PERMISSION },
    inputSchema: { type: "object", additionalProperties: false, properties: { publicUrl: { type: "string", description: "Optional public HTTPS destination for absolute sitemap, feed and SEO URLs. Omit when unknown; start only." }, jobId: { type: "string", description: "Only when polling this static export; never combine with themeIds." }, themeIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" }, description: "Ordered installed theme IDs. Start only; defaults to the active theme." } } },
  },
  { name: "site_share_list",
    description: "List THIS SITE's private export registry, including active, failed and revoked exports: shareId, site, creation/revocation dates, bytes, sha256, status, link and ZIP download path. Requires site-backup.push; there is no anonymous export index. Does not create an export or reveal storage credentials.",
    sideEffects: "none",
    authorization: { permission: PUSH_PERMISSION },
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  { name: "site_share_revoke",
    description: "Revoke THIS SITE's export by shareId. Disables its public token first, deletes the ZIP from private and remote storage, and verifies remote disappearance. Revoked entries remain in site_share_list. Cleanup/purge failures are reported and retrying the same shareId retries deletion. Already downloaded copies cannot be recalled.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: PUSH_PERMISSION },
    inputSchema: { type: "object", additionalProperties: false, required: ["shareId"], properties: { shareId: { type: "string" } } },
  },
];
}

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
type ShareAction = (required: { backend: NonNullable<SiteBackupToolDeps["siteShareBackend"]>; raw: Record<string, unknown>; ctx: ToolExecutionContext; parseStaticExportInput: ParseStaticExportInput; format?: "static" }) => Promise<unknown>;

const SHARE_ACTIONS: Record<"create" | "static" | "list" | "revoke", ShareAction> = {
  static: async ({ backend, raw, ctx, parseStaticExportInput }) => backend.create({ principalId: ctx.principal.id, signal: ctx.signal, format: "static", ...parseStaticExportInput({ input: raw }) }),
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
async function handleShare(required: { deps: SiteBackupToolDeps; ctx: ToolExecutionContext; action: "create" | "static" | "list" | "revoke"; parseStaticExportInput: ParseStaticExportInput }, _optional: Record<string, never> = {}): Promise<unknown> {
  const { deps, ctx, action, parseStaticExportInput } = required;
  const raw = requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: PUSH_PERMISSION }, { entityType: DOMAIN });
  if (!deps.siteShareBackend) return { ok: false, code: "UNAVAILABLE", message: "Site sharing requires a site folder and private storage." };
  try {
    return await SHARE_ACTIONS[action]({ backend: deps.siteShareBackend, raw, ctx, parseStaticExportInput });
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
export function bindSiteBackupTools<THost, TRequest extends SiteBackupToolDeps>(required: {
  importDescription: string; commitDescription: string; shareDescription: string;
  catalogModule: string;
  toolMetadata: NonNullable<Parameters<typeof buildDomainRegistrations>[0]["metadata"]>;
  modelFacingErrors: readonly ModelFacingErrorRule[];
  parseStaticExportInput: ParseStaticExportInput;
  parseSiteImportInput: typeof parseSiteImportInput;
  parseSiteImportListQuery: (required: { query: Record<string, unknown> }) => { ok: true; value: { cursor?: string } } | { ok: false; error: { message: string } };
  resolveDeps: (required: { deps: THost; ctx: ToolExecutionContext }, optional: Record<string, never>) => TRequest;
  planSiteBackup: (required: { deps: TRequest; call: ToolExecutionContext }, optional: Record<string, never>) => Promise<unknown>;
  pushSiteBackup: (required: { deps: TRequest; call: ToolExecutionContext }, optional: Record<string, never>) => Promise<unknown>;
}, _optional: Record<string, never> = {}) {
  const siteBackupAgentToolCatalog = createSiteBackupCatalog(required);
  const catalog = indexCatalogById({ catalog: siteBackupAgentToolCatalog });
  const buildSiteBackupRegistrations = ({ deps: mountedDeps, surfaces: _surfaces }: { deps: THost; surfaces: AssistantSurfaceDeps }, _optional: Record<string, never> = {}): ToolRegistration[] => {
    const handlers: Record<string, ToolHandler> = {
      site_import_backup: ctx => handleImport({ deps: required.resolveDeps({ deps: mountedDeps, ctx }, {}), ctx, list: false, parseSiteImportInput: required.parseSiteImportInput, parseSiteImportListQuery: required.parseSiteImportListQuery }),
      site_import_list: ctx => handleImport({ deps: required.resolveDeps({ deps: mountedDeps, ctx }, {}), ctx, list: true, parseSiteImportInput: required.parseSiteImportInput, parseSiteImportListQuery: required.parseSiteImportListQuery }),
      [PLAN_TOOL_ID]: ctx => required.planSiteBackup({ deps: required.resolveDeps({ deps: mountedDeps, ctx }, {}), call: ctx }, {}),
      [SITE_BACKUP_PUSH_TOOL_ID]: ctx => required.pushSiteBackup({ deps: required.resolveDeps({ deps: mountedDeps, ctx }, {}), call: ctx }, {}),
      site_share_create: ctx => handleShare({ deps: required.resolveDeps({ deps: mountedDeps, ctx }, {}), ctx, action: "create", parseStaticExportInput: required.parseStaticExportInput }),
      site_export_static: ctx => handleShare({ deps: required.resolveDeps({ deps: mountedDeps, ctx }, {}), ctx, action: "static", parseStaticExportInput: required.parseStaticExportInput }),
      site_share_list: ctx => handleShare({ deps: required.resolveDeps({ deps: mountedDeps, ctx }, {}), ctx, action: "list", parseStaticExportInput: required.parseStaticExportInput }),
      site_share_revoke: ctx => handleShare({ deps: required.resolveDeps({ deps: mountedDeps, ctx }, {}), ctx, action: "revoke", parseStaticExportInput: required.parseStaticExportInput }),
    };
    return buildDomainRegistrations({ metadata: required.toolMetadata, domain: DOMAIN, catalogModule: required.catalogModule, catalog,
      handlers: withModelFacingErrors({ handlers, rules: required.modelFacingErrors }), derivedRisk: siteBackupDerivedRisk });
  };
  return {
    siteBackupAgentToolCatalog, buildSiteBackupRegistrations,
    contributeSiteBackupTools: (_required: Record<string, never>, _optional: Record<string, never> = {}): ToolContributor<THost, AssistantSurfaceDeps> => ({
      domain: DOMAIN, build: (deps, surfaces) => buildSiteBackupRegistrations({ deps, surfaces }, {}), risk: siteBackupDerivedRisk,
    }),
  };
}

/** Local creation permissions precede all download, upload consumption and registry effects. */
async function handleImport(required: { deps: SiteBackupToolDeps; ctx: ToolExecutionContext; list: boolean; parseSiteImportInput: typeof parseSiteImportInput; parseSiteImportListQuery: (required: { query: Record<string, unknown> }) => { ok: true; value: { cursor?: string } } | { ok: false; error: { message: string } } }, _options: Record<string, never> = {}): Promise<unknown> {
  const { deps, ctx, list, parseSiteImportInput, parseSiteImportListQuery } = required;
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: list ? "system.read" : "system.write" }, { entityType: "site-registry" });
  if (!deps.siteImportBackend) return { ok: false, code: "UNAVAILABLE", message: "Import requires local site creation and a configured sites home." };
  try {
    const input = requireInputRecord({ input: ctx.input });
    if (list) {
      if (Object.keys(input).some(key => key !== "cursor")) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "site_import_list accepts only cursor." });
      const parsed = parseSiteImportListQuery({ query: input });
      if (!parsed.ok) throw new SiteShareRefusal({ code: "INVALID_CURSOR", message: parsed.error.message });
      return await deps.siteImportBackend.listPage({ ...parsed.value, principalId: ctx.principal.id });
    }
    return await deps.siteImportBackend.importBackup({ ...parseSiteImportInput({ input }), principalId: ctx.principal.id }, { signal: ctx.signal });
  } catch (error) {
    if (error instanceof SiteShareRefusal) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}
