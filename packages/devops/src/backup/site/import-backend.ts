import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentPluginArchiveReaderPort } from "@jini-ai/core/contracts/site/agent-plugins-lifecycle";
import type { CreateSiteResult, SiteCreationAllocation } from "@jini-ai/core/contracts/site/platform-site-dir";
import type { CredentialWarning } from "./credential-warnings.js";
import { importSourceDigest, withoutQuery, type SiteImportRegistry, type SiteImportRecord } from "./import-registry.js";
import type { SiteImportProjection, VerifiedSiteImport } from "./import-verifier.js";
import { SiteShareRefusal } from "./share-refusal.js";
import {
  consumeUpload, deadlineSignal, downloadShareArchive, importSiteSlug, parseImportInput, reconcileInterruptedImports, refusal,
  requireFreeSpace, requireOwnerSetup, requireStagingBudget, siteImportView, startImportedSite,
  type ImportHttpClient, type ParsedSiteImportInput, type SiteImportSource, type SiteImportStepsHost, type SiteImportView,
} from "./import-backend-steps.js";

export type { SiteImportSource, SiteImportView } from "./import-backend-steps.js";
export interface SiteImportBackend {
  upload(required: { principalId: string; archive: Buffer }, optional?: Record<string, never>): Promise<{ uploadId: string }>;
  importBackup(required: { principalId: string; source: SiteImportSource; displayName?: string; requestId?: string }, optional?: { signal?: AbortSignal }): Promise<SiteImportView>;
  completeOwner(required: { principalId: string; importId: string; adminPassword: unknown; savedKeysPassword?: unknown }, optional?: { signal?: AbortSignal }): Promise<SiteImportView>;
  list(required: { principalId: string }, optional?: Record<string, never>): Promise<SiteImportView[]>;
  get(required: { principalId: string; importId: string }, optional?: Record<string, never>): SiteImportView;
  /** Settles interrupted imports and removes expired or orphaned payloads, with no import to start. */
  tidy(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
}


/** Source union is enforced at every remote boundary; server paths are never accepted. */
export function parseSiteImportInput(required: { input: unknown }, _options: Record<string, never> = {}): ParsedSiteImportInput {
  return parseImportInput(required);
}

/** The slice of the host's sites workspace the engine reads itself; the rest is only handed back to the host. */
export interface SiteImportWorkspace { home(required: Record<string, never>): string }

/** The database sanitizer an archive's snapshot is rebuilt through before anything is staged. */
export type SiteImportSanitizer = (required: { snapshot: Buffer }, optional: { signal?: AbortSignal | undefined }) => Promise<SiteImportProjection>;

/** The extra options the engine hands the host's site-creation function; `W` is the host workspace handle. */
export interface SiteImportCreateOptions<W> {
  workspace: W;
  collisionSafe: true;
  onAllocated(allocation: SiteCreationAllocation, optional?: Record<string, never>): void;
  beforeRegister(): void;
  verifiedRestore: { signal: AbortSignal; restore(required: { dir: string; dbPath: string; siteId: string }): Promise<void> };
}
/** The host's site-creation function: allocate, restore the verified stage and register one new site. */
export type SiteImportCreateSite<W> = (required: { name: string; displayName: string; adminPassword: string }, optional: Readonly<Record<string, unknown>> & SiteImportCreateOptions<W>) => Promise<CreateSiteResult>;

/** Host collaborators, policy and copy. Every member is REQUIRED: the engine carries no host defaults. */
export interface SiteImportHost<W extends SiteImportWorkspace = SiteImportWorkspace> extends SiteImportStepsHost<W> {
  /** Verifies a share ZIP against the host's archive inventory, path mapping and limits. */
  verifySiteImport(required: { archive: Buffer; reader: AgentPluginArchiveReaderPort; sanitize: SiteImportSanitizer; schema: { index: number; tag: string } }, optional: { signal?: AbortSignal }): Promise<VerifiedSiteImport & { credentialWarnings: readonly CredentialWarning[] }>;
  /** Persists verified, freshly projected data into the private stage at `root`. */
  stageVerifiedImport(required: { root: string; verified: VerifiedSiteImport }, optional?: Record<string, never>): void;
  /** The notices recorded while staging the archive at `root`. */
  stagedImportWarnings(required: { root: string }, optional?: Record<string, never>): string[];
  /** The new-site owner password the request supplies, or the host's development default when it supplies none. */
  resolveNewSiteAdminPassword(required: { adminPassword?: unknown }, optional?: Record<string, never>): string;
  /** Removes expired or orphaned import databases. */
  tidyImportDatabases(required: Record<string, never>, optional?: Record<string, never>): Promise<void>;
}

/** Everything `createSiteImportBackend` needs: the host ports, plus the host collaborators in `host`. */
export type SiteImportBackendRequired<W extends SiteImportWorkspace> = {
  registry: SiteImportRegistry; workspace: W; reader: AgentPluginArchiveReaderPort; http: ImportHttpClient;
  sanitize: SiteImportSanitizer; schema: { index: number; tag: string };
  startSite: (required: { name: string }) => Promise<{ adminUrl: string | null; status: string }>;
  tracker?: Tracker;
  createSite: SiteImportCreateSite<W>;
  restoreStagedImport: (required: { root: string; dir: string; dbPath: string; siteId: string }, optional?: { pluginSourceRoot?: string; savedKeysPassword?: string | undefined; signal?: AbortSignal }) => Promise<void>;
  /** Route prefix the owner-setup link is built under. */
  setupBase: string;
  creationOptions?: Readonly<Record<string, unknown>> | undefined;
  host: SiteImportHost<W>;
};
/** Optional overrides and observers for `createSiteImportBackend`. */
export type SiteImportBackendOptional<W extends SiteImportWorkspace> = {
  createSite?: SiteImportCreateSite<W>;
  report?: (required: { importId: string; status: string }) => void;
};

/** The ports and bookkeeping every import step shares; `exclusive` allows one import at a time. */
type ImportBackendContext<W extends SiteImportWorkspace> = {
  required: SiteImportBackendRequired<W>; optional: SiteImportBackendOptional<W>; registry: SiteImportRegistry; workspace: W; host: SiteImportHost<W>;
  view: (row: SiteImportRecord) => SiteImportView; put: (row: SiteImportRecord) => void;
  exclusive: <T>(input: { run: () => Promise<T> }, optional?: Record<string, never>) => Promise<T>;
};

function createImportContext<W extends SiteImportWorkspace>({ required, optional }: { required: SiteImportBackendRequired<W>; optional: SiteImportBackendOptional<W> }): ImportBackendContext<W> {
  const { registry, workspace, host } = required;
  const view = (row: SiteImportRecord): SiteImportView => {
    const warnings = host.stagedImportWarnings({ root: registry.stagePath(row) });
    return { ...siteImportView({ row, setupBase: required.setupBase }), ...(warnings.length ? { warnings } : {}) };
  };
  const put = (row: SiteImportRecord) => { registry.put({ row }); optional.report?.({ importId: row.importId, status: row.status }); };
  let active = false;
  const exclusive = async <T>({ run }: { run: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> => {
    if (active) refusal({ code: "BUSY", message: "Another import is running. Retry after it finishes." });
    active = true;
    try { return await registry.exclusive({ run: async () => { await reconcileInterruptedImports({ registry, workspace, put, host }); return run(); } }); } finally { active = false; }
  };
  return { required, optional, registry, workspace, host, view, put, exclusive };
}

/** Reads or downloads the archive; records the consumed upload before reading so it is always removed. */
async function fetchArchive<W extends SiteImportWorkspace>({ ctx, input }: { ctx: ImportBackendContext<W>; input: { parsed: ParsedSiteImportInput; principalId: string; importId: string; signal: AbortSignal; consumed: (required: { uploadId: string }, optional?: Record<string, never>) => void } }): Promise<Buffer> {
  const { source } = input.parsed;
  if ("url" in source) { input.signal.throwIfAborted(); return downloadShareArchive({ http: ctx.required.http, url: source.url, signal: input.signal, host: ctx.host }); }
  const uploadId = consumeUpload({ registry: ctx.registry, uploadId: source.uploadId, principalId: input.principalId, importId: input.importId });
  input.consumed({ uploadId });
  input.signal.throwIfAborted();
  return fs.readFileSync(ctx.registry.uploadPath({ uploadId }));
}


/** Verify, stage and mark the row pending owner setup; any failure removes the stage and records why. */
async function verifyAndStage<W extends SiteImportWorkspace>({ ctx, input }: { ctx: ImportBackendContext<W>; input: { row: SiteImportRecord; parsed: ParsedSiteImportInput; signal: AbortSignal } }): Promise<SiteImportView> {
  let consumedUpload: string | undefined;
  let row = input.row;
  try {
    const archive = await fetchArchive({ ctx, input: { parsed: input.parsed, principalId: input.row.principalId, importId: input.row.importId, signal: input.signal, consumed: ({ uploadId }, _optional = {}) => { consumedUpload = uploadId; } } });
    const verified = await ctx.host.verifySiteImport({ archive, reader: ctx.required.reader, sanitize: ctx.required.sanitize, schema: ctx.required.schema }, { signal: input.signal });
    input.signal.throwIfAborted();
    ctx.host.stageVerifiedImport({ root: ctx.registry.stagePath(input.row), verified });
    row = { ...row, displayName: input.parsed.displayName ?? verified.name, status: "needs-owner", hasEncryptedKeys: Boolean(verified.encryptedKeys), credentialWarnings: verified.credentialWarnings ?? [], warnings: ctx.host.stagedImportWarnings({ root: ctx.registry.stagePath(row) }) };
    ctx.put(row);
    return ctx.view(row);
  } catch (error) {
    fs.rmSync(ctx.registry.stagePath(row), { recursive: true, force: true });
    ctx.put({ ...row, status: "failed", error: error instanceof SiteShareRefusal ? error.message : "Archive verification failed. No site was created." });
    throw error;
  } finally { if (consumedUpload) fs.rmSync(ctx.registry.uploadPath({ uploadId: consumedUpload }), { force: true }); }
}


/** Creates the site from the stage; a failure rolls the row back to failed and removes the stage. */
async function createImportedSite<W extends SiteImportWorkspace>({ ctx, input }: { ctx: ImportBackendContext<W>; input: { row: SiteImportRecord; adminPassword: string; savedKeysPassword?: string | undefined; signal: AbortSignal } }): Promise<{ row: SiteImportRecord; created: CreateSiteResult }> {
  const { signal } = input;
  let row = input.row;
  try {
    const created = await (ctx.optional.createSite ?? ctx.required.createSite)({ name: importSiteSlug({ displayName: row.displayName, host: ctx.host }), displayName: row.displayName, adminPassword: input.adminPassword }, { ...ctx.required.creationOptions, workspace: ctx.workspace, collisionSafe: true,
      onAllocated: (allocation, _optional = {}) => {
        signal.throwIfAborted();
        // Persist idempotency before shared registration. A ctx.registry failure is still inside
        // createSite's compensation boundary, so a new site's identity never gets lost.
        row = { ...row, creation: allocation, newSiteId: allocation.siteId, newSiteName: allocation.name };
        ctx.put(row);
      },
      beforeRegister: () => { signal.throwIfAborted(); },
      verifiedRestore: { signal, restore: async ({ dir, dbPath, siteId }) => {
        signal.throwIfAborted();
        await ctx.required.restoreStagedImport({ root: ctx.registry.stagePath(row), dir, dbPath, siteId }, { savedKeysPassword: input.savedKeysPassword, signal });
        row = { ...row, warnings: ctx.host.stagedImportWarnings({ root: ctx.registry.stagePath(row) }) };
        ctx.put(row);
      } },
    });
    return { row, created };
  } catch (error) {
    fs.rmSync(ctx.registry.stagePath(row), { recursive: true, force: true });
    ctx.put({ ...row, newSiteId: null, newSiteName: null, status: "failed", error: "Site creation failed and was rolled back. Import the archive again." });
    throw error;
  }
}

async function uploadImportArchive<W extends SiteImportWorkspace>({ ctx, input }: { ctx: ImportBackendContext<W>; input: { principalId: string; archive: Buffer } }): Promise<{ uploadId: string }> {
  return ctx.exclusive({ run: async () => {
    requireStagingBudget({ registry: ctx.registry, host: ctx.host });
    if (!Buffer.isBuffer(input.archive) || input.archive.length > ctx.host.maxArchiveBytes) refusal({ code: "LIMIT_EXCEEDED", message: ctx.host.copy.uploadTooLarge });
    const uploadId = randomUUID();
    try {
      fs.writeFileSync(ctx.registry.uploadPath({ uploadId }), input.archive, { flag: "wx", mode: 0o600 });
      ctx.registry.saveUpload({ row: { uploadId, principalId: input.principalId, createdAt: Date.now() } });
      return { uploadId };
    } catch (error) { fs.rmSync(ctx.registry.uploadPath({ uploadId }), { force: true }); throw error; }
  } });
}

function traced<T, W extends SiteImportWorkspace>({ ctx, name, run }: { ctx: ImportBackendContext<W>; name: string; run: () => Promise<T> }, _optional = {}): Promise<T> {
  return ctx.required.tracker ? ctx.required.tracker.trace({ name, run }) : run();
}

async function startImportFromSource<W extends SiteImportWorkspace>({ ctx, input, options }: { ctx: ImportBackendContext<W>; input: { principalId: string; source: SiteImportSource; displayName?: string; requestId?: string }; options: { signal?: AbortSignal } }): Promise<SiteImportView> {
  const parsed = parseSiteImportInput({ input: { ...input.source, displayName: input.displayName, requestId: input.requestId } });
  return ctx.exclusive({ run: async () => {
    ctx.registry.expire({});
    const existing = parsed.requestId ? ctx.registry.list(input).find(row => row.requestId === parsed.requestId) : undefined;
    if (existing) {
      const sameSource = existing.sourceDigest !== undefined
        ? existing.sourceDigest === importSourceDigest({ source: parsed.source })
        : JSON.stringify(withoutQuery({ source: existing.source })) === JSON.stringify(withoutQuery({ source: parsed.source }));
      if (!sameSource) refusal({ code: "REQUEST_CONFLICT", message: "requestId already belongs to another source." });
      return ctx.view(existing);
    }
    if ("url" in parsed.source) requireStagingBudget({ registry: ctx.registry, host: ctx.host });
    const row: SiteImportRecord = { importId: randomUUID(), principalId: input.principalId, requestId: parsed.requestId, source: parsed.source, sourceDigest: importSourceDigest({ source: parsed.source }), displayName: parsed.displayName ?? "Imported site", newSiteId: null, newSiteName: null, status: "verifying", createdAt: new Date().toISOString(), expiresAt: Date.now() + 3600_000 };
    ctx.put(row);
    return traced({ ctx, name: "site.import.verify", run: () => verifyAndStage({ ctx, input: { row, parsed, signal: deadlineSignal({ timeoutMs: 5 * 60_000 }, options) } }) });
  } });
}

async function completeImportOwner<W extends SiteImportWorkspace>({ ctx, input, options }: { ctx: ImportBackendContext<W>; input: { principalId: string; importId: string; adminPassword: unknown; savedKeysPassword?: unknown }; options: { signal?: AbortSignal } }): Promise<SiteImportView> {
  const signal = deadlineSignal({ timeoutMs: 120_000 }, options);
  return ctx.exclusive({ run: async () => {
    ctx.registry.expire({});
    const pending = ctx.registry.get(input);
    if (pending.status === "ready") return ctx.view(pending);
    requireOwnerSetup({ row: pending, adminPassword: input.adminPassword, host: ctx.host });
    const adminPassword = ctx.host.resolveNewSiteAdminPassword({ adminPassword: input.adminPassword });
    if (input.savedKeysPassword !== undefined && (typeof input.savedKeysPassword !== "string" || input.savedKeysPassword.length > 1024)) refusal({ code: "INVALID_INPUT", message: "Saved keys password must be text of at most 1024 characters." });
    const home = ctx.workspace.home({});
    try {
      requireFreeSpace({ dir: fs.existsSync(home) ? home : path.dirname(home), message: ctx.host.copy.homeSpace, maxExpandedBytes: ctx.host.maxExpandedBytes });
      signal.throwIfAborted();
    } catch (error) {
      // No site exists yet (low space, or the desktop app quitting): the verified copy must not wait out its hour.
      fs.rmSync(ctx.registry.stagePath(pending), { recursive: true, force: true });
      ctx.put({ ...pending, status: "failed", error: signal.aborted ? "The import was stopped. No site was created. Import the archive again." : "There is not enough free disk space. No site was created. Free up space and import the archive again." });
      throw error;
    }
    const creating: SiteImportRecord = { ...pending, status: "creating" }; ctx.put(creating);
    const { row: allocated, created } = await traced({ ctx, name: "site.import.restore", run: () => createImportedSite({ ctx, input: { row: creating, adminPassword, savedKeysPassword: input.savedKeysPassword as string | undefined, signal } }) });
    // Owner and restore are committed. A supervisor failure must not repeat site creation.
    const ready: SiteImportRecord = { ...allocated, newSiteId: created.siteId, newSiteName: created.name, status: "ready" };
    ctx.put(ready);
    void ctx.required.tracker?.capture({ name: "site_imported", userId: ready.principalId }, { properties: { targetSiteId: created.siteId, operationId: ready.importId, eventId: `import:${ready.importId}`, source: "admin" } });
    fs.rmSync(ctx.registry.stagePath(ready), { recursive: true, force: true });
    const started = await startImportedSite({ row: ready, name: created.name, startSite: ctx.required.startSite, host: ctx.host });
    ctx.put(started);
    return ctx.view(started);
  } });
}

/** Shared HTTP/tool application service. All effects enter as ports; CMS policy stays here.
 * Pending owner setup stores sanitized bytes privately without creating any site directory.
 * @complexity O(archive bytes + registry history), with one buffered job and four staged payloads.
 */
export function createSiteImportBackend<W extends SiteImportWorkspace>(required: SiteImportBackendRequired<W>, optional: SiteImportBackendOptional<W> = {}): SiteImportBackend {
  const ctx = createImportContext({ required, optional });
  const { registry } = ctx;
  return {
    upload: (input) => uploadImportArchive({ ctx, input }),
    importBackup: (input, options = {}) => startImportFromSource({ ctx, input, options }),
    completeOwner: (input, options = {}) => completeImportOwner({ ctx, input, options }),
    async list(input) { return ctx.exclusive({ run: async () => { registry.expire({}); return registry.list(input).map(ctx.view); } }); },
    get(input) { return ctx.view(registry.get(input)); },
    async tidy() { await ctx.exclusive({ run: async () => { registry.expire({}); await ctx.host.tidyImportDatabases({}); } }); },
  };
}
