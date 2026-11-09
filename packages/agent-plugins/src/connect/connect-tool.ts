import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";
import type { ExternalMcpConnectStart } from "@jini-ai/core/contracts/hosted-mcp";
import { adaptLegacyAuthorize } from "@jini-ai/core";
import { type AgentToolSideEffect, type DerivedRiskByToolId, type AgentToolDefinition, type AccessApprovalDescription, type ToolHandler } from "@jini-ai/core";
import { requireToolPermission, type LegacyToolAuthorizeFn as AuthorizeFn } from "@jini-ai/core";
import { ToolInputError, redactSecrets, type ToolExecutionOptions, type ToolExecutionContext } from "@jini-ai/core";
import {
  deriveAgentPluginConnectionId, provisionAgentPluginMcpServers, previewAgentPluginEnableAccess, recordAgentPluginAccessDeclined,
  type AgentPluginMcpPort, type AgentPluginMcpRecord, type AgentPluginMcpProjectionPorts, type AgentPluginMcpProjections,
  type AgentPluginMcpTrustClassifier, type AgentPluginEnableAccessMessages,
} from "@jini-ai/agent-plugins/connect";
import type { McpServerConfig, RemoteMcpServerConfig } from "@jini-ai/agent-plugins/lifecycle";

/**
 * @file agent_plugin_connect connects an Agent Plugin's account through
 * one shared host flow, so plugins do not need vendor-specific connect tools.
 *
 * Token-only plugins reuse a stored credential or the injected credential_save token card. The
 * token card owns probing, sealing and cancellation; this module never handles a plaintext token.
 * Explicit OAuth with token fallback retains the OAuth flow below.
 *
 * ## What one OAuth call does
 *
 * Given a `pluginId`, this provisions the plugin's declared OAuth-authenticated MCP server(s) as
 * external-MCP rows (idempotently — `provisionAgentPluginMcpServers`, `federate-mcp.ts`), starts an
 * authorization for whichever of them are not yet connected, shows a card with a sign-in link, and
 * PARKS the call — polling the row for `oauth.status === "connected"` — until either the human
 * finishes signing in, skips the card, or a bounded wait elapses. Skip releases only this sign-in
 * wait so the assistant can continue the turn. It never returns a token, a URL, or a row id in its
 * own result: only `{ status: "connected" }` or the resumable `{ status: "waiting-for-sign-in" }`
 * (the plan's skill calls this again on "done" rather than looping on its own). A plugin-declared API
 * connection's result also carries its opaque `connectionRef`, because that plugin's tools take it as
 * input and chat has no other way to learn it; the host refuses it for every other plugin.
 *
 * ## Why polling alongside `exchange.receive()`
 *
 * The sign-in itself finishes on the PUBLIC OAuth callback route, not by the human clicking anything
 * inside this card (`external-mcp-oauth.ts`'s `completeAuthorizationCallback`) — the card's one
 * sign-in element is an outbound `openLink`, which (per `@jini-ai/ui`'s `outcome.ts` surface) is
 * not a delivery through `mcp-ui-tool-calls-route.ts` at all. So there is nothing for this call to
 * `receive()` to finish sign-in: that now observes Skip, while the callback is observed by reading the row this call already
 * provisioned, which is exactly what `resolveExternalMcpOAuthStatus` (`features/external-mcp/external-mcp-store.ts`)
 * is for.
 *
 * ## Deliberately narrow: one pending OAuth server per call
 *
 * A plugin declaring more than one OAuth-authenticated server that is not yet connected is refused
 * with a plain `ToolInputError` naming the servers, rather than building a card with several sign-in
 * links. No bundled plugin does this today (Supabase and Higgsfield each declare exactly one), and a
 * multi-link card is a real design question (which one is "the" sign-in?) worth deferring to an
 * actual second case rather than guessing at one now.
 */

const DEFAULT_POLL_INTERVAL_MS = 3000;
/** Matches `@jini-ai/daemon/surface-exchanges`'s `DEFAULT_SURFACE_IDLE_TTL_MS` — the same
 *  "long enough to read a card and go sign in, short enough not to hold a subprocess open forever"
 *  budget. The connection watcher and the card exchange have separate owners; neither may keep
 *  the call parked beyond its own deadline. */
const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

/** One installed plugin's declared MCP servers — the slice `agent_plugin_connect` needs. Kept
 *  narrower than `InstalledAgentPlugin` (no version/keywords/skills: this tool cares only about
 *  what it can connect). */
export interface ResolvedAgentPluginForConnect {
  readonly credentialCards?: readonly PluginCredentialCard[];
  readonly servers: Readonly<Record<string, McpServerConfig>>;
}

/** "supabase" -> "Supabase", "higgsfield-media" -> "Higgsfield Media". There is no separate
 *  display-name field in `plugin.json` (agent-plugins.org has none) — `uninstall-confirmation-ui.ts`'s
 *  own dialog makes the identical choice, naming the plugin by its id. */
export function titleCaseFromPluginId(required: { pluginId: string }, _optional: Record<string, never> = {}): string {
  return required.pluginId
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Only a remote server can carry `authMode` (`manifest.ts`); a stdio entry never needs a sign-in. */
function isOAuthServer(config: McpServerConfig): config is RemoteMcpServerConfig {
  return config.type !== "stdio" && config.authMode === "oauth";
}

/**
 * Starts the sign-in and returns the link the card shows.
 *
 * @throws {ToolInputError} The OAuth service refused the request, or OAuth discovery/registration failed,
 *   with the no-card note the model must relay.
 * @throws {Error} A `device_code` grant: the card has no place for the user code, and nothing in this
 *   call polls `pollDeviceAuthorization`, so the row would never flip to connected. Provisioned rows
 *   always use `authorization_code` (`federate-mcp.ts`), so this is a fail-loud guard.
 */
async function beginSignIn(
  { oauth, serverId, derivedPublicOrigin, host }: { oauth: AgentPluginConnectSignInPort; serverId: string; derivedPublicOrigin?: string; host: AgentPluginConnectHost<unknown> },
  _options = {},
): Promise<string> {
  let start;
  try {
    start = await oauth.beginConnect({ serverId, redirectUri: host.publicUrl.redirectUri({ serverId, derivedPublicOrigin }), delivery: 'hosted' });
  } catch (err) {
    // Discovery runs before rendering. A failed start must not leave chat promising a missing card.
    if (!oauth.isSignInRefusal({ error: err })) throw err;
    // A matching classifier does not make the message safe: model text crosses core redaction.
    throw new ToolInputError({ message: host.messages.signInRefused({ detail: redactSecrets({ input: (err as Error).message }, { redactPii: false }) }) });
  }
  if (start.kind !== "redirect_required") {
    throw new Error(host.messages.unsupportedSignIn({ kind: start.kind }));
  }
  return start.authorizationUrl;
}

function sleepOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The sign-in start this tool needs: only a hosted `redirect_required` start opens the connect card.
 * @agent-note Second host: bind your hosted-MCP OAuth service. `isSignInRefusal` is true only for a
 * refusal that opened NO card (chat then offers the key-card fallback); every other fault returns false
 * and propagates unchanged. Matching never makes a message safe: this tool redacts before model text. */
export interface AgentPluginConnectSignInPort {
  beginConnect(input: { serverId: string; redirectUri?: string; delivery?: "hosted" }, options?: Record<string, never>): Promise<ExternalMcpConnectStart>;
  isSignInRefusal(required: { error: unknown }, optional?: Record<string, never>): boolean;
}

/** Declared API connections; the host retains OAuth clients, browser binding and token custody.
 * @agent-note Second host: `Connection` is your own declaration record, passed through unchanged
 * (this tool never reads it). `connect` resolves with a safe connect result, never a token or URL. */
export interface AgentPluginConnectApiConnectionsPort<Connection> {
  /** @agent-note True only when your host can save one connection for several sites. */
  readonly sharingAvailable?: boolean;
  listConnections(input: { pluginId: string }, options?: Record<string, never>): Promise<readonly Connection[]>;
  connect(input: { destination?: 'site' | 'shared'; connection: Connection; actorId: string; signal: AbortSignal; pollIntervalMs: number; waitTimeoutMs: number; showSignIn: (input: { readonly signInUrl: string }) => Promise<void> }, options?: Record<string, never>): Promise<AgentPluginConnectResult>;
}

/** The host's approval lifecycle for a fixed access change (the common access card).
 * @agent-note Second host: bind your one approval owner (typically a wrapper over core's
 * `createApprovalHandler`). It MUST: freeze `ctx` and bind the confirming principal before `prepare`;
 * render `describe`'s access card and wait for the human; call `run` only after an explicit confirm, with
 * the bound ctx (so `run` re-checks permission, activation and the `prepared.key` fingerprint itself);
 * forward `emitSurface`/execution options unchanged; and call `declined` (never `run`) on decline,
 * expiry or abort. `ask` false means nothing needs consent and `run` proceeds without a card. */
export interface AgentPluginConnectApprovalsPort<Surfaces> {
  accessApprovalHandler<Prepared>(
    required: {
      surfaces: Surfaces;
      prepare(required: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions): Promise<Prepared>;
      describe(required: { ctx: ToolExecutionContext; prepared: Prepared }): AgentPluginAccessApprovalDescription;
      run(required: { ctx: ToolExecutionContext; prepared: Prepared }, optional: ToolExecutionOptions): Promise<unknown>;
    },
    optional: {
      ask(required: { prepared: Prepared }): boolean;
      declined(required: { reason: 'declined' | 'expired' | 'abandoned'; prepared?: Prepared }): unknown;
    },
  ): ToolHandler;
  /** @agent-note Your host's standard not-confirmed result (its exact bytes are merged into this tool's result). */
  notConfirmedResult(required: { reason: 'declined' | 'expired' | 'abandoned' }): { cancelled: boolean; reason?: 'expired' | 'abandoned'; note: string };
}

/** What this tool asks the approvals port to render. Wording is neutral; ids are host input. */
export interface AgentPluginAccessApprovalDescription {
  readonly toolId: string;
  readonly errorCode: string;
  readonly title: string;
  readonly access?: AccessApprovalDescription;
  readonly details: readonly never[];
  readonly description: string;
  readonly confirmLabel: string;
}

/** Product wording and tool names this tool's refusals carry; every member is required host copy.
 * @agent-note Second host: name YOUR tool ids, settings screen and product; keep each refusal a plain
 * sentence the model can relay. `detail` in `signInRefused` is already redacted. */
export interface AgentPluginConnectMessages {
  signInRefused(required: { detail: string }): string;
  unsupportedSignIn(required: { kind: string }): string;
  connectionNotSetUp(required: { pluginId: string; serverKey: string }): string;
  multipleTokenServers(required: { pluginId: string }): string;
  noTokenCardAdapter(): string;
  pluginOff(required: { pluginId: string }): string;
  notInstalled(required: { pluginId: string }): string;
  noOAuthService(): string;
  multipleOAuthServers(required: { pluginId: string; serverKeys: readonly string[] }): string;
  noConnection(required: { pluginId: string }): string;
  multipleApiConnections(required: { pluginId: string; count: number }): string;
  /** @agent-note Shown when the context has no `emitSurface`; the same text your sign-in card host uses. */
  missingEmitter(): string;
}

/** Everything product-specific this tool needs, bound once by the host.
 * @agent-note Second host: none of these has a default here. `toolId` is the id your card answers and
 * approvals route back to; `permissions.connect` gates the tool and its approval re-check;
 * `permissions.apiConnectionWrite` gates saving a declared API connection; `entityType` and
 * `approvalErrorCode` are your authorization/approval vocabulary. */
export interface AgentPluginConnectHost<Surfaces> {
  readonly toolId: string;
  readonly permissions: { readonly connect: string; readonly apiConnectionWrite: string };
  readonly entityType: string;
  readonly approvalErrorCode: string;
  readonly approvals: AgentPluginConnectApprovalsPort<Surfaces>;
  readonly messages: AgentPluginConnectMessages;
  /** @agent-note Your public OAuth callback URL for `serverId`, or undefined when your host has no public
   * origin (then `beginConnect` decides). Operator configuration precedence is yours to keep. */
  readonly publicUrl: { redirectUri(required: { serverId: string; derivedPublicOrigin?: string }): string | undefined };
  /** @agent-note Your lifecycle trust rule and federation/enable-access refusal copy (same objects your
   * provisioning and enable-access previews use, so plans and fingerprints agree). */
  readonly federation: { readonly classifyTrust: AgentPluginMcpTrustClassifier; readonly messages: AgentPluginEnableAccessMessages };
  /** @agent-note Actor recorded when a person declines the access card (`AgentPluginConnectActors.connectDeclined`). */
  readonly actors: { readonly connectDeclined: string };
  /** @agent-note Your sign-in card waiter (typically `waitAtAgentPluginSignInCardWithPorts` bound to your cards,
   * card identity and SAME process exchange store). Skip resolves with your skipped result. */
  waitAtSignInCard(required: {
    surfaces: Surfaces; ctx: ToolExecutionContext; pluginId: string; pluginDisplayName: string; credentialCard?: PluginCredentialCard;
    connect: (input: { signal: AbortSignal; showSignIn: (input: { signInUrl: string }) => Promise<void> }) => Promise<AgentPluginConnectResult>;
  }, optional: ToolExecutionOptions): Promise<AgentPluginConnectResult>;
  /** @agent-note Your destination card (typically `chooseApiConnectionDestinationWithPorts`); null = cancelled. */
  chooseDestination(required: { surfaces: Surfaces; ctx: ToolExecutionContext; pluginDisplayName: string; available: boolean }, optional: ToolExecutionOptions): Promise<'site' | 'shared' | null>;
}

/** Consumer-owned services; composition binds persistence, secret custody and sign-in providers.
 * OAuth remains optional so token-only declarations work without an OAuth service.
 * @agent-note Second host: `mcp` carries your canonical projection pair (never copies); `isPluginEnabled`
 * and `resolveInstalledPlugin` are your fresh activation owner and installed-declaration read (no
 * filesystem default here). */
export interface AgentPluginConnectDeps<Surfaces, Connection> {
  readonly ownerPrincipalId?: Promise<string>;
  /** Fresh activation owner; injected so OFF-plugin refusal needs no filesystem in unit tests. */
  readonly isPluginEnabled: (pluginId: string) => Promise<boolean>;
  readonly credentials: { loadSafe(input: { workspaceId: string }, options?: Record<string, never>): Promise<readonly PluginCredentialCard[]> };
  readonly workspaceId: string;
  readonly authorize: AuthorizeFn;
  readonly mcp: AgentPluginMcpProjectionPorts & Pick<AgentPluginMcpPort, "repo" | "saveServer" | "applyAccess"> & Partial<Pick<AgentPluginMcpPort, "notifyRosterChanged">>;
  readonly externalMcpOAuth?: AgentPluginConnectSignInPort;
  readonly derivedPublicOrigin?: string;
  /** Injectable for tests; a real composition root omits both and gets the production cadence. */
  readonly pollIntervalMs?: number;
  readonly waitTimeoutMs?: number;
  /** The installed plugin's declarations (a fixture in tests; the host's installed read in production). */
  readonly resolveInstalledPlugin: (pluginId: string) => Promise<ResolvedAgentPluginForConnect | null>;
  /** Plugin-declared OAuth API connections. Absent: only MCP servers connect. */
  readonly apiConnections?: AgentPluginConnectApiConnectionsPort<Connection>;
  readonly host: AgentPluginConnectHost<Surfaces>;
}
/** Internal erased view: ports are method-typed, so a host's concrete `Surfaces`/`Connection` pass through opaque. */
type ConnectDeps = AgentPluginConnectDeps<unknown, unknown>;

/** This tool's one-entry catalog, built from host copy (tool id, permission, description and the
 *  pluginId schema text are product vocabulary).
 * @agent-note Second host: pass your own tool id/permission/description bytes; the schema shape is fixed. */
export function agentPluginConnectAgentToolCatalogFor(required: { toolId: string; permission: string; description: string; pluginIdDescription: string }, _optional: Record<string, never> = {}): AgentToolDefinition[] {
  return [
    {
      name: required.toolId,
      description: required.description,
      sideEffects: "mutates-durable-state",
      authorization: { permission: required.permission },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["pluginId"],
        properties: {
          pluginId: {
            type: "string",
            minLength: 1,
            description: required.pluginIdDescription,
          },
        },
      },
    },
  ];
}

/** @agent-note Second host: key by your own tool id. */
export function agentPluginConnectDerivedRiskFor(required: { toolId: string }, _optional: Record<string, never> = {}): DerivedRiskByToolId {
  return new Map<string, AgentToolSideEffect>([
    [required.toolId, "mutates-durable-state"],
  ]);
}

/** One declared OAuth server this call still needs to connect. */
interface PendingOAuthServer {
  readonly serverKey: string;
  readonly connectionId: string;
}

/** Whether a plugin's row already holds a credential: a finished sign-in, or a saved access token
 *  (`static_env` with the token sealed in `sealedOAuth` — what `agent_plugin_set_access_token`, the
 *  old env var's boot import, and create-site onboarding all write; `sealedEnv` is a stdio row's env
 *  block and never holds it). Such a row needs no sign-in, and a token import must never overwrite it. */
export function hasStoredAgentPluginCredential(required: { row: Pick<AgentPluginMcpRecord, "authMode" | "sealedOAuth" | "oauthStatus">; projections: AgentPluginMcpProjections }, _optional: Record<string, never> = {}): boolean {
  const { row, projections } = required;
  return projections.oauthStatus(row) === "connected" || projections.hasStaticAccessToken(row);
}

/** Resolves which of a plugin's declared OAuth servers still need connecting, after provisioning
 *  every one of them as an external-MCP row (idempotent — a row already `connected` is left alone).
 *  @throws {ToolInputError} A declared OAuth server has no row owned by this plugin after provisioning (provisioning
 *    skipped or failed it — e.g. a legacy `sse` transport): there is nothing to sign in to. */
async function resolvePendingOAuthServers(
  routeDeps: ConnectDeps,
  pluginId: string,
  oauthServerKeys: readonly string[],
): Promise<readonly PendingOAuthServer[]> {
  const pending: PendingOAuthServer[] = [];
  for (const serverKey of oauthServerKeys) {
    const connectionId = deriveAgentPluginConnectionId(serverKey);
    const row = connectionId
      ? await routeDeps.mcp.repo.findByServerId({ workspaceId: routeDeps.workspaceId, serverId: connectionId })
      : null;
    if (!connectionId || !row || row.provisionedByPluginId !== pluginId) {
      throw new ToolInputError({ message: routeDeps.host.messages.connectionNotSetUp({ pluginId, serverKey }) });
    }
    // A saved access token counts too: starting a sign-in here would switch the row back to OAuth.
    if (hasStoredAgentPluginCredential({ row, projections: routeDeps.mcp.projections })) continue;
    pending.push({ serverKey, connectionId });
  }
  return pending;
}

/** The injected adapter calls the existing token-card lifecycle without a runtime import cycle. */
export type AgentPluginConnectOptions = ToolExecutionOptions & {
  readonly saveToken?: (
    input: { readonly ctx: ToolExecutionContext; readonly pluginId: string },
    optional?: ToolExecutionOptions,
  ) => Promise<
    | { readonly saved: true; readonly next: string }
    | { readonly saved: false; readonly reason: string; readonly message?: string }
  >;
};

export interface AgentPluginConnectResult {
  readonly status: "connected" | "waiting-for-sign-in" | "not-connected";
  readonly cancelled?: boolean;
  readonly note?: string;
  readonly connectionRef?: string;
  readonly reason?: string;
  readonly message?: string;
  readonly next?: string;
}

/** A stored credential is reusable only on the same plugin-owned endpoint. No I/O or mutation.
 * @complexity O(1) time and space. */
function hasReusablePluginCredential(
  { row, pluginId, url }: { row: AgentPluginMcpRecord | null; pluginId: string; url: string },
  optional: { projections: AgentPluginMcpProjections },
): boolean {
  if (!row) return false;
  const reusableOwner = row.provisionedByPluginId === null || row.provisionedByPluginId === pluginId;
  return reusableOwner && row.url === url && hasStoredAgentPluginCredential({ row, projections: optional.projections });
}

/** Connect a token-only declaration through the existing card, or retain the API-connection path.
 * @returns Connected only for an existing credential or a successful save; preserves card failures.
 * @throws {ToolInputError} Ambiguous token servers, invalid server id, or a missing save adapter.
 * @complexity O(s) time/space in declared servers, one row read, then the card's bounded exchange. */
async function connectWithoutOAuth(
  { routeDeps, surfaces, ctx, pluginId, servers }: {
    routeDeps: ConnectDeps; surfaces: unknown; ctx: ToolExecutionContext;
    pluginId: string; servers: Readonly<Record<string, McpServerConfig>>;
  },
  { saveToken, ...optional }: AgentPluginConnectOptions = {},
): Promise<AgentPluginConnectResult> {
  const tokens = Object.entries(servers).filter((entry): entry is [string, RemoteMcpServerConfig] =>
    entry[1].type !== "stdio" && entry[1].tokenAuth !== undefined);
  if (tokens.length === 0) return connectDeclaredApiConnectionOrRefuse(routeDeps, surfaces, ctx, pluginId, optional);
  if (tokens.length > 1) throw new ToolInputError({ message: routeDeps.host.messages.multipleTokenServers({ pluginId }) });
  const [serverKey, config] = tokens[0]!;
  const serverId = deriveAgentPluginConnectionId(serverKey);
  if (!serverId) throw new ToolInputError({ message: routeDeps.host.messages.connectionNotSetUp({ pluginId, serverKey }) });
  ctx.signal.throwIfAborted();
  const row = await routeDeps.mcp.repo.findByServerId({ workspaceId: routeDeps.workspaceId, serverId });
  ctx.signal.throwIfAborted();
  if (hasReusablePluginCredential({ row, pluginId, url: config.url }, routeDeps.mcp)) {
    const approved = await approveSignedInAccess({ routeDeps, surfaces, ctx, pluginId, servers: { [serverKey]: config } }, optional);
    if (!approved.approved) return approved.result;
    await provisionAgentPluginMcpServers(routeDeps.mcp, { workspaceId: routeDeps.workspaceId, pluginId, servers: { [serverKey]: config }, principalId: ctx.principal.id, ...routeDeps.host.federation });
    return { status: 'connected' };
  }
  if (!saveToken) throw new ToolInputError({ message: routeDeps.host.messages.noTokenCardAdapter() });
  const result = await saveToken({ ctx, pluginId }, optional);
  if (result.saved) return { status: "connected", next: result.next };
  return { status: "not-connected", reason: result.reason, ...(result.message ? { message: result.message } : {}) };
}

/** Deny before reading an off plugin's connection instructions or starting a sign-in.
 * @throws ToolInputError naming the existing approval flow when activation is off/unverifiable.
 * @complexity One activation-owner read, no connection reads or writes.
 */
async function assertPluginCanConnect({ routeDeps, pluginId }: { routeDeps: ConnectDeps; pluginId: string }, _options = {}): Promise<void> {
  const active = await routeDeps.isPluginEnabled(pluginId);
  if (!active) throw new ToolInputError({ message: routeDeps.host.messages.pluginOff({ pluginId }) });
}

/**
 * Runs `agent_plugin_connect`: permission, resolve, then the declared token, OAuth or API flow.
 * @example runAgentPluginConnect({ routeDeps, surfaces, ctx, pluginId }, { saveToken });
 *
 * @returns Safe connection status; token-card failure reasons remain observable.
 * @throws {import("@jini-ai/core").ToolInputError} An unknown `pluginId`, unsupported connection,
 *   ambiguous token servers or more than one still-unconnected OAuth server (see the header).
 * @throws {Error} No `externalMcpOAuth` was wired, or this execution context has no `emitSurface` —
 *   both composition-root/transport gaps, not caller input.
 * @complexity O(s) provisioning the plugin's declared servers, plus the poll loop (bounded by
 *   `waitTimeoutMs`); O(s) space for pending declarations.
 */
export async function runAgentPluginConnect<Surfaces, Connection>(
  { routeDeps, surfaces, ctx, pluginId }: {
    routeDeps: AgentPluginConnectDeps<Surfaces, Connection>; surfaces: Surfaces; ctx: ToolExecutionContext; pluginId: string;
  },
  optional: AgentPluginConnectOptions = {},
): Promise<AgentPluginConnectResult> {
  ctx = { ...ctx, principal: { ...ctx.principal }, run: { ...ctx.run }, input: structuredClone(ctx.input) };
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: routeDeps.host.permissions.connect }, { entityType: routeDeps.host.entityType, entityId: pluginId });

  await assertPluginCanConnect({ routeDeps, pluginId });

  const plugin = await routeDeps.resolveInstalledPlugin(pluginId);
  if (!plugin) {
    throw new ToolInputError({ message: routeDeps.host.messages.notInstalled({ pluginId }) });
  }

  const oauthServerKeys = Object.entries(plugin.servers)
    .filter(([, config]) => isOAuthServer(config))
    .map(([serverKey]) => serverKey);
  if (oauthServerKeys.length === 0) return connectWithoutOAuth({ routeDeps, surfaces, ctx, pluginId, servers: plugin.servers }, optional);
  if (!routeDeps.externalMcpOAuth) {
    throw new Error(routeDeps.host.messages.noOAuthService());
  }
  const externalMcpOAuth = routeDeps.externalMcpOAuth;

  // A retained session may need new access, but declining that card must not provision other
  // sources or adopt an operator's independently configured credential-bearing connection.
  const signedIn = await retainedOAuthServers({ routeDeps, servers: plugin.servers, oauthServerKeys });
  const access = await approveSignedInAccess({ routeDeps, surfaces, ctx, pluginId, servers: signedIn }, optional);
  if (!access.approved) return access.result;

  const provisioned = await provisionAgentPluginMcpServers(
    routeDeps.mcp,
    { workspaceId: routeDeps.workspaceId, pluginId, servers: plugin.servers, principalId: ctx.principal.id, ...routeDeps.host.federation },
  );

  // A colliding row can survive a refused provisioning attempt; never start sign-in on it.
  const refusal = [...provisioned.failed, ...provisioned.skipped]
    .find(result => oauthServerKeys.includes(result.serverKey));
  if (refusal) {
    throw new ToolInputError({ message: routeDeps.host.messages.connectionNotSetUp({ pluginId, serverKey: refusal.serverKey }) });
  }
  const pending = await resolvePendingOAuthServers(routeDeps, pluginId, oauthServerKeys);
  const [server] = pending;
  // Every declared OAuth server is already connected: no sign-in to start.
  if (!server) return { status: "connected" };
  if (pending.length > 1) {
    throw new ToolInputError({ message: routeDeps.host.messages.multipleOAuthServers({ pluginId, serverKeys: pending.map((p) => p.serverKey) }) });
  }

  const credentialCard = await findPluginOAuthCard(routeDeps, pluginId);
  return connectAndReviewMcp({ routeDeps, surfaces, ctx, pluginId, server, externalMcpOAuth, credentialCard, servers: plugin.servers }, optional);
}

/** Complete sign-in before reviewing defaults still missing from a prior access choice.
 * @complexity The existing bounded sign-in wait, then two source previews and conditional writes. */
async function connectAndReviewMcp(
  input: Parameters<typeof waitAtMcpSignInCard>[0] & { servers: Readonly<Record<string, McpServerConfig>> },
  optional: ToolExecutionOptions = {},
): Promise<AgentPluginConnectResult> {
  const result = await waitAtMcpSignInCard(input, optional);
  if (result.status !== 'connected') return result;
  const { routeDeps, surfaces, ctx, pluginId, server, servers } = input;
  const reviewed = await approveSignedInAccess({ routeDeps, surfaces, ctx, pluginId,
    servers: { [server.serverKey]: servers[server.serverKey]! } }, optional);
  if (reviewed.approved) return result;
  const reviewEnd = reviewed.result.reason === 'expired' ? 'expired' : 'ended with the run';
  const lifecycle = reviewed.result.reason
    ? ` The access review ${reviewEnd}. Do not retry or reopen it automatically. Wait for a new explicit request.` : '';
  return { ...reviewed.result, note: `Your sign-in was saved. No additional tool access was granted.${lifecycle}` };
}

/** Inspect retained sign-ins before any provisioning; the access preview checks source ownership. */
async function retainedOAuthServers({ routeDeps, servers, oauthServerKeys }: {
  routeDeps: ConnectDeps; servers: Readonly<Record<string, McpServerConfig>>; oauthServerKeys: readonly string[];
}, _optional = {}): Promise<Readonly<Record<string, McpServerConfig>>> {
  const retained: Record<string, McpServerConfig> = {};
  for (const key of oauthServerKeys) {
    const connectionId = deriveAgentPluginConnectionId(key);
    const row = connectionId ? await routeDeps.mcp.repo.findByServerId({ workspaceId: routeDeps.workspaceId, serverId: connectionId }) : null;
    if (row && hasStoredAgentPluginCredential({ row, projections: routeDeps.mcp.projections })) retained[key] = servers[key]!;
  }
  return retained;
}

/** A retained credential proves sign-in, never consent to new tool or write grants.
 * The common card fixes the exact sources; the existing grant writer applies those snapshots.
 * @complexity Two previews over the signed-in sources plus one conditional write per changed row. */
async function approveSignedInAccess({ routeDeps, surfaces, ctx, pluginId, servers }: {
  routeDeps: ConnectDeps; surfaces: unknown; ctx: ToolExecutionContext;
  pluginId: string; servers: Readonly<Record<string, McpServerConfig>>;
}, optional: ToolExecutionOptions = {}): Promise<{ approved: true } | { approved: false; result: AgentPluginConnectResult }> {
  const preview = () => previewAgentPluginEnableAccess({ workspaceId: routeDeps.workspaceId, pluginId, servers, repo: routeDeps.mcp.repo, projections: routeDeps.mcp.projections, classifyError: routeDeps.mcp.classifyError, ...routeDeps.host.federation });
  const handler = routeDeps.host.approvals.accessApprovalHandler({ surfaces,
    prepare: preview,
    describe: ({ ctx: bound, prepared }) => ({ toolId: routeDeps.host.toolId, errorCode: routeDeps.host.approvalErrorCode, title: `Allow access for ${pluginId}?`,
      ...(prepared.resources.length ? { access: { resources: prepared.resources.map(resource => ({ ...resource, scope: { personId: bound.principal.id, siteId: routeDeps.workspaceId } })) } } : {}),
      details: [], description: 'Your existing sign-in is reused. Only the listed access is turned on.', confirmLabel: 'Allow access' }),
    run: async ({ ctx: bound, prepared }) => {
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: bound.principal.id, permission: routeDeps.host.permissions.connect }, { entityType: routeDeps.host.entityType, entityId: pluginId });
      await assertPluginCanConnect({ routeDeps, pluginId });
      const current = await currentSignedInAccess({ routeDeps, pluginId, servers });
      if (current.preview.key !== prepared.key) throw new ToolInputError({ message: 'The plugin access changed while this card was open. Request the access change again. Nothing was granted.' });
      const granted: string[] = [];
      try {
        for (const source of prepared.snapshots) {
          if (!source.grant || !source.expected) continue;
          if (bound.signal.aborted) throw new ToolInputError({ message: 'The run ended. Other connections were not changed.' });
          await routeDeps.mcp.applyAccess({
            workspaceId: routeDeps.workspaceId, serverId: source.connectionId, expected: source.expected,
            access: { enabled: source.grant.enabled, allowedToolNames: source.grant.allow, writeAllowedToolNames: source.grant.write }, principalId: bound.principal.id });
          granted.push(source.connectionId);
        }
        await routeDeps.mcp.notifyRosterChanged?.({}, {});
      } catch (error) {
        if (granted.length === 0) throw error;
        const detail = redactSecrets({ input: String(error) }).replace('Nothing was changed by this approval.', 'That connection was left unchanged.');
        throw new ToolInputError({ message: `Access was saved for ${granted.join(', ')}. The remaining access update did not finish. ${detail} Ask to connect the plugin again to finish.` });
      }
      return { approved: true };
    },
  }, { ask: ({ prepared }) => prepared.resources.length > 0, declined: async ({ reason, prepared }) => {
    if (reason === 'declined' && prepared) await recordAgentPluginAccessDeclined({ applyAccess: routeDeps.mcp.applyAccess, workspaceId: routeDeps.workspaceId, accessKey: prepared.key, actorId: routeDeps.host.actors.connectDeclined });
    return { approved: false, result: { status: 'not-connected', ...routeDeps.host.approvals.notConfirmedResult({ reason }) } };
  } });
  return await handler(ctx, optional) as { approved: true } | { approved: false; result: AgentPluginConnectResult };
}

/** Re-resolve the installed declarations: a closed-over manifest is not a fresh approval check. */
async function currentSignedInAccess({ routeDeps, pluginId, servers }: {
  routeDeps: ConnectDeps; pluginId: string; servers: Readonly<Record<string, McpServerConfig>>;
}, _optional = {}) {
  const installed = await routeDeps.resolveInstalledPlugin(pluginId);
  const current: Record<string, McpServerConfig> = {};
  for (const key of Object.keys(servers)) {
    const config = installed?.servers[key];
    if (!config) throw new ToolInputError({ message: `The '${pluginId}' connection declaration changed after approval. Request the access change again. Nothing was granted.` });
    current[key] = config;
  }
  return { servers: current, preview: await previewAgentPluginEnableAccess({ workspaceId: routeDeps.workspaceId, pluginId, servers: current, repo: routeDeps.mcp.repo, projections: routeDeps.mcp.projections, classifyError: routeDeps.mcp.classifyError, ...routeDeps.host.federation }) };
}

/** Show one MCP sign-in and always release its surface exchange after the bounded wait. */
async function waitAtMcpSignInCard(
  input: {
    readonly routeDeps: ConnectDeps;
    readonly surfaces: unknown;
    readonly ctx: ToolExecutionContext;
    readonly pluginId: string;
    readonly server: PendingOAuthServer;
    readonly externalMcpOAuth: AgentPluginConnectSignInPort;
    readonly credentialCard?: PluginCredentialCard;
  },
  optional: ToolExecutionOptions = {},
): Promise<AgentPluginConnectResult> {
  const { routeDeps, surfaces, ctx, pluginId, server, externalMcpOAuth, credentialCard } = input;
  if (!optional.emitSurface) {
    throw new Error(routeDeps.host.messages.missingEmitter());
  }
  const signInUrl = await beginSignIn({ oauth: externalMcpOAuth, serverId: server.connectionId, derivedPublicOrigin: routeDeps.derivedPublicOrigin, host: routeDeps.host });
  return routeDeps.host.waitAtSignInCard({ surfaces, ctx, pluginId, pluginDisplayName: titleCaseFromPluginId({ pluginId }), credentialCard,
    connect: async ({ signal, showSignIn }) => {
      await showSignIn({ signInUrl });
      const connected = await waitForMcpConnection({ routeDeps, ctx: { ...ctx, signal }, server });
      return { status: connected ? "connected" : "waiting-for-sign-in" };
    },
  }, optional);
}

/** Observe the MCP row until callback completion, timeout or cancellation. */
async function waitForMcpConnection(
  input: {
    readonly routeDeps: ConnectDeps;
    readonly ctx: ToolExecutionContext;
    readonly server: PendingOAuthServer;
  },
  _options = {},
): Promise<boolean> {
  const { routeDeps, ctx, server } = input;
  const pollIntervalMs = routeDeps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const waitTimeoutMs = routeDeps.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() < deadline && !ctx.signal.aborted) {
    const row = await routeDeps.mcp.repo.findByServerId({ workspaceId: routeDeps.workspaceId, serverId: server.connectionId });
    if (row && routeDeps.mcp.projections.oauthStatus(row) === "connected") {
      return true;
    }
    await sleepOrAbort(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0)), ctx.signal);
  }
  return false;
}

/**
 * The API-connection branch (or the original "nothing to connect" refusal): same card and parked wait as the MCP
 * branch, plus the opaque `connectionRef` the plugin's tools take, over Jini's api-connections lifecycle instead of an external-MCP row. One declared
 * connection per call, for the same reason the MCP branch takes one pending server.
 * @throws {ToolInputError} More than one declared connection, or a sign-in refusal (safe message).
 * @throws {Error} No interactive channel to show the sign-in card on.
 * @complexity One sign-in round trip bounded by `waitTimeoutMs`.
 */
/** The plugin's own `oauth` card copy for its sign-in card, shared by the MCP and API-connection branches. O(cards). */
async function findPluginOAuthCard(routeDeps: ConnectDeps, pluginId: string): Promise<PluginCredentialCard | undefined> {
  const cards = await routeDeps.credentials.loadSafe({ workspaceId: routeDeps.workspaceId });
  return cards.find(card => card.pluginId === pluginId && card.saveKind === "oauth");
}

async function connectDeclaredApiConnectionOrRefuse(
  routeDeps: ConnectDeps,
  surfaces: unknown,
  ctx: ToolExecutionContext,
  pluginId: string,
  optional: ToolExecutionOptions,
): Promise<AgentPluginConnectResult> {
  const apiConnections = routeDeps.apiConnections;
  const declared: readonly unknown[] = apiConnections ? await apiConnections.listConnections({ pluginId }) : [];
  const [connection] = declared;
  if (!apiConnections || !connection) {
    throw new ToolInputError({ message: routeDeps.host.messages.noConnection({ pluginId }) });
  }
  if (declared.length > 1) {
    throw new ToolInputError({ message: routeDeps.host.messages.multipleApiConnections({ pluginId, count: declared.length }) });
  }
  const destination = await routeDeps.host.chooseDestination({ surfaces, ctx, pluginDisplayName: titleCaseFromPluginId({ pluginId }),
    available: apiConnections.sharingAvailable === true && ctx.principal.id === await routeDeps.ownerPrincipalId }, optional);
  if (destination === null) return { status: 'not-connected', reason: 'cancelled', next: 'Sign-in was cancelled. Continue without this connection.' };
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: routeDeps.host.permissions.apiConnectionWrite });
  const credentialCard = await findPluginOAuthCard(routeDeps, pluginId);
  return routeDeps.host.waitAtSignInCard({ surfaces, ctx, pluginId, pluginDisplayName: titleCaseFromPluginId({ pluginId }), credentialCard,
    connect: ({ signal, showSignIn }) => apiConnections.connect({
      destination, connection, actorId: ctx.principal.id, signal, showSignIn,
      pollIntervalMs: routeDeps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      waitTimeoutMs: routeDeps.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
    }),
  }, optional);
}
