import { randomUUID } from "node:crypto";
import type { SealedSecret } from "@jini-ai/core/contracts/vault";
import type { CredentialWarning } from "./credential-warnings.js";
import { SiteShareExportFailure, type SiteShareExportStep } from "./share-export-failure.js";
import { SiteBackupPushJobs, type PushJobKey, type PushJobWait, type SiteBackupPushProgress } from "../push-jobs.js";
import type { StaticSitePorts, StaticSiteCopy } from "./static-copy.js";
import { isShareExpired, isShareExpiryChoice, shareExpiresAt, type ShareExpiryHost } from "./share-expiry.js";
import type { StaticExportOptions } from "./static-export-selection.js";
import { SAVED_KEYS_PATH, type SiteSavedKeysPort } from "./saved-keys-port.js";
import { SiteShareRefusal } from "./share-refusal.js";

/** One share row as the host's private registry stores it. */
export interface SiteShareRecord {
  readonly shareId: string;
  readonly token: string;
  readonly site: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly url: string | null;
  readonly status: "active" | "revoked" | "failed" | "expired";
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly hasEncryptedKeys?: boolean;
  readonly sealedPassword?: SealedSecret;
  readonly notices?: readonly string[];
  readonly credentialWarnings?: readonly CredentialWarning[];
  readonly needsAcknowledgement?: boolean;
  readonly notes?: readonly string[];
  readonly storage?: { readonly provider: string; readonly key: string; readonly url?: string; readonly binding?: string };
  readonly expiresAt?: string | null;
}
/** The registry reads the backend performs itself; writes happen inside the host's share service. */
export interface SiteShareRegistryLike {
  get(required: { site: string; shareId: string }): Promise<SiteShareRecord | undefined>;
  list(required: { site: string }): Promise<readonly SiteShareRecord[]>;
}
/** The prepared backup fields the backend reads; the host's plan type carries more and is passed through. */
export interface SiteShareContent {
  readonly files: readonly unknown[];
  readonly bufferedFiles?: readonly { readonly path: string }[];
  readonly encryptedKeys?: unknown;
  readonly sealedPassword?: unknown;
  readonly notices?: readonly string[];
  readonly credentialWarnings?: readonly CredentialWarning[];
  readonly scopeNotes: Readonly<Record<string, string>>;
  readonly totalBytes: number;
  readonly site: { readonly folderName: string };
}
type CapturedCopy = Exclude<StaticSiteCopy, { reason: string }>;
type ZipProgressOptions = { signal?: AbortSignal; progress?: SiteBackupPushProgress; notices?: string[]; credentialWarnings?: CredentialWarning[] };
type ShareOptions = { delivery?: unknown; expiresAt?: string | null; signal?: AbortSignal; filename?: string; identity?: { shareId: string; token: string }; sealedPassword?: unknown; notices?: readonly string[]; notes?: readonly string[]; credentialWarnings?: readonly CredentialWarning[] };

/** Host collaborators, policy and copy. Every member is REQUIRED: the engine carries no host defaults.
 * Archive, delivery and zip values are opaque here; they only travel between host collaborators.
 */
export interface SiteShareHost {
  /** Redacts secret shapes from exporter-facing text (scope notes). */
  redact(required: { text: string }): { text: string };
  /** Host failures that already carry a closed status contract and must pass through unwrapped. */
  isClosedFailure(required: { cause: unknown }): boolean;
  /** The theme id meaning "theme off". */
  readonly noThemeId: string;
  /** Message for a ZIP-only share (no delivery target configured). */
  readonly zipOnlyMessage: string;
  downloadUrl(required: { site: string; shareId: string }): string;
  appVersionOf(required: { content: SiteShareContent }): string | undefined;
  checkShareLimits(required: { files: readonly { path: string; bytes: number }[] }): void;
  newShareIdentity(required: Record<string, never>): { shareId: string; token: string };
  allocateStaticExportThemes(required: { themeIds: readonly string[]; siteSlug: string }): readonly unknown[];
  parseStaticExportInput(required: { input: unknown }): { themeIds?: readonly string[]; publicUrl?: string };
  captureStaticSite(ports: StaticSitePorts, optional: { themeId?: string | undefined; publicUrl?: string | undefined }): Promise<StaticSiteCopy>;
  buildShareZip(required: { plan: SiteShareContent; zip: unknown }, optional: ZipProgressOptions): Promise<Buffer>;
  buildStaticSiteZip(required: { copy: CapturedCopy; copies: readonly CapturedCopy[]; activeThemeId: string; themes: readonly unknown[]; zip: unknown }, optional: ZipProgressOptions): Promise<Buffer>;
  createSiteShare(required: { registry: SiteShareRegistryLike; site: string; name: string; archive: Buffer }, optional: ShareOptions): Promise<SiteShareRecord>;
  acknowledgeSiteShare(required: { registry: SiteShareRegistryLike; site: string; shareId: string }, optional: { delivery?: unknown }): Promise<SiteShareRecord>;
  revokeSiteShare(required: { registry: SiteShareRegistryLike; site: string; shareId: string }, optional: { delivery?: unknown }): Promise<SiteShareRecord>;
  isOwnShareFolder(required: { storage: { provider: string; binding?: string } }): boolean;
  /** The delivery provider id meaning "this server's own share folder". */
  readonly ownFolderProvider: string;
  /** Expiry choices, refusal copy and the expired-link message (owner policy and wording stay host-side). */
  readonly expiry: ShareExpiryHost;
}

export interface SiteShareBackend {
  readonly registry: SiteShareRegistryLike;
  /** Current export/upload lifecycle, independent of polling and retained finished job records. */
  hasWork?(required: Record<string, never>, optional?: Record<string, never>): boolean;
  staticOptions(required: Record<string, never>, optional?: Record<string, never>): Promise<StaticExportOptions>;
  create(required: { principalId: string; jobId?: string; signal: AbortSignal; includeSavedKeys?: boolean; expiresInDays?: number | null; format?: "static"; themeIds?: readonly string[]; publicUrl?: string }, optional?: { waitMs?: number }): Promise<unknown>;
  acknowledge(required: { shareId: string }, optional?: Record<string, never>): Promise<SiteShareView>;
  revealPassword(required: { principalId: string; shareId: string }, optional?: Record<string, never>): Promise<{ password: string }>;
  list(required: Record<string, never>, optional?: Record<string, never>): Promise<readonly SiteShareView[]>;
  revoke(required: { shareId: string }, optional?: Record<string, never>): Promise<SiteShareView>;
  /** Day choices a new export may ask for besides Never; empty unless new exports land in the own share folder. */
  expiryChoices(required: Record<string, never>, optional?: Record<string, never>): Promise<readonly number[]>;
}
export type SiteShareView = Omit<SiteShareRecord, "token" | "storage" | "sealedPassword"> & { downloadUrl: string; credentialWarnings: readonly CredentialWarning[]; needsAcknowledgement: boolean };
/** A finished export, with what was left out of it (the share's scope notes) for the exporter only. */
type ExportedShare = SiteShareRecord & { readonly notes?: readonly string[] };

const DOMAINLESS_DISCOVERY_NOTICE = "No domain was given, so sitemap.xml and feed.xml were left out.";

/** Keep closed refusals' class/status contracts; wrap only unexpected export exceptions. */
function exportFailure({ cause, step, appVersion, jiniVersion, time, host }: { cause: unknown; step: SiteShareExportStep; appVersion: string | undefined; jiniVersion: string | undefined; time: string; host: SiteShareHost }, _options = {}): unknown {
  if (cause instanceof SiteShareRefusal || host.isClosedFailure({ cause })) return cause;
  return new SiteShareExportFailure({ step, cause, time, ...(appVersion ? { appVersion } : {}), ...(jiniVersion ? { jiniVersion } : {}) });
}

/** Run one export lifecycle, preserving stage evidence and releasing the site lane on every exit.
 * Metadata is read at the failure boundary so it includes the stage and prepared app version.
 * @throws Closed share refusals unchanged, otherwise SiteShareExportFailure with the original cause.
 * @complexity The supplied bounded export plus O(1) stage metadata; no additional I/O.
 */
async function runExportStage({ execute, diagnostic, release }: {
  execute: () => Promise<ExportedShare>;
  diagnostic: () => Omit<Parameters<typeof exportFailure>[0], "cause">;
  release: () => void;
}, _options = {}): Promise<ExportedShare> {
  try { return await execute(); }
  catch (cause) {
    // Preserve closed refusals and their status/recovery contracts for both HTTP and tools.
    throw exportFailure({ cause, ...diagnostic() });
  } finally { release(); }
}

/** Locators/tokens stay in the private registry. The authorized caller receives the verified URL. */
function view(row: SiteShareRecord, host: SiteShareHost): SiteShareView {
  const { token: _token, storage: _storage, sealedPassword: _sealedPassword, ...publicFields } = row;
  return { ...publicFields, credentialWarnings: row.credentialWarnings ?? [], needsAcknowledgement: row.needsAcknowledgement ?? false, downloadUrl: host.downloadUrl({ site: row.site, shareId: row.shareId }) };
}

/** What a create caller sees for one wait: the finished share, a cancellation, or in-flight progress. */
function createOutcome(required: { waited: PushJobWait<ExportedShare>; jobId: string; format?: "static" | undefined; host: SiteShareHost }, _options = {}): unknown {
  const { waited, host } = required;
  if (waited.state === "done") {
    if (required.format === "static") return { ...view(waited.result, host), message: (waited.result.notices?.includes(DOMAINLESS_DISCOVERY_NOTICE) ? DOMAINLESS_DISCOVERY_NOTICE + " " : "") + "Extract the ZIP, then open index.html inside the extracted folder in your browser; it lists every exported theme and page. No local server is needed to view the exported pages. README.txt lists features that need a server." };
    return { ...view(waited.result, host), ...(waited.result.url ? {} : { message: host.zipOnlyMessage }) };
  }
  if (waited.state === "abandoned") throw new SiteShareRefusal({ code: "CANCELLED", message: "Share export was cancelled." });
  return { jobId: required.jobId, phase: waited.progress.filesTotal ? "archive-or-upload" : "preparing", progress: waited.progress };
}

/** Use the same full-roster allocation for options and the archive, including deselected aliases.
 * With the theme off, offer only the current unstyled site.
 */
function staticRoster({ ports, context, host }: { ports: StaticSitePorts; context: Awaited<ReturnType<StaticSitePorts["context"]>>; host: SiteShareHost }, _options = {}) {
  const activeThemeId = context.themeId ?? context.theme;
  const roster = activeThemeId === host.noThemeId ? [{ themeId: host.noThemeId, title: context.theme }]
    : ports.themes?.().map(theme => ({ ...theme })) ?? [{ themeId: activeThemeId, title: context.theme }];
  return { activeThemeId, roster, themes: host.allocateStaticExportThemes({ themeIds: roster.map(theme => theme.themeId), siteSlug: context.slug }) };
}

/** Release repeated public-media buffers before the next render, using the layout's URL identity.
 * Mutates job-owned file entries so each capture retains the first media bytes, just as packaging does.
 * @throws SiteShareRefusal as soon as retained unique files/bytes exceed the existing share caps.
 * @complexity O(files × retained files) for the existing limit policy, bounded to 2,000 unique files.
 */
function retainStaticCapture({ copy, media, sizes, host }: { copy: CapturedCopy; media: Map<string, Buffer>; sizes: { path: string; bytes: number }[]; host: SiteShareHost }, _options = {}): void {
  for (const file of copy.files) {
    const shared = file.path.startsWith("m/");
    const existing = shared ? media.get(file.path) : undefined;
    if (existing) { file.content = existing; continue; }
    sizes.push({ path: file.path, bytes: file.content.length });
    host.checkShareLimits({ files: sizes });
    if (shared) media.set(file.path, file.content);
  }
}

/** Snapshot selection/active identity/time once; isolate and clean each sequential capture.
 * @throws SiteShareRefusal for unknown selections or any unusable selected capture.
 * @complexity O(selected export bytes + retained files² + roster sorting); sequential under the job deadline.
 */
async function captureSelection({ ports, themeIds, signal, publicUrl, host }: { ports: StaticSitePorts; themeIds?: readonly string[] | undefined; publicUrl?: string | undefined; signal: AbortSignal; host: SiteShareHost }, _options = {}) {
  const context = await ports.context(), instant = ports.now();
  const { roster, themes, activeThemeId } = staticRoster({ ports, context, host });
  const selected = themeIds ?? [activeThemeId];
  const installed = new Map(roster.map(theme => [theme.themeId, theme]));
  if (selected.some(id => !installed.has(id))) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "Every selected theme must be installed and valid." });
  const copies: CapturedCopy[] = [];
  const media = new Map<string, Buffer>(), sizes: { path: string; bytes: number }[] = [];
  for (const themeId of selected) {
    signal.throwIfAborted();
    const theme = installed.get(themeId);
    if (theme === undefined) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: `Selected theme '${themeId}' is not installed.` });
    const copy = await host.captureStaticSite({ ...ports, now: () => instant, context: async () => ({ ...context, themeId, theme: theme.title }) }, { themeId, publicUrl });
    if ("reason" in copy) throw new SiteShareRefusal({ code: "UNAVAILABLE", message: `${themeId}: ${copy.reason}` });
    retainStaticCapture({ copy, media, sizes, host });
    copies.push(copy);
  }
  signal.throwIfAborted();
  const copy = copies[0];
  if (copy === undefined) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "Select at least one theme to share." });
  return { copy, copies, activeThemeId, themes };
}

/** Retired option fails closed for internal callers as well as HTTP. */
/** Retired payloads cannot be published even if a stale preparation adapter returns one. */
function requireCredentialFreeExport({ content }: { content: SiteShareContent }): void {
  const hasKeyFile = content.bufferedFiles?.some(file => file.path === SAVED_KEYS_PATH);
  if (content.encryptedKeys || content.sealedPassword || hasKeyFile) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "Exports no longer include saved keys. Update the export adapter and create this export again." });
}

function requireNoShareCredentialWarnings({ credentialWarnings }: { credentialWarnings: readonly CredentialWarning[] }): void {
  if (credentialWarnings.length > 0) throw new SiteShareRefusal({ code: "UNSAFE_FILE", message: "The export contains files with possible credentials. Remove the credentials and export again." });
}

/** What the factory needs: the site's ports plus the REQUIRED host collaborators/policy/copy. */
export type SiteShareBackendRequired = {
  registry: SiteShareRegistryLike;
  site: string;
  prepare: (required: { signal: AbortSignal; includeSavedKeys?: boolean; shareId: string; workspaceId: string }) => Promise<SiteShareContent>;
  zip: unknown;
  delivery: (required: { provider?: string | undefined; binding?: string | undefined }) => Promise<unknown>;
  ownerPrincipalId?: PromiseLike<string> | string;
  savedKeys?: Pick<SiteSavedKeysPort, "reveal">;
  staticSite?: StaticSitePorts;
  host: SiteShareHost;
};
export type SiteShareBackendOptional = { now?: () => number; appVersion?: string; jiniVersion?: string };
/** What every share operation reads: the ports, the job table, and the one-at-a-time lane (`lane.active`). */
type ShareBackendContext = { required: SiteShareBackendRequired; jobs: SiteBackupPushJobs<ExportedShare>; lane: { active: string | null }; now: () => number; boundaryVersion: string | undefined; jiniVersion: string | undefined };
type ShareExportInput = { signal: AbortSignal; progress: SiteBackupPushProgress; expiresAt: string | null; format?: "static" | undefined; themeIds?: readonly string[] | undefined; publicUrl?: string | undefined; includeSavedKeys?: boolean | undefined };
type ShareExportStage = { step: SiteShareExportStep; appVersion: string | undefined };

/** The static-site flavour of an export: capture the selected themes, archive and deliver them. */
async function exportStaticShare({ ctx, input, bounded, stage }: { ctx: ShareBackendContext; input: ShareExportInput; bounded: AbortSignal; stage: ShareExportStage }): Promise<ExportedShare> {
  const { required } = ctx, { host } = required;
  if (!required.staticSite) throw new SiteShareRefusal({ code: "UNAVAILABLE", message: "Static exporter is unavailable in this context." });
  const selection = await captureSelection({ ports: required.staticSite, themeIds: input.themeIds, publicUrl: input.publicUrl, signal: bounded, host });
  const { copy } = selection;
  const notices: string[] = copy.publicOrigin ? [] : [DOMAINLESS_DISCOVERY_NOTICE];
  const credentialWarnings: CredentialWarning[] = [];
  stage.step = "archive";
  const archive = await host.buildStaticSiteZip({ ...selection, zip: required.zip }, { signal: bounded, progress: input.progress, notices, credentialWarnings });
  stage.step = "delivery";
  return await host.createSiteShare({ registry: required.registry, site: required.site, name: copy.filename, archive }, { signal: bounded, filename: copy.filename, expiresAt: input.expiresAt, notices, credentialWarnings });
}

/** The full-backup flavour of an export: prepare the content, archive and deliver it. */
async function exportBackupShare({ ctx, input, bounded, stage }: { ctx: ShareBackendContext; input: ShareExportInput; bounded: AbortSignal; stage: ShareExportStage }): Promise<ExportedShare> {
  const { required } = ctx, { host } = required;
  const { progress } = input;
  const identity = host.newShareIdentity({});
  const content = await required.prepare({ signal: bounded, shareId: identity.shareId, workspaceId: required.site });
  stage.appVersion = host.appVersionOf({ content });
  requireCredentialFreeExport({ content });
  const notices = [...new Set(content.notices ?? [])];
  const credentialWarnings = [...(content.credentialWarnings ?? [])];
  const notes = Object.values(content.scopeNotes).map(note => host.redact({ text: note }).text);
  // Progress's readonly totals describe the prepared backup; the ZIP collector records its exact files.
  Object.assign(progress, { filesTotal: content.files.length + (content.bufferedFiles?.length ?? 0) + 1, bytesTotal: content.totalBytes });
  stage.step = "archive";
  const archive = await host.buildShareZip({ plan: content, zip: required.zip }, { signal: bounded, progress, notices, credentialWarnings });
  stage.step = "delivery";
  const delivery = await required.delivery({});
  bounded.throwIfAborted();
  if (delivery) requireNoShareCredentialWarnings({ credentialWarnings });
  const record = await host.createSiteShare({ registry: required.registry, site: required.site, name: content.site.folderName, archive }, { delivery, expiresAt: input.expiresAt, signal: bounded, identity, sealedPassword: content.sealedPassword, notices, notes, credentialWarnings });
  // Plugins left out of the archive are told to the exporter, never dropped silently.
  return notes.length > 0 ? { ...record, notes } : record;
}

/** Prepares, archives and delivers one share under a ten-minute bound; always frees the site's lane. */
async function exportShare({ ctx, input }: { ctx: ShareBackendContext; input: ShareExportInput }, _options = {}): Promise<ExportedShare> {
  const stage: ShareExportStage = { step: "prepare", appVersion: ctx.boundaryVersion };
  return runExportStage({ execute: async () => {
    const bounded = AbortSignal.any([input.signal, AbortSignal.timeout(10 * 60 * 1000)]);
    return input.format === "static" ? exportStaticShare({ ctx, input, bounded, stage }) : exportBackupShare({ ctx, input, bounded, stage });
  }, diagnostic: () => ({ ...stage, jiniVersion: ctx.jiniVersion, time: new Date(ctx.now()).toISOString(), host: ctx.required.host }), release: () => { ctx.lane.active = null; } });
}

/** Starts a new export job, refusing a resume of an unknown job and a second export on this site. */
function startExport({ ctx, startRequired }: { ctx: ShareBackendContext; startRequired: { key: PushJobKey; resumedJobId: string | undefined; expiresAt: string | null; format?: "static" | undefined; themeIds?: readonly string[] | undefined; publicUrl?: string | undefined; includeSavedKeys?: boolean | undefined } }, _options = {}) {
  const { key } = startRequired;
  if (startRequired.resumedJobId) throw new SiteShareRefusal({ code: "JOB_NOT_FOUND", message: "Share job expired or belongs to another principal. Create a new export." });
  if (ctx.lane.active) throw new SiteShareRefusal({ code: "BUSY", message: "Another share export is running for this site. Wait for it to finish." });
  ctx.lane.active = key.planId;
  return ctx.jobs.start({ key, progress: { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 }, run: ({ signal, progress }) => exportShare({ ctx, input: { signal, progress, expiresAt: startRequired.expiresAt, format: startRequired.format, themeIds: startRequired.themeIds, publicUrl: startRequired.publicUrl, includeSavedKeys: startRequired.includeSavedKeys } }) });
}

async function staticShareOptions({ ctx }: { ctx: ShareBackendContext }, _options = {}): Promise<StaticExportOptions> {
  const { required } = ctx, { host } = required;
  if (!required.staticSite) throw new SiteShareRefusal({ code: "UNAVAILABLE", message: "Static exporter is unavailable in this context." });
  const { activeThemeId, roster } = staticRoster({ ports: required.staticSite, context: await required.staticSite.context(), host });
  return { activeThemeId, themes: activeThemeId === host.noThemeId ? [{ themeId: host.noThemeId, name: "Current site" }]
    : roster.map(theme => ({ themeId: theme.themeId, name: theme.title })) };
}

type ShareCreateInput = Parameters<SiteShareBackend["create"]>[0];
type ExpiryDestination = { provider: string; binding?: string };

/**
 * The new export's `expiresAt`, validated before any job starts so an unsupported choice or a
 * destination this server does not host is refused up front, never silently made Never. The
 * destination is resolved only for a supported date: a static export has none (no own-folder row).
 */
async function newShareExpiry({ ctx, input }: { ctx: ShareBackendContext; input: ShareCreateInput }, _optional = {}): Promise<string | null> {
  const { host } = ctx.required;
  const days = input.expiresInDays ?? null;
  const destination = isShareExpiryChoice({ days, choices: host.expiry.choices }) && input.format !== "static" ? await ctx.required.delivery({}) as ExpiryDestination | undefined : undefined;
  return shareExpiresAt({ days, now: ctx.now(), destination, expiry: host.expiry, ownFolderProvider: host.ownFolderProvider, isOwnFolder: own => host.isOwnShareFolder(own) });
}

/**
 * The day choices the admin may offer for the next export: all of them while new exports land in this
 * server's own share folder (the only place a date is enforced), none otherwise. A failed destination
 * lookup answers none instead of failing: Never is accepted everywhere, and create still resolves the
 * destination itself and refuses a date in plain words. @complexity One delivery lookup.
 */
async function currentExpiryChoices({ ctx }: { ctx: ShareBackendContext }, _optional = {}): Promise<readonly number[]> {
  let destination: ExpiryDestination | undefined;
  try { destination = await ctx.required.delivery({}) as ExpiryDestination | undefined; }
  catch { return []; }
  return destination && ctx.required.host.isOwnShareFolder({ storage: destination }) ? ctx.required.host.expiry.choices : [];
}

async function createShare({ ctx, input, options }: { ctx: ShareBackendContext; input: ShareCreateInput; options: { waitMs?: number } }, _optional = {}): Promise<unknown> {
  const { required, jobs } = ctx;
  input.signal.throwIfAborted();
  const selection = input.format === "static" ? required.host.parseStaticExportInput({ input: { jobId: input.jobId, themeIds: input.themeIds, publicUrl: input.publicUrl } }) : {};
  const jobId = input.jobId ?? randomUUID();
  const key = { planId: jobId, principalId: input.principalId, workspaceId: required.site + (input.format === "static" ? "/static" : "") };
  const job = jobs.find(key) ?? startExport({ ctx, startRequired: { key, resumedJobId: input.jobId, expiresAt: await newShareExpiry({ ctx, input }), format: input.format, themeIds: selection.themeIds, publicUrl: selection.publicUrl, includeSavedKeys: input.includeSavedKeys } });
  const waited = await jobs.wait({ job, signal: input.signal, budgetMs: options.waitMs ?? 1500 });
  const outcome = waited.state === "done" ? { ...waited, result: await required.registry.get({ site: required.site, shareId: waited.result.shareId }) ?? waited.result } : waited;
  return createOutcome({ waited: outcome, jobId, format: input.format, host: required.host });
}

async function acknowledgeShare({ ctx, shareId }: { ctx: ShareBackendContext; shareId: string }, _optional = {}): Promise<SiteShareView> {
  const { required, lane } = ctx;
  if (lane.active) throw new SiteShareRefusal({ code: "BUSY", message: "Export acknowledgement is waiting for another export or delivery. Retry when it finishes." });
  lane.active = shareId;
  try {
    const row = await required.registry.get({ site: required.site, shareId });
    if (!row || row.status === "revoked") throw new SiteShareRefusal({ code: "NOT_FOUND", message: "This export is missing or was revoked." });
    if (row.status === "expired") throw new SiteShareRefusal({ code: "EXPIRED", message: required.host.expiry.expiredMessage({ row }) });
    const delivery = row.needsAcknowledgement && row.storage && !row.credentialWarnings?.length ? await required.delivery({ provider: row.storage.provider, binding: row.storage.binding }) : undefined;
    return view(await required.host.acknowledgeSiteShare({ registry: required.registry, site: required.site, shareId }, { delivery }), required.host);
  } finally { lane.active = null; }
}

async function revealSharePassword({ ctx, input }: { ctx: ShareBackendContext; input: { principalId: string; shareId: string } }, _optional = {}): Promise<{ password: string }> {
  const { required } = ctx;
  if (input.principalId !== await required.ownerPrincipalId) throw new SiteShareRefusal({ code: "FORBIDDEN", message: "Only the site owner can reveal an export password." });
  const row = await required.registry.get({ site: required.site, shareId: input.shareId });
  if (!row?.hasEncryptedKeys || !row.sealedPassword || row.status === "revoked") throw new SiteShareRefusal({ code: "NOT_FOUND", message: "Export password not found for this site." });
  // An ended share stays ended for its secret too: a retention tombstone OR a passed `expiresAt` (before the sweep runs).
  if (row.status === "expired" || isShareExpired({ row, now: ctx.now() })) throw new SiteShareRefusal({ code: "EXPIRED", message: required.host.expiry.expiredMessage({ row }) });
  if (!required.savedKeys) throw new SiteShareRefusal({ code: "UNAVAILABLE", message: "Saved keys are unavailable." });
  return required.savedKeys.reveal({ sealedPassword: row.sealedPassword, shareId: row.shareId, workspaceId: required.site });
}

async function revokeShare({ ctx, shareId }: { ctx: ShareBackendContext; shareId: string }, _optional = {}): Promise<SiteShareView> {
  const { required } = ctx, { host } = required;
  const row = await required.registry.get({ site: required.site, shareId });
  if (!row) throw new SiteShareRefusal({ code: "NOT_FOUND", message: "Share not found for this site." });
  let delivery: unknown;
  // Resolution failure must not prevent revoke's own disable-first/delete-local sequence.
  if (row.storage && !host.isOwnShareFolder({ storage: row.storage })) {
    try { delivery = await required.delivery({ provider: row.storage.provider, binding: row.storage.binding }); }
    catch { /* revokeSiteShare disables locally before reporting the missing remote store. */ }
  }
  return view(await host.revokeSiteShare({ registry: required.registry, site: required.site, shareId }, { delivery }), host);
}

/** Reuses backup jobs and the common backup plan content. Only one bounded, buffered preparation runs per site at a time.
 * Optional host clock/build versions stamp failures when they occur, before a later poll collects them.
 * @complexity The existing bounded export work; diagnostics add only job-local metadata, with no I/O.
 */
export function createSiteShareBackend(required: SiteShareBackendRequired, { now = Date.now, appVersion: boundaryVersion, jiniVersion }: SiteShareBackendOptional = {}): SiteShareBackend {
  const ctx: ShareBackendContext = { required, jobs: new SiteBackupPushJobs<ExportedShare>({}, { now }), lane: { active: null }, now, boundaryVersion, jiniVersion };
  return {
    registry: required.registry,
    hasWork: () => ctx.lane.active !== null,
    staticOptions: () => staticShareOptions({ ctx }),
    create: (input, options = {}) => createShare({ ctx, input, options }),
    acknowledge: (input) => acknowledgeShare({ ctx, shareId: input.shareId }),
    revealPassword: (input) => revealSharePassword({ ctx, input }),
    list: async () => (await required.registry.list({ site: required.site })).map(row => view(row, required.host)),
    revoke: (input) => revokeShare({ ctx, shareId: input.shareId }),
    expiryChoices: () => currentExpiryChoices({ ctx }),
  };
}
