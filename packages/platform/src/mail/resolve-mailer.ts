/**
 * Explicit lane selection, live credential rotation and cached provider status.
 * Saved keys never select a provider. Local fallback uses the catalog's console provider;
 * production refuses. Host ports retain trusted loading, credential copy and configuration DTOs.
 * capabilities() is synchronous and reports console until transactional resolution settles;
 * sends always await their own lane. Invalidation detaches obsolete work without cancelling it.
 */
import { ToolInputError } from "@jini-ai/core";
import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { DomainRequirement } from "@jini-ai/core/provider-registry";
import type { MailAdapterCredential } from "./adapter-module.js";
import { readMailDomain, type MailDomainReadCredentialPort } from "./domain-read.js";
import type {
  MailCredentialFact, MailCredentialPort, MailProviderCatalog, MailProviderCheck,
  MailProviderConfigurationReport, MailProviderError, MailProviderSettingPort,
  MailStatusReport, SenderDomainVerification, SenderDomainVerificationPort,
} from "./engine-contracts.js";
import { createTtlCache, MAIL_STATUS_TTL_MS } from "./mail-status-cache.js";
import type { MailDeliveryLane, MailerPort } from "./ports.js";
import { credentialSecrets, safeMailProviderText } from "./provider-error.js";
import { computeMailStatus, initialMailProviderSetting, type MailDomainState, type MailProviderCallContext, type MailProviderModule, type MailProviderSetting } from "./provider.js";
import { laneForPurpose } from "./policy.js";
import { createSenderDomainVerification } from "./sender-domain-verification.js";
import type { MailerCapabilities, MailerSendResult } from "./types.js";

/** Required host boundaries. HTTP is passed through unchanged; the engine never calls it. */
export interface ResolveMailerDeps<TRecord extends MailCredentialFact = MailCredentialFact> {
  workspaceId: string;
  mode: "local" | "production";
  providerSetting: MailProviderSettingPort;
  credentials: MailCredentialPort;
  /** Metadata only. Preserve the host's row shape for its projection (e.g. SMTP username presence);
   * the engine only interprets the separate readFact fingerprint. No decryption here. */
  listCredentialFacts: (required: Record<string, never>) => Promise<readonly TRecord[]>;
  loadCatalog: (required: Record<string, never>) => Promise<MailProviderCatalog>;
  httpClient: HttpClientPort;
  /** Host retains provider ABI binding and credential-aware scrubbing of results/throws. */
  createProviderMailer: (required: { provider: MailProviderModule; credential: MailAdapterCredential }) => MailerPort;
  /** Synchronous safe DTO projection; labels, setup forms and product copy stay in the host. */
  describeProviders: (required: { catalog: MailProviderCatalog; records: readonly TRecord[]; setting: MailProviderSetting }) => MailProviderConfigurationReport;
  unconfiguredMessage: (required: { lane: MailDeliveryLane }) => string;
  missingCredentialReason: (required: { label: string }) => string;
  credentialFailureReason: (required: { label: string; err: unknown }) => string;
}

export interface ResolveMailerOptions {
  /** Delivery policy decorator; identity when absent. */
  wrapProviderMailer?: (required: { providerId: string; provider: MailProviderModule; mailer: MailerPort }) => MailerPort;
  readSenderEmail?: () => Promise<string | undefined>;
  resolveDomainReadCredential?: MailDomainReadCredentialPort;
  warn?: (message: string) => void;
  clock?: { nowMs(): number };
  statusTtlMs?: number;
  domainRequirementsTimeoutMs?: number;
}

/** The control surface remains stable across host adoption, including invalidate on setting writes. */
export interface ResolvedMailer {
  /** Safe to use immediately; each send awaits its lane's resolution. */
  mailer: MailerPort;
  /** Resolves once the initial setting + transactional resolution settle (a test seam). */
  ready: Promise<void>;
  /** Refreshes unresolved configuration and awaits the current driver without sending. */
  settle: () => Promise<void>;
  /** Cached briefly; `refresh` rebuilds. Each report carries `checkedAt` and the live `lastError`. */
  status: (optional?: { refresh?: boolean }) => Promise<MailStatusReport>;
  /** The host's safe per-provider configuration DTO. Never a secret. */
  describeProviders: () => Promise<MailProviderConfigurationReport>;
  /** Drops cached provider mailers and the cached status; the next send and read resolve fresh. */
  invalidate: () => void;
  laneReady: (required: { lane: MailDeliveryLane }) => Promise<boolean>;
  senderDomainVerification: SenderDomainVerificationPort;
  /** Whether `id` may be selected: a registered hosted provider whose saved key resolves. Sends nothing. */
  checkProvider: (required: { id: string }) => Promise<MailProviderCheck>;
  /** Null for another workspace, absent sender/provider/key or unsupported verification.
   * Provider failures throw caller-safe ToolInputError; the deadline throws Error. */
  domainRequirements: (required: { workspaceId: string }) => Promise<DomainRequirement | null>;
}

type ResolvedEntry = { mailer: MailerPort; label?: string; fingerprint: string };
type RecordError = (error: Omit<MailProviderError, "at">) => void;
type CredentialLookup = { credential: MailAdapterCredential; reason?: undefined } | { credential?: undefined; reason: string };
interface ResolverState {
  deps: Omit<ResolveMailerDeps, "listCredentialFacts" | "describeProviders">;
  options: ResolveMailerOptions;
  nowMs: () => number;
  warn: (message: string) => void;
  wrap: NonNullable<ResolveMailerOptions["wrapProviderMailer"]>;
  resolved: Map<string, ResolvedEntry>;
  inFlight: Map<string, Promise<MailerPort>>;
  warned: Set<string>;
  generation: number;
  initialization: Promise<MailProviderSetting> | undefined;
  lastTransactional: MailerPort | undefined;
  lastError: MailProviderError | undefined;
}

const CONSOLE_CAPABILITIES: MailerCapabilities = { driver: "console", supportsIdempotencyKey: false, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: true };

/** Metadata identifies the exact saved version without decryption. @complexity O(1). */
function rowFingerprint(record: MailCredentialFact | undefined): string {
  return record ? `${record.id}:${record.vaultRevision ?? ""}:${record.updatedAt}` : "absent";
}

/** Any failed recipient wins; only a wholly accepted, nonempty operation clears a send failure.
 * Results and exceptions pass through unchanged. @complexity O(messages) time, O(1) space. */
function observeFailures(required: { mailer: MailerPort; providerId: string; record: RecordError; accepted: () => void }): MailerPort {
  const { mailer, providerId, record, accepted } = required;
  const seen = (results: readonly MailerSendResult[]): void => {
    const failure = results.find(result => !result.ok);
    if (failure && !failure.ok) { record({ providerId, source: "send", code: failure.errorCode, message: failure.message }); return; }
    if (results.length > 0) accepted();
  };
  return {
    capabilities: () => mailer.capabilities({}),
    send: async (input, options) => { const result = await mailer.send(input, options); seen([result]); return result; },
    sendBatch: async (input, options) => { const results = await mailer.sendBatch(input, options); seen(results); return results; },
  };
}

/** Refusals report console so availability checks never mistake them for delivery. @complexity O(messages) for batches. */
function refusingMailer(required: { errorCode: string; message: string }): MailerPort {
  const result: MailerSendResult = { ok: false, retryable: false, errorCode: required.errorCode, message: required.message };
  return { capabilities: () => CONSOLE_CAPABILITIES, send: async () => result, sendBatch: async ({ messages }) => messages.map(() => result) };
}

/** Diagnostic sinks cannot throw across the mail boundary; production warns once per reason. */
function warnOnce({ state, key, message }: { state: ResolverState; key: string; message: string }): void {
  if (state.deps.mode !== "production" || state.warned.has(key)) return;
  state.warned.add(key);
  try { state.warn(message); } catch { /* Diagnostics cannot reject a send. */ }
}

/** Never retain provider/body details. Repeated checks must not hide a failed send. */
function recordError({ state, error }: { state: ResolverState; error: Omit<MailProviderError, "at"> }): void {
  const { providerId, source } = error;
  if (source === "check" && state.lastError?.source === "send") return;
  state.lastError = { providerId, source, message: source === "send" ? "The provider did not confirm acceptance. Check provider configuration." : "The provider configuration check could not complete.", at: new Date(state.nowMs()).toISOString() };
}

/** First boot remains unconfigured even with saved keys; failed persistence is retried on a later read. */
async function initialize(state: ResolverState): Promise<MailProviderSetting> {
  const setting = initialMailProviderSetting({});
  await state.deps.providerSetting.write({ setting }).catch(() => warnOnce({ state, key: "initialization", message: "[mail] the mail provider setting could not be saved; retrying on the next send" }));
  return setting;
}

/** Only initialization is single-flight: every call still reads the current selection first. */
async function currentSetting(state: ResolverState): Promise<MailProviderSetting> {
  const stored = await state.deps.providerSetting.read({});
  if (stored) return stored;
  state.initialization ??= initialize(state).finally(() => { state.initialization = undefined; });
  return state.initialization;
}

/** Keyless providers never touch the credential metadata store. */
async function fingerprintFor({ state, label }: { state: ResolverState; label: string | undefined }): Promise<string> {
  if (label === undefined) return "";
  return rowFingerprint(await state.deps.credentials.readFact({ label }));
}

/** The host catalog guarantees the built-in console provider. Its mailer shares the policy wrapper. */
async function consoleMailer({ state, catalog }: { state: ResolverState; catalog: MailProviderCatalog }): Promise<MailerPort> {
  const provider = catalog.registry.get({ id: "console" })!.provider;
  const mailer = state.wrap({ providerId: "console", provider, mailer: state.deps.createProviderMailer({ provider, credential: { token: "" } }) });
  state.resolved.set("console", { mailer, fingerprint: "" });
  return mailer;
}

/** Local mode keeps working through console; production refuses and logs safe host copy once. */
async function fallback(required: { state: ResolverState; catalog: MailProviderCatalog; errorCode: string; message: string }): Promise<MailerPort> {
  const { state } = required;
  if (state.deps.mode !== "production") return state.resolved.get("console")?.mailer ?? consoleMailer(required);
  warnOnce({ state, key: required.errorCode + required.message, message: required.message });
  return refusingMailer(required);
}

/** A missing key or failed decrypt uses the host's established caller-safe refusal wording. */
async function credentialOrReason({ state, catalog, id, label }: { state: ResolverState; catalog: MailProviderCatalog; id: string; label: string }): Promise<CredentialLookup> {
  try {
    const credential = await state.deps.credentials.resolve({ catalog, id });
    if (credential) return { credential };
  } catch (err) { return { reason: state.deps.credentialFailureReason({ label, err }) }; }
  return { reason: state.deps.missingCredentialReason({ label }) };
}

/** A catalog label means a saved key is required; keyless providers receive an empty token. */
function providerCredential({ state, catalog, id }: { state: ResolverState; catalog: MailProviderCatalog; id: string }): Promise<CredentialLookup> {
  const label = catalog.credentialLabelFor({ id });
  return label === undefined ? Promise.resolve({ credential: { token: "" } }) : credentialOrReason({ state, catalog, id, label });
}

/** Preserve provider selection refusals, including the catalog's trusted plugin-load diagnostics. */
function unavailable(required: { state: ResolverState; catalog: MailProviderCatalog; id: string; detail: string }): Promise<MailerPort> {
  return fallback({ ...required, errorCode: "MAIL_PROVIDER_UNAVAILABLE", message: `[mail] the selected mail provider '${required.id}' ${required.detail}, so outbound mail is NOT being sent` });
}

/** A successful operation only clears a failure from the same provider. */
function acceptProvider({ state, id }: { state: ResolverState; id: string }): void {
  if (state.lastError?.source === "send" && state.lastError.providerId === id) state.lastError = undefined;
}

/** Construct only after metadata/key/metadata agree; a generation change prevents caching obsolete work.
 * @complexity One catalog load, two metadata reads and one decrypt per attempt; races retry in order. */
async function resolveProvider({ state, id, startedIn }: { state: ResolverState; id: string; startedIn: number }): Promise<MailerPort> {
  const catalog = await state.deps.loadCatalog({});
  const entry = catalog.registry.get({ id });
  if (!entry) {
    const refusals = catalog.refusals.length > 0 ? ` (${catalog.refusals.join("; ")})` : "";
    return unavailable({ state, catalog, id, detail: `is not installed${refusals}` });
  }
  // Fingerprint BEFORE reading the key: a rotation racing this read then re-resolves next send.
  // An unreadable store leaves key lookup to report why; "unknown" re-resolves once it reads.
  const label = catalog.credentialLabelFor({ id });
  const fingerprint = await fingerprintFor({ state, label }).catch(() => "unknown");
  const found = await providerCredential({ state, catalog, id });
  if (!found.credential) return unavailable({ state, catalog, id, detail: found.reason });
  const credential = found.credential;
  const latest = await fingerprintFor({ state, label }).catch(() => fingerprint);
  if (latest !== fingerprint) return resolveProvider({ state, id, startedIn: state.generation });
  const observed = observeFailures({ mailer: state.deps.createProviderMailer({ provider: entry.provider, credential }), providerId: id,
    record: error => recordError({ state, error }), accepted: () => acceptProvider({ state, id }) });
  const mailer = state.wrap({ providerId: id, provider: entry.provider, mailer: observed });
  if (startedIn === state.generation) state.resolved.set(id, { mailer, fingerprint, ...(label === undefined ? {} : { label }) });
  return mailer;
}

/** Boot and early sends share one resolution per provider. Old completions rejoin the current generation. */
function resolveOnce({ state, id }: { state: ResolverState; id: string }): Promise<MailerPort> {
  const existing = state.inFlight.get(id);
  if (existing) return existing;
  const startedIn = state.generation;
  const started = resolveProvider({ state, id, startedIn }).then(mailer => startedIn === state.generation ? mailer : resolveOnce({ state, id }))
    .finally(() => { if (state.inFlight.get(id) === started) state.inFlight.delete(id); });
  state.inFlight.set(id, started);
  return started;
}

/** Reuse unchanged rows; metadata faults keep a usable cached mailer. @complexity One metadata read per send. */
async function currentMailer({ state, id }: { state: ResolverState; id: string }): Promise<MailerPort> {
  const entry = state.resolved.get(id);
  if (!entry) return resolveOnce({ state, id });
  if (entry.label === undefined) return entry.mailer;
  const fingerprint = await fingerprintFor({ state, label: entry.label }).catch(() => entry.fingerprint);
  if (fingerprint === entry.fingerprint) return entry.mailer;
  if (state.resolved.get(id) === entry) state.resolved.delete(id);
  return resolveOnce({ state, id });
}

/** Fresh lane selection precedes every resolution and updates the synchronous transactional projection. */
async function mailerForLane({ state, lane }: { state: ResolverState; lane: MailDeliveryLane }): Promise<MailerPort> {
  const id = (await currentSetting(state))[lane];
  const mailer = id === null
    ? await fallback({ state, catalog: await state.deps.loadCatalog({}), errorCode: "MAIL_UNCONFIGURED", message: state.deps.unconfiguredMessage({ lane }) })
    : await currentMailer({ state, id });
  if (lane === "transactional") state.lastTransactional = mailer;
  return mailer;
}

/** Settings/catalog faults become a refusal rather than throwing across the routing boundary. */
function forLane(required: { state: ResolverState; lane: MailDeliveryLane }): Promise<MailerPort> {
  return mailerForLane(required).catch(() => refusingMailer({ errorCode: "MAIL_PROVIDER_UNAVAILABLE", message: "Mail provider selection failed; check configuration." }));
}

/** The public mailer preserves synchronous capability reporting and awaits the proper lane for sends. */
function createRouter(state: ResolverState): MailerPort {
  return {
    capabilities: () => {
      if (state.lastTransactional === undefined) void forLane({ state, lane: "transactional" });
      return state.lastTransactional?.capabilities({}) ?? CONSOLE_CAPABILITIES;
    },
    send: async (input, options = {}) => (await forLane({ state, lane: laneForPurpose({ purpose: options.purpose }) })).send(input, options),
    sendBatch: async (input, options = {}) => (await forLane({ state, lane: laneForPurpose({ purpose: options.purpose }) })).sendBatch(input, options),
  };
}

/** Sender settings errors count as unset; parsing retains the original lowercase/trim behavior. */
async function readSenderDomain(state: ResolverState): Promise<string | undefined> {
  const email = await state.options.readSenderEmail?.().catch(() => undefined);
  return email?.split("@")[1]?.trim().toLowerCase() || undefined;
}

/** Domain status shares selection/credentials with delivery, while keeping its own ordered reads. */
function createDomainVerification({ state, resolveDomainReadCredential }: { state: ResolverState; resolveDomainReadCredential: MailDomainReadCredentialPort }): SenderDomainVerificationPort {
  return createSenderDomainVerification({
    workspaceId: state.deps.workspaceId, httpClient: state.deps.httpClient,
    findProvider: async ({ id }) => (await state.deps.loadCatalog({})).registry.get({ id })?.provider,
    resolveCredential: async ({ id }) => state.deps.credentials.resolve({ catalog: await state.deps.loadCatalog({}), id }),
    resolveDomainReadCredential,
    readProviderId: async () => (await currentSetting(state)).transactional,
    readSenderEmail: async () => state.options.readSenderEmail ? state.options.readSenderEmail() : undefined,
  });
}

/** Separate requirements read with permission-only fallback; deadline covers provider calls, not setup.
 * Registry validation guarantees domainRequirements when domainVerification is true.
 * @complexity At most two provider calls; diagnostic output is capped at 1000 characters. */
async function requestDomainRequirements(
  required: { ctx: MailProviderCallContext; providerId: string; provider: MailProviderModule; domain: string; resolveDomainReadCredential: MailDomainReadCredentialPort },
  optional: { timeoutMs?: number | undefined } = {},
): Promise<DomainRequirement> {
  const { ctx, providerId, provider, domain } = required;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("The mail provider could not list its required DNS records.")), optional.timeoutMs ?? 5_000);
  });
  try {
    const result = await Promise.race([readMailDomain({ ctx, providerId, read: context => provider.domainRequirements!(context, { domain }), resolveDomainReadCredential: required.resolveDomainReadCredential }), timeout]);
    if (result.status === "ok") return result.value;
    throw new ToolInputError({ message: safeMailProviderText({ text: `${result.error.code}: ${result.error.message}` }, { secrets: credentialSecrets({ credential: ctx.credential }) }) });
  } finally { clearTimeout(timer); }
}

/** Resolve requirements only for this workspace and its active transactional provider. */
async function domainRequirements(required: { state: ResolverState; workspaceId: string; resolveDomainReadCredential: MailDomainReadCredentialPort }): Promise<DomainRequirement | null> {
  const { state, resolveDomainReadCredential } = required;
  if (required.workspaceId !== state.deps.workspaceId) return null;
  const [setting, catalog, domain] = await Promise.all([currentSetting(state), state.deps.loadCatalog({}), readSenderDomain(state)]);
  const id = setting.transactional;
  const provider = id === null ? undefined : catalog.registry.get({ id })?.provider;
  if (!domain || !provider?.capabilities.domainVerification) return null;
  const { credential } = await providerCredential({ state, catalog, id: id! });
  const ctx = credential ? { workspaceId: state.deps.workspaceId, mode: "live" as const, credential, httpClient: state.deps.httpClient } : null;
  return ctx ? requestDomainRequirements({ ctx, providerId: id!, provider, domain, resolveDomainReadCredential }, { timeoutMs: state.options.domainRequirementsTimeoutMs }) : null;
}

/** Unique lane keys resolve in parallel; each failed lookup records a safe check note. @complexity O(lanes). */
async function laneCredentials(required: { state: ResolverState; catalog: MailProviderCatalog; setting: MailProviderSetting }): Promise<Map<string, MailAdapterCredential>> {
  const { state, catalog, setting } = required;
  const ids = [...new Set([setting.transactional, setting.bulk].filter((id): id is string => id !== null))];
  const lookup = (id: string) => state.deps.credentials.resolve({ catalog, id }).catch((err: unknown) => {
    // Only a provider with a label reaches the store, so a thrown lookup has a defined label.
    recordError({ state, error: { providerId: id, source: "check", message: state.deps.credentialFailureReason({ label: catalog.credentialLabelFor({ id })!, err }) } });
    return null;
  });
  const found = await Promise.all(ids.map(async id => [id, await lookup(id)] as const));
  return new Map(found.filter((pair): pair is readonly [string, MailAdapterCredential] => pair[1] !== null));
}

/** Row-list faults affect presence facts but do not prevent independent key resolution. */
function statusCredentialFacts<TRecord extends MailCredentialFact>({ state, deps }: { state: ResolverState; deps: ResolveMailerDeps<TRecord> }): Promise<readonly TRecord[]> {
  return deps.listCredentialFacts({}).catch((err: unknown) => {
    recordError({ state, error: { providerId: null, source: "check", message: `the saved mail credentials could not be listed (${err instanceof Error ? err.message : String(err)})` } });
    return [];
  });
}

/** Unanswered/unsupported checks produce no sender warning; only no_sender means unset. */
function statusDomainState(state: SenderDomainVerification["state"]): MailDomainState | null | undefined {
  if (state === "no_sender") return null;
  return ["verified", "pending", "failed", "not_found"].includes(state) ? state as MailDomainState : undefined;
}

/** Start independent reads together, then await lane keys and domain verification in that order.
 * Null means no sender; an unanswered check stays undefined and must not claim a sender is missing.
 * @complexity O(c + p) credential facts/providers, O(lanes) decrypts; domain work uses its own deadline. */
async function computeStatusReport<TRecord extends MailCredentialFact>(required: { state: ResolverState; deps: ResolveMailerDeps<TRecord>; senderDomainVerification: SenderDomainVerificationPort }): Promise<MailStatusReport> {
  const { state, deps, senderDomainVerification } = required;
  const checkedAt = new Date(state.nowMs()).toISOString();
  const records = statusCredentialFacts({ state, deps });
  const [setting, catalog, rows] = await Promise.all([currentSetting(state), state.deps.loadCatalog({}), records, readSenderDomain(state)]);
  const credentials = await laneCredentials({ state, catalog, setting });
  const verdict = await senderDomainVerification();
  const domainState = statusDomainState(verdict.state);
  if (verdict.state === "unknown") recordError({ state, error: { providerId: verdict.providerId, source: "check", message: "Provider domain check unavailable." } });
  const status = computeMailStatus({ setting, registry: catalog.registry, hasCredential: id => credentials.has(id) }, domainState === undefined ? {} : { senderDomainState: domainState });
  const { providers } = deps.describeProviders({ catalog, records: rows, setting });
  return { ...status, providers, refusals: catalog.refusals, checkedAt, senderDomainVerification: verdict };
}

/** Failed sends overlay cached status immediately; configuration alone never proves sending. */
function statusWithLastError({ state, report }: { state: ResolverState; report: MailStatusReport }): MailStatusReport {
  const sendFailed = state.lastError?.source === "send" && report.lanes.some(lane => lane.providerId === state.lastError?.providerId);
  return state.lastError ? { ...report, state: sendFailed && report.state === "ready" ? "degraded" : report.state, lastError: state.lastError } : report;
}

/** Host descriptions receive fresh, parallel setting/catalog/metadata reads. Failures propagate. */
async function describeProviders<TRecord extends MailCredentialFact>({ state, deps }: { state: ResolverState; deps: ResolveMailerDeps<TRecord> }): Promise<MailProviderConfigurationReport> {
  const [setting, catalog, records] = await Promise.all([currentSetting(state), state.deps.loadCatalog({}), deps.listCredentialFacts({})]);
  return deps.describeProviders({ catalog, records, setting });
}

/** Selection checks require a hosted provider and a usable key; they send nothing. */
async function checkProvider({ state, id }: { state: ResolverState; id: string }): Promise<MailProviderCheck> {
  const catalog = await state.deps.loadCatalog({});
  const provider = catalog.registry.get({ id })?.provider;
  if (!provider) return { ok: false, reason: `'${id}' is not an installed mail provider (installed: ${catalog.registry.list().map(entry => entry.id).join(", ")})` };
  if (!provider.capabilities.hosted) return { ok: false, reason: `'${id}' only prints mail locally and never delivers it` };
  const found = await providerCredential({ state, catalog, id });
  return found.credential ? { ok: true, label: provider.label } : { ok: false, reason: `'${id}' ${found.reason}` };
}

/** Detach pending work and clear all provider/capability projections; errors retain their original precedence. */
function invalidate(state: ResolverState): void {
  state.generation += 1;
  state.inFlight.clear();
  state.resolved.clear();
  state.lastTransactional = undefined;
}

/**
 * Build a lane router and its control surface. The host binds catalogs, secrets, safe copy and DTOs.
 * Each send reads selection and metadata; boot starts resolution synchronously. Selection faults
 * refuse safely; status/description setup faults propagate and are never cached.
 * @complexity O(providers) cached mailers/flights; status holds one report for its TTL.
 * @example const control = createResolvedMailer(hostPorts, { clock }); await control.ready;
 */
export function createResolvedMailer<TRecord extends MailCredentialFact = MailCredentialFact>(required: ResolveMailerDeps<TRecord>, optional: ResolveMailerOptions = {}): ResolvedMailer {
  const state: ResolverState = { deps: required, options: optional, nowMs: () => (optional.clock ?? { nowMs: () => Date.now() }).nowMs(),
    warn: optional.warn ?? (message => console.warn(message)),
    wrap: optional.wrapProviderMailer ?? (({ mailer }) => mailer), resolved: new Map(), inFlight: new Map(), warned: new Set(), generation: 0,
    initialization: undefined, lastTransactional: undefined, lastError: undefined };
  const ready = forLane({ state, lane: "transactional" }).then(() => undefined);
  const mailer = createRouter(state);
  const resolveDomainReadCredential: MailDomainReadCredentialPort = input => optional.resolveDomainReadCredential?.(input) ?? Promise.resolve(null);
  const senderDomainVerification = createDomainVerification({ state, resolveDomainReadCredential });
  const statusCache = createTtlCache({ load: () => computeStatusReport({ state, deps: required, senderDomainVerification }), ttlMs: optional.statusTtlMs ?? MAIL_STATUS_TTL_MS, nowMs: state.nowMs }, { minRefreshIntervalMs: 5_000 });
  return {
    mailer, ready, senderDomainVerification,
    settle: async () => { await forLane({ state, lane: "transactional" }); },
    status: async (options = {}) => statusWithLastError({ state, report: await statusCache.get(options) }),
    describeProviders: () => describeProviders({ state, deps: required }),
    invalidate: () => { invalidate(state); statusCache.invalidate(); },
    laneReady: async ({ lane }) => (await forLane({ state, lane })).capabilities({}).driver !== "console",
    checkProvider: input => checkProvider({ state, ...input }),
    domainRequirements: input => domainRequirements({ state, ...input, resolveDomainReadCredential }),
  };
}
