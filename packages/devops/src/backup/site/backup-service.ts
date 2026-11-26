import type { findReservedPath } from "../../source-control/registry.js";
import { requireInputRecord, requireString, adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { DbOpsPort } from "@jini-ai/core/contracts/site/gated-mutations-ports";
import type { ObservabilityPort } from "@jini-ai/core/contracts/observability";
import type { CredentialSetConnectionInput as CustomProviderConnectionInput } from "@jini-ai/core/contracts/credentials";

import type { SourceControlProvider } from "../../source-control/site/provider-module.js";

import type { BackupRepositoryState } from "../../source-control/contracts.js";
import type { resolveDefaultForSourceControl } from "../../source-control/site/store.js";
import type { pickSourceControlProviderForApi } from "../../source-control/registry.js";
import type { SourceControlProviderId } from "@jini-ai/core/contracts/site/source-control-credentials";
import type { SiteImportBackend } from "./import-backend.js";
import type { SiteShareBackend } from "./share-backend.js";

import type { ShareDatabaseSanitizer } from "./share-preparation-steps.js";
import type { SiteBackupPlan as BaseBackupPlan, SiteBackupPlanStore } from "../plan-store.node.js";
import type { initialPushProgress, uploadBackupPlan, commitBackupPlan } from "./push-content.js";
import type { SiteBackupPushJobs, SiteBackupPushProgress } from "../push-jobs.js";
import { type formatByteSize, type skipOversizedFiles, type SiteBackupSources, type SiteBackupHostLimit, type SiteBackupInclude, type PlannedDiskFile, type SkippedSiteBackupFile, type SiteBackupScope, type DatabaseSnapshotResult, type CollectedSiteBackupFiles, type SiteBackupLimitsResult, type ReadPlannedFileResult } from "./sources.js";
import type { CredentialWarning } from "./credential-warnings.js";

import { PLAN_TOOL_ID, SITE_BACKUP_PUSH_TOOL_ID, PUSH_WAIT_MS, inspect } from "./backup-service.shared.js";
export { PLAN_TOOL_ID, SITE_BACKUP_PUSH_TOOL_ID, PUSH_WAIT_MS } from "./backup-service.shared.js";
import { backupTarget, resolveBackupCredential } from "./backup-service.credentials.js";
import { requireUnreservedFolder, parsePlanInput, planResult, savePlan, prepareContent } from "./backup-service.plan.js";
import { runObservedBackupPush, PLAN_TAKE_MESSAGES, inProgressResult, pushWaitBudget } from "./backup-service.push.js";
/**
 * @file The site-backup service behind the agent tools `site_backup_plan` (read-only) and
 * `site_backup_push` (authorized, immediate) AND the admin Git backup route
 * (`admin-http/routes/system/site-backups.ts`): one code path, so the screen and the assistant run
 * the same checks under the same permissions. Together they put the site's content — the database, media, themes, plugins
 * and settings — into ONE folder of a private repository on a plugin-provided git host, in one commit, through a saved
 * custom credential (the same credentials `custom_credential_write_files` uses).
 *
 * Why two calls: the plan does every check that can fail (credential, repository visibility and
 * permissions, branch, folder, database snapshot, sizes) and returns what WOULD be written, so the
 * model can report the planned backup. The push uploads exactly what was planned: the database snapshot is
 * held in memory with the plan (`plan-content.ts`), and each disk file is re-read and refused if it
 * changed since (`readPlannedFile`).
 *
 * A large backup outlasts one tool call: the push runs as a job (`push-jobs.ts`), the call waits for
 * it up to {@link PUSH_WAIT_MS} and otherwise returns its progress; calling the push again with the
 * same planId keeps waiting on the same job. The upload itself is Jini's `backup/site/push-content`.
 *
 * Safety rules, each re-checked at push time where the world can change in between:
 * - The database is the share projection ({@link captureBackupDatabase}): content, themes and
 *   settings, never accounts, members, RBAC, sessions or secrets.
 * - Private repositories only (public and "internal" both refused), because the database holds
 *   unpublished content. Re-checked before pushing.
 * - Never a force push, and never a surprise overwrite: the push commits on the PLAN's tip, and a
 *   branch that moved since is refused (`DIVERGED_BRANCH`) before a single blob is uploaded, and
 *   again by the host itself on the non-force ref update.
 * - The token never leaves the server: not in any result, dialog or log line.
 *
 * Credential errors are split so an operator can act on them: a label with no saved row is
 * `CREDENTIAL_NOT_FOUND` (with the labels that do exist), and a saved row this server cannot decrypt
 * is `CREDENTIAL_UNREADABLE`, whose message says WHICH problem it is from THIS SITE's own site key
 * status (`inspectSiteKeyMaterial` run over `siteKeySourcesForSiteDir`'s site-aware source ordering —
 * site-key plan §A3b, the same composed helper the admin site key route reuses, so an active
 * per-site key file is never mistaken for "no site key" — see `unreadableCredentialMessage`) —
 * never from the decrypt error's own text, which can quote plaintext. (The same "unreadable reads as
 * missing" confusion `ADS-memory/.local-artifacts/reports/2026-09-21-byok-triage.md` traced for BYOK
 * keys.)
 *
 * Out of scope: restoring from a backup, and scheduled backups.
 */

export const SITE_BACKUP_DOMAIN = "site-backup";
const DOMAIN = SITE_BACKUP_DOMAIN;
/** The one permission that names this feature. Not in any built-in role but the owner's `*`. */
export const PUSH_PERMISSION = "site-backup.push";
/** Also required: the push sends a saved credential's token to its provider, which is exactly what
 *  `custom_credential_write_files` gates on this permission. */
const CREDENTIAL_WRITE_PERMISSION = "custom-credentials.write";


/** What one plan or push call carries: the caller's raw input, who is calling, and when to stop. A
 *  tool's `ToolExecutionContext` is one; the admin route builds one from the request. */
export interface SiteBackupCall {
  readonly input: unknown;
  readonly principal: { readonly id: string };
  readonly signal: AbortSignal;
}

/** The slice of the route-deps bag these tools read. Structural, so this module never imports
 *  `server/routes/types`. */
export interface SiteBackupRequestDeps<TSource extends SiteBackupSources = SiteBackupSources, TContent extends SiteBackupRepositoryPlanContent = SiteBackupRepositoryPlanContent> {
  readonly authorize: AuthorizeFn; readonly workspaceId: string;
  readonly siteImportBackend?: SiteImportBackend; readonly siteShareBackend?: SiteShareBackend;
  readonly sourceControlCredentialSetRepo?: unknown;
  readonly observability?: ObservabilityPort;
  readonly dbOps: DbOpsPort; readonly siteBackupSources?: TSource | undefined;
  readonly siteBackupSanitize?: ShareDatabaseSanitizer;
  readonly siteBackupPlanStore?: Pick<SiteBackupPlanStore<TContent>, "save" | "take">;
  readonly siteBackupSiteKeyStatus?: () => { active: boolean; invalid?: boolean };
  readonly siteBackupFailureLog?: (line: string) => void; readonly siteBackupNow?: () => Date;
  readonly siteBackupPushJobs?: SiteBackupPushJobs<PushResult>;
  readonly siteBackupPushWaitMs?: number; readonly siteBackupSleep?: (ms: number) => Promise<void>;
}

export interface SiteBackupToolDeps<TSource extends SiteBackupSources = SiteBackupSources, TContent extends SiteBackupRepositoryPlanContent = SiteBackupRepositoryPlanContent, TRequest extends SiteBackupRequestDeps<TSource, TContent> = SiteBackupRequestDeps<TSource, TContent>> {
  readonly request: TRequest;
  deps: {
    findReservedPath: typeof findReservedPath;
    CustomCredentialValidationError: new (message: string) => Error;
    normalizeWriteFilePath(required: { rawPath: string }): string;
    validateBranch(required: { value: string }): string;
    validateCommitMessage(required: { value: string }): string;
    buildAuthorizationHeader(required: { connection: CustomProviderConnectionInput; schemes: readonly never[] }): string;
  };
  readonly siteBackupSanitize: ShareDatabaseSanitizer;
  readonly siteBackupPlanStore: Pick<SiteBackupPlanStore<TContent>, "save" | "take">;
  readonly siteBackupSiteKeyStatus: (required: { siteDir: string }) => { active: boolean; invalid?: boolean };
  readonly serverSiteKeyStatus: () => { active: boolean; invalid?: boolean };
  readonly siteBackupFailureLog: (line: string) => void; readonly siteBackupNow: () => Date;
  readonly siteBackupPushJobs: SiteBackupPushJobs<PushResult>;
  readonly listCustomCredentials: (required: { deps: TRequest }, input: { workspaceId: string }) => Promise<readonly { label: string; baseUrl: string }[]>;
  readonly resolveCustomCredentialByLabel: (required: { deps: TRequest }, input: { workspaceId: string; label: string }) => Promise<{ baseUrl: string; connection: CustomProviderConnectionInput } | null>;
  readonly resolveDefaultForSourceControl: (required: { deps: TRequest }, input: { workspaceId: string; providerId: SourceControlProviderId }) => ReturnType<typeof resolveDefaultForSourceControl>;
  readonly isSourceControlCredentialSecretStoreUnconfiguredError: (error: unknown) => boolean;
  readonly isCustomCredentialSecretStoreUnconfiguredError: (error: unknown) => boolean;
  readonly credentialMessages: Record<"active" | "invalid" | "missing", (required: { label: string }) => string>;
  readonly buildSourceControlProviders: (required: { deps: TRequest }, optional: Record<string, never>) => Promise<{ providers: readonly SourceControlProvider[]; refusals: readonly string[]; noProviderMessage: string }>;
  readonly pickSourceControlProviderForApi: typeof pickSourceControlProviderForApi<SourceControlProvider>;
  readonly completePlanContent: (required: { content: SiteBackupRepositoryPlanContent; sources: TSource }, optional: Record<string, never>) => TContent;
  readonly validateRepositoryTarget: (required: { owner: unknown; repo: unknown }, optional: { validateTarget?: SourceControlProvider["validateTarget"] }) => { owner: string; repo: string };
  readonly siteFolderName: (required: { siteDir: string }) => string;
  readonly readConfigText: (required: { siteDir: string }) => Promise<string>;
  readonly runtimeSchemaVersion: () => { index: number; tag: string };
  readonly defaultCommitMessage: (required: { siteName: string; createdAt: string }) => string;
  readonly manifestName: string;
  readonly captureDatabaseSnapshot: (required: { dbOps: DbOpsPort; scopeId: string }) => Promise<DatabaseSnapshotResult>;
  readonly collectSiteBackupFiles: (required: { sources: TSource; include: SiteBackupInclude }) => Promise<CollectedSiteBackupFiles>;
  readonly checkSiteBackupLimits: (required: { files: readonly { path: string; bytes: number }[]; host: SiteBackupHostLimit }) => SiteBackupLimitsResult;
  readonly readPlannedFile: (file: PlannedDiskFile) => Promise<ReadPlannedFileResult>;
  readonly requireShareSecretFree: (required: { path: string; bytes: Uint8Array }, optional: { credentialWarnings: CredentialWarning[] }) => unknown;
  readonly backupPushUploadPolicy: (required: { plan: SiteBackupPlan<TContent> }) => Pick<Parameters<typeof uploadBackupPlan>[0], "databasePath" | "readPlannedFile" | "buildManifest" | "cancelled">;
  readonly initialPushProgress: typeof initialPushProgress;
  readonly uploadBackupPlan: typeof uploadBackupPlan;
  readonly commitBackupPlan: typeof commitBackupPlan;
  readonly formatByteSize: typeof formatByteSize;
  readonly skipOversizedFiles: typeof skipOversizedFiles;
  readonly siteBackupDatabasePath: string;
  readonly siteBackupScopes: readonly SiteBackupScope[];
  readonly cancelled: Parameters<typeof uploadBackupPlan>[0]["cancelled"];
}

export interface SiteBackupRepositoryPlanContent {
  readonly target?: { kind: "repository" }; readonly credentialLabel: string; readonly owner: string; readonly repo: string; readonly folder: string; readonly commitMessage: string;
  readonly repository: BackupRepositoryState; readonly include: SiteBackupInclude;
  readonly database: { bytes: Buffer; watermarkAtCapture: number } | null; readonly files: readonly PlannedDiskFile[];
  readonly skipped: readonly SkippedSiteBackupFile[]; readonly scopeNotes: Partial<Record<SiteBackupScope, string>>;
  readonly totalBytes: number; readonly site: { name: string; folderName: string }; readonly schema: { index: number; tag: string }; readonly createdAt: string;
  readonly credentialWarnings?: readonly CredentialWarning[];
}

export type SiteBackupPlan<TContent extends SiteBackupRepositoryPlanContent = SiteBackupRepositoryPlanContent> = BaseBackupPlan<TContent>;

/** Every refusal both tools return, as `{code, message}`. */
export interface Refusal {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

async function requireBackupPermissions<TSource extends SiteBackupSources, TContent extends SiteBackupRepositoryPlanContent, TRequest extends SiteBackupRequestDeps<TSource, TContent>>(deps: SiteBackupToolDeps<TSource, TContent, TRequest>, ctx: SiteBackupCall): Promise<void> {
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.request.authorize }), workspaceId: deps.request.workspaceId, principalId: ctx.principal.id, permission: PUSH_PERMISSION }, { entityType: DOMAIN });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.request.authorize }), workspaceId: deps.request.workspaceId, principalId: ctx.principal.id, permission: CREDENTIAL_WRITE_PERMISSION }, { entityType: "custom-credentials" });
}

const UNAVAILABLE: Refusal = { ok: false, code: "UNAVAILABLE", message: "site backup is not available in this runtime: it has no site folder on disk" };

/**
 * The plan (`site_backup_plan` and `POST …/site-backups/plan`): every check that can fail, in the order that wastes the least — validate, permissions,
 * credential, repository (so a public repository is refused before a snapshot is taken), database
 * snapshot, disk files, limits — then the in-memory plan.
 *
 * @complexity O(site files) for the walk, O(database size) for the snapshot, four GETs.
 */
export async function planSiteBackup<TSource extends SiteBackupSources, TContent extends SiteBackupRepositoryPlanContent, TRequest extends SiteBackupRequestDeps<TSource, TContent>>(required: { deps: SiteBackupToolDeps<TSource, TContent, TRequest>; call: SiteBackupCall }, _optional: Record<string, never> = {}): Promise<unknown> {
  const { deps, call: ctx } = required;
  const input = parsePlanInput({ deps: deps.deps, rawInput: ctx.input, SITE_BACKUP_SCOPES: deps.siteBackupScopes });
  await requireBackupPermissions(deps, ctx);
  const sources = deps.request.siteBackupSources;
  if (!sources) return { planned: false, code: UNAVAILABLE.code, message: UNAVAILABLE.message };

  const credential = await resolveBackupCredential({ deps, requested: input.credential });
  if (!credential.ok) return { planned: false, code: credential.code, message: credential.message };

  const folderName = deps.siteFolderName({ siteDir: sources.siteDir });
  const folder = input.folder ?? deps.deps.normalizeWriteFilePath({ rawPath: folderName });
  const { owner, repo: repoName } = deps.validateRepositoryTarget({ owner: input.owner, repo: input.repo }, { ...(credential.provider.validateTarget === undefined ? {} : { validateTarget: credential.provider.validateTarget }) });
  requireUnreservedFolder({ deps: deps.deps, folder, provider: credential.provider });
  const target = backupTarget({ deps: deps.deps, credential, owner, repo: repoName });
  const repo = await inspect({ deps, provider: credential.provider, toolId: PLAN_TOOL_ID, input: { ...target, ...(input.branch !== undefined ? { branch: input.branch } : {}), folder } });
  if (!repo.ok) return { planned: false, code: repo.code, message: repo.message };

  const prepared = await prepareContent({ deps, sources, include: input.include, host: credential.provider });
  if (!prepared.ok) return { planned: false, code: prepared.code, message: prepared.message };

  return planResult(await savePlan({ deps, ctx, sources, input, folderName, content: { credentialLabel: credential.label, owner, repo: repoName, folder, repository: repo.state, ...prepared.content } }), deps);
}

// ---------------------------------------------------------------------------
// site_backup_push
// ---------------------------------------------------------------------------

export type PushResult =
  | { pushed: true; commitSha: string; commitUrl: string; repository: string; branch: string; folder: string; filesWritten: number; totalBytes: number; credentialWarnings?: readonly CredentialWarning[] }
  | { pushed: false; cancelled: true }
  | { pushed: false; cancelled: false; reason: "expired" | "abandoned" }
  | { pushed: false; cancelled: false; inProgress: true; planId: string; progress: SiteBackupPushProgress; message: string }
  | { pushed: false; cancelled: false; code: string; message: string };

/**
 * The push (`site_backup_push` and `POST …/site-backups/push`): consume the principal-bound plan and start its job — or, for a planId whose job is
 * still running, wait on that job — then report its outcome or its progress.
 *
 * @complexity O(1) plan and job lookup; then see {@link pushPlannedBackup}.
 */
export async function pushSiteBackup<TSource extends SiteBackupSources, TContent extends SiteBackupRepositoryPlanContent, TRequest extends SiteBackupRequestDeps<TSource, TContent>>(
  required: { deps: SiteBackupToolDeps<TSource, TContent, TRequest>; call: SiteBackupCall },
  optional: { waitMs?: number } = {}
): Promise<PushResult> {
  const { deps, call: ctx } = required;
  const planId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "planId" });
  await requireBackupPermissions(deps, ctx);
  if (ctx.signal.aborted) return { pushed: false, cancelled: false, reason: "abandoned" };

  const jobs = deps.request.siteBackupPushJobs ?? deps.siteBackupPushJobs;
  const key = { planId, principalId: ctx.principal.id, workspaceId: deps.request.workspaceId };
  let job = jobs.find(key);
  if (!job) {
    const taken = (deps.request.siteBackupPlanStore ?? deps.siteBackupPlanStore).take(key);
    if (!taken.ok) return { pushed: false, cancelled: false, code: taken.code, message: PLAN_TAKE_MESSAGES[taken.code] };
    job = jobs.start({ key, progress: deps.initialPushProgress({ plan: taken.plan }), run: ({ signal, progress }) => runObservedBackupPush({ deps, plan: taken.plan, run: { signal, progress } }) });
  }

  const waited = await jobs.wait({ job, signal: ctx.signal, budgetMs: pushWaitBudget({ deps, waitMs: optional.waitMs }) });
  if (waited.state === "done") return waited.result;
  if (waited.state === "abandoned") return { pushed: false, cancelled: false, reason: "abandoned" };
  return inProgressResult({ formatByteSize: deps.formatByteSize, planId, progress: waited.progress, elapsedMs: waited.elapsedMs });
}

export function createSiteBackupService<TSource extends SiteBackupSources, TContent extends SiteBackupRepositoryPlanContent, TRequest extends SiteBackupRequestDeps<TSource, TContent> = SiteBackupRequestDeps<TSource, TContent>>(required: Omit<SiteBackupToolDeps<TSource, TContent, TRequest>, "request" | "siteBackupPushJobs"> & {
  createSiteBackupPushJobs: () => SiteBackupPushJobs<PushResult>;
}, _optional: Record<string, never> = {}) {
  const siteBackupPushJobs = required.createSiteBackupPushJobs();
  return {
    planSiteBackup: ({ deps, call }: { deps: TRequest; call: SiteBackupCall }, options: Record<string, never> = {}) => planSiteBackup({ deps: { ...required, request: deps, siteBackupPushJobs }, call }, options),
    pushSiteBackup: ({ deps, call }: { deps: TRequest; call: SiteBackupCall }, options: { waitMs?: number } = {}) => pushSiteBackup({ deps: { ...required, request: deps, siteBackupPushJobs }, call }, options),
  };
}
