// Mechanical extraction provenance is recorded in this package's source-map.md.
import { nowIso } from '@jini-ai/core/primitives';
import { ToolInputError } from '@jini-ai/core';
import type { DeployOpsRuntime, WaitClock, DeployCredentialDiagnostic } from './ops-tool-contracts.js';
import type { DeployOpsContext, DeployOpsDeployResult, DeployOpsInput, DeployOpsResponse, DeployOpsSendRequest, DeployOpsLogs, DeployOpsStatus, DeployOpsTargets, DeployOpsWaitResult, LoadedDeployOps } from './ops-contracts.js';
import { requireDeployPlatform } from './ops-registry.js';
/** Response text is capped before parsing; the credential layer has already redacted secrets. */
export const MAX_RESPONSE_CHARS = 256_000;
/** The daemon applies no default tool timeout; this tool owns its 300s deadline and cancellation. */
export const MAX_WAIT_SECONDS = 300;
/** One module pause is short; a module that needs longer must poll, so cancellation stays prompt. */
export const MAX_MODULE_SLEEP_MS = 5_000;
const systemClock: WaitClock = {
  now: () => performance.now(),
  sleep: (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(aborted()); return; }
    const finish = () => { signal?.removeEventListener("abort", onAbort); resolve(); };
    const timer = setTimeout(finish, ms);
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(aborted()); };
    signal?.addEventListener("abort", onAbort, { once: true });
  }),
};

export const aborted = () => new ToolInputError({ message: "Deployment ops wait was aborted." });
const TIMEOUT = Symbol("deployment ops timeout");
// Neutral HTTPS origin syntax, independent of any host endpoint.
const HTTPS_PROTOCOL = "https:";
const HTTPS_AUTHORITY = `${HTTPS_PROTOCOL}//`;

/** Internal control signal caught at the registration boundary; tools return the diagnostic. */
export class DeployCredentialSetupRequired extends ToolInputError {
  readonly credentialSetup: DeployCredentialDiagnostic;
  constructor({ message, credentialSetup }: {message:string;credentialSetup:DeployCredentialDiagnostic}, _optional = {}) {
    super({ message });
    this.credentialSetup = credentialSetup;
  }
}

/** Resolve by explicit label or exactly one saved host match, without decrypting. O(credentials). */
async function credentialLabel(deps: DeployOpsRuntime, platform: LoadedDeployOps, explicit?: string): Promise<string> {
  const credentials = await deps.credentials.list({}, {});
  if (explicit !== undefined) {
    if (!credentials.some(c => c.label === explicit)) throw new DeployCredentialSetupRequired(deps.recovery.setupRequired({ label: explicit, baseUrl: `${HTTPS_AUTHORITY}${platform.descriptor.hosts[0]!}` }), {});
    return explicit;
  }
  const host = platform.descriptor.hosts[0]!;
  const matches = credentials.filter(c => c.allowedOrigins.includes(`${HTTPS_AUTHORITY}${host}`));
  if (matches.length === 0) throw new DeployCredentialSetupRequired(deps.recovery.setupRequired({ label: platform.descriptor.id, baseUrl: `${HTTPS_AUTHORITY}${host}` }), {});
  if (matches.length !== 1) throw new ToolInputError({ message: deps.messages.severalCredentials({host,labels:matches.map(c => c.label).sort()}) });
  return matches[0]!.label;
}

function requirePlatformUrl({ rawUrl, platform }: { rawUrl: string; platform: LoadedDeployOps }, _optional = {}): URL {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new ToolInputError({ message: "Deployment ops module supplied an invalid URL." }); }
  const unsafeAuthority = url.username || url.password || url.port;
  if (url.protocol !== "https:" || unsafeAuthority || !platform.descriptor.hosts.includes(url.hostname)) throw new ToolInputError({ message: `Deployment ops platform '${platform.descriptor.id}' does not allow host '${url.hostname}'.` });
  return url;
}

/** Validate both independent host bindings before any credentialed request. */
async function requireBoundUrl({ rawUrl, platform, deps, workspaceId, label }: { rawUrl: string; platform: LoadedDeployOps; deps: DeployOpsRuntime; workspaceId: string; label: string }, _optional = {}): Promise<URL> {
  const url = requirePlatformUrl({ rawUrl, platform }, {});
  try { await deps.credentials.resolveTarget({ workspaceId, label, url: rawUrl }, {}); }
  catch (error) {
    const category=deps.credentials.classifyError({error}, {}).category;
    if (category === "validation") throw new ToolInputError({ message: `Credential '${label}' does not allow host '${url.hostname}'. Add that host to the saved credential or choose another credentialLabel.` });
    if (category === "not-found") throw new ToolInputError({ message: deps.messages.noSavedCredential({label}) });
    throw error;
  }
  return url;
}

/** Translate only known credential/transport failures without echoing provider payloads. */
function requestFailure({ deps, error, signal, method, host, label }: { deps:DeployOpsRuntime; error: unknown; signal?: AbortSignal | undefined; method: string; host: string; label: string }, _optional = {}): unknown {
  if (signal?.aborted) return aborted();
  const category = deps.credentials.classifyError({error}, {}).category;
  if (category === "egress-refused") return new ToolInputError({ message: `Deployment ops host '${host}' was refused by outbound HTTP policy. Use a public HTTPS endpoint allowed by the saved credential.` });
  if (category === "transport") return new ToolInputError({ message: method === "GET" ? `Could not reach deployment ops host '${host}' using credential '${label}'. Retry the check.` : `Lost the connection to deployment ops host '${host}' during a ${method}; it may or may not have been accepted. Check ${deps.toolIds.status} before retrying.` });
  if (category === "validation" || category === "not-found") return new ToolInputError({ message: `Credential '${label}' changed or no longer allows host '${host}'. Check its saved hosts or choose another credentialLabel.` });
  return error;
}

/** Response text is bounded before parsing; clipped JSON must remain text. */
function normalizeResponse({ deps, response, transportTruncated, host, label }: { deps:DeployOpsRuntime; response: { status: number; bodyText: string }; transportTruncated: boolean; host: string; label: string }, _optional = {}): DeployOpsResponse {
  if (response.status === 401 || response.status === 403) throw new ToolInputError({ message: `Credential '${label}' was rejected (HTTP ${response.status}). Run ${deps.toolIds.credentialVerify} with label '${label}' and check its saved token/scopes.` });
  if (response.status < 200 || response.status >= 300) throw new ToolInputError({ message: `Deployment ops host '${host}' returned HTTP ${response.status}. Check the target and retry; redirects are not followed.` });
  const text = response.bodyText.slice(0, MAX_RESPONSE_CHARS);
  const truncated = transportTruncated || response.bodyText.length > MAX_RESPONSE_CHARS;
  let json: unknown;
  if (!truncated) { try { json = JSON.parse(text); } catch { /* Plain logs are valid text. */ } }
  return { status: response.status, ...(json !== undefined ? { json } : {}), text, truncated };
}

/**
 * Bound GET/write facade. Both the platform and saved credential must allow the exact HTTPS origin.
 * `allowDelete` is set only by the secret-removal verb, so no other verb's module can send a DELETE.
 */
/** @agent-note The request port must recheck abort at actual I/O after asynchronous auth-scheme loading. */
export async function boundContext({deps,platform,explicit}: {deps:DeployOpsRuntime;platform:LoadedDeployOps;explicit?:string | undefined}, {signal,allowDelete}: {signal?:AbortSignal | undefined;allowDelete?:boolean} = {}): Promise<DeployOpsContext> {
  if (!deps.credentials.available) throw new ToolInputError({ message: "Deployment ops HTTP client is unavailable. Restart the site to rebuild its tool dependencies." });
  const label = await credentialLabel(deps, platform, explicit);
  /** One guarded path for every method, so a write can never get a looser binding than a read. */
  const call = async (method: "GET" | DeployOpsSendRequest["method"], rawUrl: string, body?: unknown): Promise<DeployOpsResponse> => {
    if (signal?.aborted) throw aborted();
    const url = await requireBoundUrl({ rawUrl, platform, deps, workspaceId: deps.workspaceId, label }, {});
    if (signal?.aborted) throw aborted();
    let response;
    // `content-type` only with a body: some APIs refuse a bodyless DELETE/POST that claims JSON.
    let write: { headers?: Record<string, string>; body?: string } = {};
    if (method !== "GET") {
      write = body === undefined ? { headers: { accept: "application/json" } }
        : { headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) };
    }
    try { response = await deps.credentials.request({ workspaceId: deps.workspaceId, label, method, url: rawUrl, maxResponseBytes: MAX_RESPONSE_CHARS }, { ...write, signal }); }
    catch (error) { throw requestFailure({ deps, error, signal, method, host: url.hostname, label }, {}); }
    if (signal?.aborted) throw aborted();
    return normalizeResponse({ deps, response, transportTruncated: response.bodyTruncated, host: url.hostname, label }, {});
  };
  return {
    nowIso: () => nowIso({ clock: deps.clock }),
    fail: message => { throw new ToolInputError({ message: message }); },
    sleep: ms => (deps.waitClock ?? systemClock).sleep(Math.min(Math.max(0, Number(ms) || 0), MAX_MODULE_SLEEP_MS), signal),
    get: rawUrl => call("GET", rawUrl),
    send: input => {
      if (![...["POST", "PATCH", "PUT"], ...(allowDelete ? ["DELETE"] : [])].includes(input.method)) throw new ToolInputError({ message: `Deployment ops module supplied unsupported method '${String(input.method)}'.` });
      return call(input.method, input.url, input.body);
    },
  };
}

type Operation = "status" | "logs" | "listTargets";
/** @agent-note loadDeployOps must enforce current admission on each invocation rather than reuse an earlier registry. */
export function runDeployOps(required:{deps:DeployOpsRuntime;input:DeployOpsInput;operation:"status"}, optional:{signal?:AbortSignal | undefined}):Promise<DeployOpsStatus>;

export function runDeployOps(required:{deps:DeployOpsRuntime;input:DeployOpsInput;operation:"logs"}, optional:{signal?:AbortSignal | undefined}):Promise<DeployOpsLogs>;

export function runDeployOps(required:{deps:DeployOpsRuntime;input:DeployOpsInput;operation:"listTargets"}, optional:{signal?:AbortSignal | undefined}):Promise<DeployOpsTargets>;

export function runDeployOps(required:{deps:DeployOpsRuntime;input:DeployOpsInput;operation:Operation}, optional:{signal?:AbortSignal | undefined}):Promise<DeployOpsStatus|DeployOpsLogs|DeployOpsTargets>;
/**
 * Read through a freshly gated installed adapter, passing only a bound GET facade to the module.
 * @param deps - Saved-credential ports, audited HTTP client with redirects disabled, and test seams.
 * @param input - Platform, target, optional credential label and operation-specific selectors.
 * @param operation - Selects the normalized status, logs or target-list result.
 * @param signal - Cancels before further requests and propagates to the transport.
 * @throws {ToolInputError} Unknown platforms, credential/host/auth failures or cancelled requests.
 * @complexity Time: O(credentials + response size) plus bounded adapter requests. Space: O(response size).
 * @example await runDeployOps(deps, { platform: platformId, target: targetId }, "status", signal);
 */
export async function runDeployOps({deps,input,operation}: {deps:DeployOpsRuntime;input:DeployOpsInput;operation:Operation}, {signal}: {signal?:AbortSignal | undefined}): Promise<DeployOpsStatus | DeployOpsLogs | DeployOpsTargets> {
  if (signal?.aborted) throw aborted();
  const registry = await deps.loadDeployOps({ workspaceId: deps.workspaceId });
  const platform = requireDeployPlatform({registry,id:input.platform}, {});
  if (operation === "listTargets" && !platform.module.listTargets) throw new ToolInputError({ message: `Deployment ops platform '${input.platform}' does not support listing targets. Supply a target for ${deps.toolIds.status}.` });
  const ctx = await boundContext({deps,platform,explicit:input.credentialLabel}, {signal});
  if (signal?.aborted) throw aborted();
  if (operation === "listTargets") return platform.module.listTargets!(ctx, { org: input.org });
  if (operation === "logs") return platform.module.logs(ctx, { ...input, limit: input.limit ?? 100 });
  return platform.module.status(ctx, input);
}

export interface DeployRequest { platform: string; target: string; ref?: string | undefined; credentialLabel?: string | undefined; workflowFile?: string | undefined }
const clip = (value: unknown) => String(value).slice(0, 2000);
function validateDeployResult({ input, result }: { input: DeployRequest; result: DeployOpsDeployResult }, _optional = {}): void {
  if (typeof result?.started !== "boolean" || typeof result.summary !== "string") throw new ToolInputError({ message: `Deployment ops platform '${input.platform}' returned an invalid deploy result.` });
  if (result.runId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(String(result.runId))) throw new ToolInputError({ message: `Deployment ops platform '${input.platform}' returned an invalid run id.` });
}

/** Keep only the documented fields; platform/target come from the request, never from the module. O(machineIds). */
function normalizeDeployResult(input: DeployRequest, result: DeployOpsDeployResult): DeployOpsDeployResult {
  validateDeployResult({ input, result }, {});
  return {
    platform: input.platform, target: input.target, started: result.started, summary: clip(result.summary),
    ...(result.runId !== undefined ? { runId: String(result.runId) } : {}),
    ...(typeof result.sha === "string" ? { sha: clip(result.sha) } : {}),
    ...(Array.isArray(result.machineIds) ? { machineIds: result.machineIds.slice(0, 32).map(clip) } : {}),
    ...(typeof result.image === "string" ? { image: clip(result.image) } : {}),
    ...(typeof result.url === "string" && result.url.startsWith(HTTPS_AUTHORITY) ? { url: clip(result.url) } : {}),
  };
}

/**
 * Start a deploy through a freshly gated installed adapter. The chat tool and the admin route both call this.
 * @param required - `deps`: saved-credential ports and the no-redirect HTTP client; `input`: platform, target, optional ref and credential label.
 * @param optional - `signal` cancels before further requests and propagates to the transport.
 * @returns The normalized accepted-deploy result; landing is observed afterwards with status/wait.
 * @throws {ToolInputError} Unknown or observe-only platforms, credential/host/auth failures, invalid module results, or cancellation.
 * @complexity Time: O(credentials + response size) plus bounded adapter requests. Space: O(response size).
 * @example await runDeploy({ deps, input: { platform: "my-host", target: "owner/repo", ref: "main" } }, { signal });
 */
export async function runDeploy(required: { deps: DeployOpsRuntime; input: DeployRequest }, optional: { signal?: AbortSignal | undefined } = {}): Promise<DeployOpsDeployResult> {
  const { deps, input } = required; const { signal } = optional;
  if (signal?.aborted) throw aborted();
  const registry = await deps.loadDeployOps({ workspaceId: deps.workspaceId });
  const platform = requireDeployPlatform({registry,id:input.platform}, {});
  if (!platform.module.deploy) {
    const deployable = registry.list().filter(p => typeof p.module.deploy === "function").map(p => p.descriptor.id);
    throw new ToolInputError({ message: `Deployment ops platform '${input.platform}' cannot deploy; it is observe-only. Platforms that can deploy: ${deployable.join(", ") || "(none)"}.` });
  }
  const ctx = await boundContext({deps,platform,explicit:input.credentialLabel}, {signal});
  if (signal?.aborted) throw aborted();
  const adapterInput = await deployAdapterInput({ deps, input });
  const result = await platform.module.deploy(ctx, adapterInput);
  const normalized = normalizeDeployResult(input, result);
  if (normalized.started) await recordAcceptedDeploy({ deps, platform, normalized }, {});
  return normalized;
}

async function recordAcceptedDeploy({ deps, platform, normalized }: { deps: DeployOpsRuntime; platform: LoadedDeployOps; normalized: DeployOpsDeployResult }, _optional = {}): Promise<void> {
  // Accepted requests are successful dispatches, not proof of a healthy landing. Preserve that
  // distinction in status; never invent a URL when the adapter cannot supply one.
  // Status may describe an older healthy run (runId is optional), so acceptance stays pending.
  if (deps.publishHistoryStore) {
    try {
      await deps.publishHistoryStore.recordSuccess({ workspaceId: deps.workspaceId, entry: {
        kind: "deploy", target: platform.descriptor.id, projectName: normalized.target, url: normalized.url ?? "",
        reachable: false, status: "started", publishedAt: nowIso({ clock: deps.clock }), triggeredBy: "agent_tool",
      } });
    } catch {
      // Dispatch already succeeded; never turn a ledger failure into a duplicate deploy retry.
      // No raw error: database parameters can contain credentials or provider response data.
      console.warn("[deploy-ops] destination history write failed after accepted deploy");
    }
  }
}

/** Race an in-flight status against the deadline and cancellation. Listeners/timers always cleaned up.
 * The signal is never already aborted here: the one caller chain (`waitForDeployOps` ->
 * `pollBeforeDeadline`) checks `signal.aborted` and reaches this function synchronously, with no await
 * in between, so a pre-aborted guard here could never fire and was removed. */
async function boundedPoll(status: (signal: AbortSignal) => Promise<DeployOpsStatus>, remaining: number, signal?: AbortSignal | undefined): Promise<DeployOpsStatus> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => { controller.abort(); reject(aborted()); };
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(TIMEOUT); }, remaining);
  });
  try { return await Promise.race([status(controller.signal), stopped]); }
  finally { if (timer) { clearTimeout(timer); } if (onAbort) { signal?.removeEventListener("abort", onAbort); } }
}

async function pollBeforeDeadline({ status, clock, deadline }: { status(signal: AbortSignal): Promise<DeployOpsStatus>; clock: WaitClock; deadline: number }, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<DeployOpsStatus | typeof TIMEOUT> {
  try {
    const observation = await boundedPoll(status, deadline - clock.now(), signal);
    if (signal?.aborted) throw aborted();
    return observation;
  } catch (error) { if (error === TIMEOUT) { return TIMEOUT; } throw error; }
}

function reachedCondition({ until, state }: { until: "healthy" | "finished"; state: DeployOpsStatus["state"] }, _optional = {}): boolean {
  return until === "healthy" ? state === "healthy" : ["healthy", "failing", "stopped"].includes(state);
}

async function sleepBeforeDeadline({ clock, deadline }: { clock: WaitClock; deadline: number }, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<void> {
  const remaining = deadline - clock.now();
  if (remaining > 0) await clock.sleep(Math.min(10_000, remaining), signal);
}

function waitSettings({ deps, input }: { deps: { clock?: WaitClock | undefined; initial?: DeployOpsStatus }; input: { timeoutSeconds?: number } }, _optional = {}) {
  const clock = deps.clock ?? systemClock; const started = clock.now(); const deadline = started + (input.timeoutSeconds ?? 180) * 1000;
  const initial: DeployOpsStatus = deps.initial ?? { platform: "unknown", target: "unknown", state: "unknown", summary: "No status received before timeout.", items: [], checkedAt: "" };
  return { clock, started, deadline, initial };
}

/**
 * Poll immediately and every 10s, bounding sleeps and in-flight polls by the remaining deadline.
 * @param deps - Status reader, optional monotonic clock/sleep seam, and initial unknown observation.
 * @param input - Desired condition, timeout (default 180s; validated by the tool handler), and abort signal.
 * @returns Reached flag, elapsed seconds, attempted poll count and last observation; timeout is a result.
 * @throws {ToolInputError} Cancellation or a refusal from the status reader.
 * @complexity Time: O(timeout / 10s) polls. Space: O(one status response).
 * @example await waitForDeployOps({ status }, { until: "healthy", timeoutSeconds: 180, signal });
 */
export async function waitForDeployOps(deps: { status(signal: AbortSignal): Promise<DeployOpsStatus>; clock?: WaitClock | undefined; initial?: DeployOpsStatus }, input: { until: "healthy" | "finished"; timeoutSeconds?: number; signal?: AbortSignal | undefined }): Promise<DeployOpsWaitResult> {
  const { clock, started, deadline, initial } = waitSettings({ deps, input }, {});
  let polls = 0;
  let last = initial;
  const result = (reached: boolean): DeployOpsWaitResult => ({ reached, waitedSeconds: Math.min((clock.now() - started) / 1000, (deadline - started) / 1000), polls, last });
  while (clock.now() < deadline) {
    if (input.signal?.aborted) throw aborted();
    polls++;
    const observation = await pollBeforeDeadline({ status: deps.status, clock, deadline }, { signal: input.signal });
    if (observation === TIMEOUT) return result(false);
    last = observation;
    if (clock.now() > deadline) return result(false);
    if (reachedCondition({ until: input.until, state: last.state }, {})) return result(true);
    await sleepBeforeDeadline({ clock, deadline }, { signal: input.signal });
  }
  if (input.signal?.aborted) throw aborted();
  return result(false);
}

/** Pass active workflow choices per invocation without changing ordinary adapter input shapes. */
async function deployAdapterInput({ deps, input }: { deps: DeployOpsRuntime; input: DeployRequest }, _options = {}): Promise<import('./ops-contracts.js').DeployOpsDeployInput> {
  const workflowFiles = await deps.loadDeployWorkflowFiles?.({ workspaceId: deps.workspaceId });
  return { target: input.target, ...(input.ref === undefined ? {} : { ref: input.ref }),
    ...(input.workflowFile === undefined ? {} : { workflowFile: input.workflowFile }),
    ...(workflowFiles === undefined ? {} : { workflowFiles }) };
}
