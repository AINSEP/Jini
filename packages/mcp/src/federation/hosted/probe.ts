/**
 * @file Probe one saved hosted MCP server: resolve its credentials through the host's bound store read,
 * connect once, list and describe its tools, close. Never spawns a local command and never invokes a
 * remote tool. OAuth resolution inside the store read can refresh and persist a grant, so a probe is
 * not read-only. Failures are typed kinds; the host owns statuses, response bodies, copy and links.
 */
import type { ExternalMcpConfigFailure, ExternalMcpServerConfig, ExternalMcpServerRecord, ExternalMcpServerRepoPort } from "@jini-ai/core/contracts/hosted-mcp";
import type { UUID } from "@jini-ai/core/primitives";
import { McpAuthFailedError, McpProtocolError } from "../mcp-protocol.js";
import type { FederatedMcpConnectionConfig, McpHttpLaunchSpec, McpSessionPort } from "../ports.js";
import { describeRemoteToolSurface } from "../trust.js";
import { resolveExternalMcpAuthMode, resolveExternalMcpOAuthStatus } from "./auth.js";
import { toResolvedFederatedConnections } from "./store.js";

/** Injectable session factory — the seam a test scripts instead of opening a real socket, so the
 *  protocol code under test is the real thing, not a second hand-rolled fake of it. */
export type ExternalMcpProbeSessionFactory = (
  required: { spec: McpHttpLaunchSpec; requestTimeoutMs: number },
  optional?: Record<string, never>,
) => Promise<McpSessionPort>;

/** @agent-note Host-wired. `readEnabledConfigs` is the host's already-bound hosted-store read (its vault,
 *  credential policy and settings link applied), so credential resolution is never re-implemented here. */
export interface ExternalMcpProbePorts {
  readonly repo: Pick<ExternalMcpServerRepoPort, "findByServerId">;
  readonly readEnabledConfigs: (required: { workspaceId: UUID }) => Promise<{
    readonly configs: readonly ExternalMcpServerConfig[];
    readonly failures: readonly ExternalMcpConfigFailure[];
  }>;
  /** One handshake bounded by the connection's own `connectTimeoutMs` (the session is closed right after one `listTools`). */
  readonly connect: ExternalMcpProbeSessionFactory;
}

/** Why a probe did not list tools. `stage` separates the record-level refusal from the defensive launch-shape check. */
export type ExternalMcpProbeFailure =
  | { readonly kind: "unknown_server" }
  | { readonly kind: "local_command"; readonly stage: "record" | "launch" }
  | { readonly kind: "disabled" }
  | { readonly kind: "reauth_required"; readonly stage: "stored"; readonly label: string | null }
  | { readonly kind: "reauth_required"; readonly stage: "resolve"; readonly reason: string }
  | { readonly kind: "unresolved"; readonly reason?: string }
  | { readonly kind: "auth" | "timeout" | "unreachable" };

export type ExternalMcpProbeResult =
  | { readonly ok: true; readonly tools: ReturnType<typeof describeRemoteToolSurface> }
  | { readonly ok: false; readonly failure: ExternalMcpProbeFailure };

/** One resolved, probeable target: the trust-tier config `describeRemoteToolSurface` needs, and the
 *  hosted launch spec to connect with. */
interface ProbeTarget {
  readonly federationConfig: FederatedMcpConnectionConfig;
  readonly launch: McpHttpLaunchSpec;
}

/** Either a usable target or the typed reason not to connect at all. A union rather than a throw:
 *  every branch (unknown id, wrong transport, disabled row, stale authorization) is an ordinary outcome. */
type ProbeTargetResolution = { readonly ok: true; readonly target: ProbeTarget } | { readonly ok: false; readonly failure: ExternalMcpProbeFailure };

/** Refuses a local-command row, a disabled row, and a row already parked `needs_reauth`, all from the
 *  record alone — before any credential is ever resolved.
 *  @returns The refusal, or `null` to continue resolving.
 *  @complexity O(1). */
function refuseBeforeResolving({ record }: { record: ExternalMcpServerRecord }, _optional = {}): ExternalMcpProbeFailure | null {
  if (record.transport === "stdio") return { kind: "local_command", stage: "record" };
  if (!record.enabled) return { kind: "disabled" };
  if (resolveExternalMcpAuthMode(record) === "oauth" && resolveExternalMcpOAuthStatus(record) === "needs_reauth") {
    return { kind: "reauth_required", stage: "stored", label: record.label };
  }
  return null;
}

/** Turns one store-read MISS into a typed failure. A row whose stored status was `"connected"` but whose
 *  live token refresh failed with an invalid grant during this exact call carries the typed
 *  `reauth_required` category; branching on the type (never the prose) keeps that distinction stable.
 *  @complexity O(1). */
function resolutionFailure({ failure }: { failure: ExternalMcpConfigFailure | undefined }, _optional = {}): ExternalMcpProbeFailure {
  if (failure?.category === "reauth_required") return { kind: "reauth_required", stage: "resolve", reason: failure.reason };
  return failure === undefined ? { kind: "unresolved" } : { kind: "unresolved", reason: failure.reason };
}

/** Resolves one `serverId` into a probeable target through the same store read a real connect uses,
 *  never a second, parallel reading of the row.
 *  @complexity O(n) in the workspace's configured server count (bounded by the store's per-workspace cap). */
async function resolveProbeTarget(
  { ports, workspaceId, serverId }: { ports: ExternalMcpProbePorts; workspaceId: UUID; serverId: string },
  _optional = {},
): Promise<ProbeTargetResolution> {
  const record = await ports.repo.findByServerId({ workspaceId, serverId });
  if (!record) return { ok: false, failure: { kind: "unknown_server" } };
  const earlyRefusal = refuseBeforeResolving({ record });
  if (earlyRefusal) return { ok: false, failure: earlyRefusal };

  const { configs, failures } = await ports.readEnabledConfigs({ workspaceId });
  const config = configs.find((candidate) => candidate.serverId === serverId);
  if (!config) return { ok: false, failure: resolutionFailure({ failure: failures.find((candidate) => candidate.serverId === serverId) }) };

  const [resolved] = toResolvedFederatedConnections({ configs: [config] });
  // Defensive, not reachable given the transport check above (`config.transport` mirrors
  // `record.transport` — both come from the same row): a probe must never launch a child process,
  // and a launch-spec SHAPE check right before connecting is the cheapest second guarantee of that,
  // independent of whatever produced `resolved`.
  if (!resolved || !("url" in resolved.launch)) return { ok: false, failure: { kind: "local_command", stage: "launch" } };
  return { ok: true, target: { federationConfig: resolved.config, launch: resolved.launch } };
}

/** Recognizes the probe's supported opaque HTTP and typed MCP authentication failures. */
function isProbeAuthFailure({ error }: { error: unknown }, _options = {}): boolean {
  const status = error && typeof error === 'object' ? (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode : undefined;
  if (status === 401 || status === 403 || error instanceof McpAuthFailedError) return true;
  return error instanceof McpProtocolError && /with HTTP (401|403)$/.test(error.message);
}

/** Only real Error instances and recognized protocol messages count as timeouts. */
function isProbeTimeoutFailure({ error }: { error: unknown }, _options = {}): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  return error instanceof McpProtocolError && /request (?:timed out|was aborted)/.test(error.message);
}

/** Connects once, lists, describes, and closes — the `finally` is the whole safety story for the
 *  outbound session, kept separate to stay under the complexity ceiling.
 *  @complexity O(t) in the remote's advertised tool count, plus one round trip. */
async function runProbe({ connect, target }: { connect: ExternalMcpProbeSessionFactory; target: ProbeTarget }, _optional: Record<string, never> = {}): Promise<{ ok: true; tools: ReturnType<typeof describeRemoteToolSurface> } | { ok: false; kind: "auth" | "timeout" | "unreachable" }> {
  let session: McpSessionPort | undefined;
  try {
    session = await connect({ spec: target.launch, requestTimeoutMs: target.federationConfig.connectTimeoutMs });
    const tools = await session.listTools();
    return { ok: true, tools: describeRemoteToolSurface({ tools, config: target.federationConfig }) };
  } catch (err) {
    // Report the failed connection without logging upstream errors that may contain credentials.
    // Upstream bodies/errors may contain credentials; only the closed category crosses this boundary.
    const auth = isProbeAuthFailure({ error: err });
    const timeout = isProbeTimeoutFailure({ error: err });
    const fallbackKind = timeout ? 'timeout' : 'unreachable';
    return { ok: false, kind: auth ? 'auth' : fallbackKind };
  } finally {
    // The probe result is already decided; closing its optional session is best effort.
    await session?.close({}).catch(() => undefined);
  }
}

/** Resolves credentials, probes once, then closes. OAuth resolution can refresh and persist a grant, so
 *  this operation is not read-only.
 *  @complexity O(n + t) time and space for saved servers and advertised tools, plus bounded I/O. */
export async function probeExternalMcpServer(
  { ports, workspaceId, serverId }: { readonly ports: ExternalMcpProbePorts; readonly workspaceId: UUID; readonly serverId: string },
  _optional: Record<string, never> = {},
): Promise<ExternalMcpProbeResult> {
  const resolution = await resolveProbeTarget({ ports, workspaceId, serverId });
  if (!resolution.ok) return resolution;
  const outcome = await runProbe({ connect: ports.connect, target: resolution.target });
  return outcome.ok ? outcome : { ok: false, failure: { kind: outcome.kind } };
}
