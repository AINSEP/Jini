import { requireInputRecord } from "@jini-ai/core";



import type { SourceControlProvider } from "../../source-control/site/provider-module.js";
import { findReservedPath } from "../../source-control/registry.js";

import { SiteShareRefusal } from "./share-refusal.js";

import type { SiteBackupScope, SiteBackupSources, SiteBackupHostLimit, SiteBackupInclude } from "./sources.js";
import type { CredentialWarning } from "./credential-warnings.js";

import { PLAN_TOOL_ID, type SiteBackupCall, type SiteBackupToolDeps, type SiteBackupPlan, type Refusal, logFailureDetail } from "./backup-service.js";

/** The restore-point name the database snapshot is captured under, so an orphan is recognizable. */
const SNAPSHOT_SCOPE_ID = "site-backup";

// ---------------------------------------------------------------------------
// site_backup_plan
// ---------------------------------------------------------------------------

interface ParsedPlanInput {
  readonly credential: string | undefined;
  /** Checked against the host's rules once the credential names it ({@link validateRepositoryTarget}). */
  readonly owner: unknown;
  readonly repo: unknown;
  readonly branch: string | undefined;
  readonly folder: string | undefined;
  readonly include: SiteBackupInclude;
  readonly commitMessage: string | undefined;
}

function optionalString({ raw, field, deps }: { deps: SiteBackupToolDeps["deps"]; raw: Record<string, unknown>; field: string }, _optional: Record<string, never> = {}): string | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new deps.CustomCredentialValidationError(`'${field}' must be a string`);
  return value;
}

/** Every switch defaults to true; anything but a boolean for a known scope is refused. */
function parseInclude({ value, SITE_BACKUP_SCOPES, deps }: { deps: SiteBackupToolDeps["deps"]; value: unknown; SITE_BACKUP_SCOPES: readonly SiteBackupScope[] }, _optional: Record<string, never> = {}): SiteBackupInclude {
  if (value === undefined) return { database: true, media: true, themes: true, plugins: true, settings: true };
  const include = readIncludeSwitches({ deps, raw: requireIncludeRecord({ deps, value, SITE_BACKUP_SCOPES }), SITE_BACKUP_SCOPES });
  if (!SITE_BACKUP_SCOPES.some((scope) => include[scope])) throw new deps.CustomCredentialValidationError("'include' switches everything off; there would be nothing to back up");
  return include;
}

/** The `include` object itself: a plain object whose keys are all known scopes. */
function requireIncludeRecord(required: { deps: SiteBackupToolDeps["deps"]; value: unknown; SITE_BACKUP_SCOPES: readonly SiteBackupScope[] }): Record<string, unknown> {
  const { deps, value, SITE_BACKUP_SCOPES } = required;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new deps.CustomCredentialValidationError("'include' must be an object of true/false switches");
  const raw = value as Record<string, unknown>;
  const unknownKeys = Object.keys(raw).filter((key) => !(SITE_BACKUP_SCOPES as readonly string[]).includes(key));
  if (unknownKeys.length > 0) throw new deps.CustomCredentialValidationError(`'include' has unknown switch(es): ${unknownKeys.join(", ")} (known: ${SITE_BACKUP_SCOPES.join(", ")})`);
  return raw;
}

/** Each scope's switch, true when absent; a non-boolean is refused by name. */
function readIncludeSwitches(required: { deps: SiteBackupToolDeps["deps"]; raw: Record<string, unknown>; SITE_BACKUP_SCOPES: readonly SiteBackupScope[] }): SiteBackupInclude {
  const { deps, SITE_BACKUP_SCOPES } = required;
  const include = {} as Record<(typeof SITE_BACKUP_SCOPES)[number], boolean>;
  for (const scope of SITE_BACKUP_SCOPES) {
    const flag = required.raw[scope];
    if (flag !== undefined && typeof flag !== "boolean") throw new deps.CustomCredentialValidationError(`'include.${scope}' must be true or false`);
    include[scope] = flag ?? true;
  }
  return include;
}

/** The backup folder: repository-relative, never `.git`. The host's own reserved folders
 *  ({@link requireUnreservedFolder}) are checked once the credential names the host. */
function parseFolder({ raw, deps }: { deps: SiteBackupToolDeps["deps"]; raw: string | undefined }, _optional: Record<string, never> = {}): string | undefined {
  if (raw === undefined) return undefined;
  return deps.normalizeWriteFilePath({ rawPath: raw });
}

/**
 * Refuses a backup folder inside one the host reserves (`SourceControlHostFacts.reservedPaths`; the
 * `github` plugin declares `.github`, where GitHub runs workflows from). Before any network call.
 *
 * @throws {CustomCredentialValidationError} naming the reserved folder.
 * @complexity O(r) reserved paths.
 */
export function requireUnreservedFolder({ folder, provider, deps }: { deps: SiteBackupToolDeps["deps"]; folder: string; provider: SourceControlProvider }, _optional: Record<string, never> = {}): void {
  const reserved = findReservedPath({ folder }, provider.reservedPaths === undefined ? {} : { reservedPaths: provider.reservedPaths });
  if (reserved !== undefined) throw new deps.CustomCredentialValidationError(`the backup folder must not be inside '${reserved}': '${folder}'`);
}

/** @throws {CustomCredentialValidationError} Any malformed field — before any permission check,
 *  decrypt or network call. Owner and repo are the host's to judge, after the credential is resolved. */
export function parsePlanInput({ rawInput, SITE_BACKUP_SCOPES, deps }: { deps: SiteBackupToolDeps["deps"]; rawInput: unknown; SITE_BACKUP_SCOPES: readonly SiteBackupScope[] }, _optional: Record<string, never> = {}): ParsedPlanInput {
  const raw = requireInputRecord({ input: rawInput });
  const branch = optionalString({ deps, raw, field: "branch" });
  const commitMessage = optionalString({ deps, raw, field: "commitMessage" });
  return {
    credential: optionalString({ deps, raw, field: "credential" }),
    owner: raw.owner,
    repo: raw.repo,
    branch: branch === undefined ? undefined : deps.validateBranch({ value: branch }),
    folder: parseFolder({ deps, raw: optionalString({ deps, raw, field: "folder" }) }),
    include: parseInclude({ deps, value: raw.include, SITE_BACKUP_SCOPES }),
    commitMessage: commitMessage === undefined ? undefined : deps.validateCommitMessage({ value: commitMessage }),
  };
}

/** What the plan tool returns on success: every fact the human should see before confirming. */
export function planResult(plan: SiteBackupPlan, deps: SiteBackupToolDeps): Record<string, unknown> {
  const files = [...(plan.database ? [{ path: deps.siteBackupDatabasePath, bytes: plan.database.bytes.length }] : []), ...plan.files.map((file) => ({ path: file.path, bytes: file.bytes }))];
  return {
    planned: true,
    planId: plan.planId,
    expiresAt: new Date(plan.expiresAtMs).toISOString(),
    credential: plan.credentialLabel,
    repository: `${plan.owner}/${plan.repo}`,
    visibility: "private",
    branch: plan.repository.branch,
    folder: plan.folder,
    folderExists: plan.repository.folderExists,
    include: plan.include,
    fileCount: files.length,
    totalBytes: plan.totalBytes,
    totalSize: deps.formatByteSize({ bytes: plan.totalBytes }),
    files,
    skipped: plan.skipped,
    credentialWarnings: plan.credentialWarnings ?? [],
    notes: deps.siteBackupScopes.flatMap((scope) => (plan.scopeNotes[scope] ? [plan.scopeNotes[scope]] : [])),
    nextStep: deps.planNextStep({ plan, files }),
  };
}

/**
 * Stores the checked plan under the caller's principal: stamps its creation time, the site's name,
 * schema and version, and the default commit message when none was given.
 */
export async function savePlan(required: {
  deps: SiteBackupToolDeps;
  ctx: SiteBackupCall;
  sources: SiteBackupSources;
  input: ParsedPlanInput;
  folderName: string;
  content: Pick<SiteBackupPlan, "credentialLabel" | "owner" | "repo" | "folder" | "repository"> & PreparedContent;
}): Promise<SiteBackupPlan> {
  const { deps, input, content } = required;
  const createdAt = deps.siteBackupNow().toISOString();
  const siteName = await deps.readSiteName({ siteDir: required.sources.siteDir });
  return deps.siteBackupPlanStore.save({
    principalId: required.ctx.principal.id,
    workspaceId: deps.workspaceId,
    content: {
      target: { kind: "repository" },
      credentialLabel: content.credentialLabel,
      owner: content.owner,
      repo: content.repo,
      folder: content.folder,
      commitMessage: input.commitMessage ?? deps.defaultCommitMessage({ siteName, createdAt }),
      repository: content.repository,
      include: input.include,
      database: content.database,
      files: content.files,
      credentialWarnings: content.credentialWarnings ?? [],
      skipped: content.skipped,
      scopeNotes: content.scopeNotes,
      totalBytes: content.totalBytes,
      site: { name: siteName, folderName: required.folderName },
      schema: deps.runtimeSchemaVersion(),
      ...deps.planVersion,
      createdAt,
    },
  });
}

type PreparedContent = Pick<SiteBackupPlan, "database" | "files" | "skipped" | "scopeNotes" | "totalBytes" | "credentialWarnings">;

/**
 * The database a backup uploads: the snapshot rebuilt through the share projection.
 * Why: the raw snapshot holds password hashes, sessions, magic-link tokens and sealed vault rows
 * (security review SEC-1). Deleting rows would leave them in free pages, so the backup is a NEW
 * database built by the same policy as share/export (owner decision 2026-10-26: one policy, never
 * a second backup-only scrub). A share refusal (unknown populated table) is
 * the plan's refusal.
 *
 * @complexity O(database size).
 */
async function captureBackupDatabase(required: { deps: SiteBackupToolDeps }): Promise<{ ok: true; database: NonNullable<PreparedContent["database"]>; credentialWarnings: readonly CredentialWarning[] } | Refusal> {
  const { deps } = required;
  const snapshot = await deps.captureDatabaseSnapshot({ dbOps: deps.dbOps, scopeId: SNAPSHOT_SCOPE_ID });
  if (!snapshot.ok) {
    logFailureDetail({ deps, toolId: PLAN_TOOL_ID, failure: { code: "database-snapshot", ...(snapshot.logDetail !== undefined ? { logDetail: snapshot.logDetail } : {}) } });
    return { ok: false, code: "DATABASE_SNAPSHOT_FAILED", message: snapshot.message };
  }
  try {
    const projected = await deps.siteBackupSanitize({ snapshot: snapshot.bytes });
    return { ok: true, database: { bytes: projected.bytes, watermarkAtCapture: snapshot.watermarkAtCapture }, credentialWarnings: projected.credentialWarnings ?? [] };
  } catch (err) {
    if (err instanceof SiteShareRefusal) return { ok: false, code: err.code, message: err.message };
    throw err;
  }
}

/**
 * The bytes a plan holds: the sanitized database (when included), the disk files, and the limit
 * check over both, so the limits measure the uploaded bytes.
 *
 * @complexity O(database size + site files).
 */
export async function prepareContent({ deps, sources, include, host }: { deps: SiteBackupToolDeps; sources: SiteBackupSources; include: SiteBackupInclude; host: SiteBackupHostLimit }, _options = {}): Promise<{ ok: true; content: PreparedContent } | Refusal> {
  let database: PreparedContent["database"] = null;
  const credentialWarnings: CredentialWarning[] = [];
  if (include.database) {
    const captured = await captureBackupDatabase({ deps });
    if (!captured.ok) return captured;
    database = captured.database;
    credentialWarnings.push(...captured.credentialWarnings);
  }
  const collected = await deps.collectSiteBackupFiles({ sources, include });
  const fitting = deps.skipOversizedFiles({ files: collected.files, host });
  const limits = deps.checkSiteBackupLimits({ files: [...(database ? [{ path: deps.siteBackupDatabasePath, bytes: database.bytes.length }] : []), ...fitting.files], host });
  if (!limits.ok) return { ok: false, code: "LIMIT_EXCEEDED", message: limits.message };
  for (const file of fitting.files) {
    const loaded = await deps.readPlannedFile(file);
    if (!loaded.ok) return { ok: false, code: "PLAN_STALE", message: loaded.message };
    deps.requireShareSecretFree({ path: file.path, bytes: loaded.bytes }, { credentialWarnings });
  }
  return { ok: true, content: { database, credentialWarnings, files: fitting.files, skipped: [...collected.skipped, ...fitting.skipped], scopeNotes: collected.scopeNotes, totalBytes: limits.totalBytes } };
}