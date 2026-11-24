/** Saved-server probe used by the admin route and assistant tools. Jini's hosted probe resolves, connects once and
 * classifies; this file binds the host's store read and HTTP session and keeps the host's response contract: statuses,
 * legacy codes, copy and settings links. Never spawns local commands or invokes remote tools (D-7). */
import type { ExternalMcpServerConfig, ExternalMcpConfigFailure, ExternalMcpServerRepoPort } from "@jini-ai/core/contracts/hosted-mcp";
import type { UUID } from "@jini-ai/core/primitives";
import { createFetchMcpHttpExchange } from "./adapter.http.js";
import type { McpHttpExchange, McpHttpLaunchSpec, McpSessionPort } from "./ports.js";
import { probeExternalMcpServer as probeHostedMcpServer, type ExternalMcpProbeFailure, type ExternalMcpProbeSessionFactory } from "./hosted/probe.js";

/** The deps slice the probe itself reads. The host's own deps type (its store sealer, its OAuth service)
 *  extends this and reaches the store only through {@link ExternalMcpProbeHost.readEnabledConfigs}. */
export interface ExternalMcpProbeBaseDeps {
  readonly workspaceId: UUID;
  readonly clock: { nowMs(): number };
  readonly externalMcpServerRepo: Pick<ExternalMcpServerRepoPort, "findByServerId">;
  /** Defaults to the real hosted MCP client. See {@link ExternalMcpProbeSessionFactory}. */
  readonly connect?: ExternalMcpProbeSessionFactory;
}

/** What a reauthorization error built by the host exposes to the 409 body. Its stored message never crosses into the
 *  body: the outward text comes from {@link ExternalMcpProbeHost.reauthResponseText}. */
export interface ExternalMcpProbeReauthError { readonly code: string; readonly settingsLink: string }

/** @agent-note Host-wired, bound once in the host's external MCP host-copy module. */
export interface ExternalMcpProbeHost<Deps extends ExternalMcpProbeBaseDeps> {
  /** The host's bound hosted-store read (vault, sealer, optional OAuth token resolver) for this deps bag. */
  readonly readEnabledConfigs: (required: { deps: Deps; workspaceId: UUID }) => Promise<{
    readonly configs: readonly ExternalMcpServerConfig[];
    readonly failures: readonly ExternalMcpConfigFailure[];
  }>;
  /** The host's HTTP MCP session binding (its protocol identity and refusal copy over the federation transport). */
  readonly connectHttpSession: (required: { exchange: McpHttpExchange; spec: McpHttpLaunchSpec; requestTimeoutMs: number }) => Promise<McpSessionPort>;
  /** The host's reauthorization error for a row parked `needs_reauth`: its own copy, code and settings link. */
  readonly reauthRequired: (required: { serverId: string; label: string | null }) => ExternalMcpProbeReauthError;
  /** The host's response copy for a row parked `needs_reauth` (the outward 409 text). */
  readonly reauthResponseText: (required: { serverId: string; label: string | null }) => string;
  /** The host's settings-screen deep link for one saved server. */
  readonly settingsDeepLink: (required: { serverId: string }) => string;
  /** The host's legacy error code for a reauthorization the store detected during this call. */
  readonly reauthCode: string;
  /** The host's fixed, credential-free copy for one connect-failure category. */
  readonly connectFailureText: (required: { id: "auth" | "timeout" | "unreachable" }) => string;
}

type ProbeFailureResponse = { readonly ok: false; readonly status: number; readonly body: Record<string, unknown> };

const CONNECT_FAILURES = { auth: { status: 401, code: "MCP_AUTH_REJECTED" }, timeout: { status: 504, code: "MCP_TIMEOUT" }, unreachable: { status: 502, code: "MCP_SERVER_UNREACHABLE" } } as const;

/** The two local-command refusals: the record-level one points the operator at typing tool names. */
function localCommandResponse({ stage }: { stage: "record" | "launch" }, _optional = {}): ProbeFailureResponse {
  return stage === "record"
    ? { ok: false, status: 400, body: { error: "probe is not available for local-command servers yet — type tool names directly instead", code: "PROBE_UNSUPPORTED_TRANSPORT", details: { field: "transport" } } }
    : { ok: false, status: 400, body: { error: "probe is not available for local-command servers yet", code: "PROBE_UNSUPPORTED_TRANSPORT" } };
}

/** Binds the host's store read, HTTP session, reauthorization error, settings link and connect-failure copy once.
 * @param required.host - The host collaborators; see {@link ExternalMcpProbeHost}.
 * @returns `probeExternalMcpServer`, bound to those collaborators.
 * @example export const probeExternalMcpServer = createExternalMcpProbe<ExternalMcpProbeServiceDeps>({ host });
 * @complexity O(1).
 */
export function createExternalMcpProbe<Deps extends ExternalMcpProbeBaseDeps>({ host }: { host: ExternalMcpProbeHost<Deps> }, _optional = {}) {
  /** The real session factory: one handshake against the resolved hosted endpoint, bounded by the
   *  connection's own `connectTimeoutMs`. Deliberately NOT the same bound `bootstrap.ts`'s
   *  `defaultConnect` uses for the identical transport: that session is long-lived and its bound
   *  governs every later `tools/call` too, so it uses `callTimeoutMs`. This one issues an `initialize`
   *  handshake via the host's `connectMcpHttpSession` followed by this route's own single `listTools`
   *  call, then is closed immediately after — for THIS session, `connectTimeoutMs` bounds the
   *  handshake and is the correct bound rather than a reused wrong one.
   *  @complexity O(1) beyond the remote's round-trip. */
  async function defaultProbeConnect({ spec, requestTimeoutMs }: { spec: McpHttpLaunchSpec; requestTimeoutMs: number }, _optional = {}): Promise<McpSessionPort> {
    return host.connectHttpSession({ exchange: createFetchMcpHttpExchange({ fetch }), spec, requestTimeoutMs });
  }

  /** 409 for both reauthorization paths: a row parked `needs_reauth` (the host's response copy, code and link), or a live
   *  refresh that failed with an invalid grant during this call (the store's reason, typed by Jini, plus the deep link). */
  function reauthResponse(
    { failure, serverId }: { failure: Extract<ExternalMcpProbeFailure, { kind: "reauth_required" }>; serverId: string }, _optional = {},
  ): ProbeFailureResponse {
    if (failure.stage === "stored") {
      const reauth = host.reauthRequired({ serverId, label: failure.label });
      const text = host.reauthResponseText({ serverId, label: failure.label });
      return { ok: false, status: 409, body: { error: text, code: reauth.code, details: { retryable: false, settingsLink: reauth.settingsLink } } };
    }
    return { ok: false, status: 409, body: { error: failure.reason, code: host.reauthCode, details: { retryable: false, settingsLink: host.settingsDeepLink({ serverId }) } } };
  }

  /** The host's admin response contract for each typed probe failure. Upstream bodies/errors may contain credentials;
   *  only the closed category crosses into a connect-failure answer. */
  function probeFailureResponse({ failure, serverId }: { failure: ExternalMcpProbeFailure; serverId: string }, _optional = {}): ProbeFailureResponse {
    switch (failure.kind) {
      case "unknown_server":
        return { ok: false, status: 400, body: { error: `no external MCP server is configured as '${serverId}'`, code: "INVALID_MCP_SERVER", details: { field: "id" } } };
      case "local_command":
        return localCommandResponse({ stage: failure.stage });
      case "disabled":
        return { ok: false, status: 400, body: { error: "this server is disabled — enable it before probing", code: "MCP_SERVER_DISABLED", details: { field: "enabled" } } };
      case "reauth_required":
        return reauthResponse({ failure, serverId });
      case "unresolved":
        return { ok: false, status: 502, body: { error: failure.reason ?? "this server's connection could not be resolved", code: "MCP_SERVER_UNREACHABLE" } };
      default:
        return { ok: false, status: CONNECT_FAILURES[failure.kind].status, body: { error: host.connectFailureText({ id: failure.kind }), code: CONNECT_FAILURES[failure.kind].code } };
    }
  }

  /** Resolves credentials, probes once, then closes. Expected refusals retain the admin response contract.
   * OAuth resolution can refresh and persist a grant, so this operation is not declared read-only.
   * @complexity O(n + t) time and O(n + t) space for saved servers and advertised tools, plus bounded I/O.
   */
  return async function probeExternalMcpServer({ deps, serverId }: { deps: Deps; serverId: string }, _optional = {}) {
    const outcome = await probeHostedMcpServer({
      ports: {
        repo: deps.externalMcpServerRepo,
        readEnabledConfigs: ({ workspaceId }) => host.readEnabledConfigs({ deps, workspaceId }),
        connect: deps.connect ?? defaultProbeConnect,
      },
      workspaceId: deps.workspaceId,
      serverId,
    });
    if (!outcome.ok) return probeFailureResponse({ failure: outcome.failure, serverId });
    return { ok: true as const, body: { tools: outcome.tools, probedAt: new Date(deps.clock.nowMs()).toISOString() } };
  };
}
