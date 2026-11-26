import type { PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
import type { ExternalMcpConnectStart } from '@jini-ai/core/contracts/hosted-mcp';
import type { Logger } from '@jini-ai/core/primitives';
import type { LegacyToolAuthorizeFn as AuthorizeFn, AccessApprovalDescription, ToolHandler, ToolExecutionOptions, ToolExecutionContext } from '@jini-ai/core';
import type { AgentPluginMcpTrustClassifier } from './federate-mcp.js';
import type { AgentPluginEnableAccessMessages } from './enable-access.js';
import type { AgentPluginMcpPort, AgentPluginMcpProjectionPorts } from './ports.js';
import type { ResolvedAgentPluginForConnect } from './installed-plugin.js';

/** The sign-in start this tool needs: only a hosted `redirect_required` start opens the connect card.
 * @agent-note Second host: bind your hosted-MCP OAuth service. `isSignInRefusal` is true only for a
 * refusal that opened NO card (chat then offers the key-card fallback); every other fault returns false
 * and propagates unchanged. Matching never makes a message safe: this tool redacts before model text. */
export interface AgentPluginConnectSignInPort {
  beginConnect(input: { serverId: string; redirectUri?: string | undefined; delivery?: "hosted" }, options?: Record<string, never>): Promise<ExternalMcpConnectStart>;
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
  /** @agent-note Fail closed unless the bound authenticated approver is an active human,
   * checked BEFORE disclosing the prepared access card and AGAIN after explicit confirmation,
   * before `run`. The authenticated answer must bind the same tool/exchange, scope and person
   * as the frozen requesting context; caller-supplied answer fields cannot establish authority.
   * Missing, stale, revoked or mismatched authority must never disclose the card or run the grant.
   * Recheck permission, activation and the prepared access fingerprint after confirmation too. */
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

/** What this tool asks the approvals port to render. Wording is neutral; ids are host input.
 * @agent-note Render this fixed description through your approval owner; its display ids do not
 * replace the bound principal or the prepared access fingerprint rechecked by run. */
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
  /** `credentialCards` is given only for a plugin that declares no OAuth sign-in: its key cards, to name instead of a connect retry. */
  pluginOff(required: { pluginId: string }, optional?: { credentialCards?: readonly PluginCredentialCard[] }): string;
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
  readonly publicUrl: { redirectUri(required: { serverId: string; derivedPublicOrigin?: string | undefined }): string | undefined };
  /** @agent-note Your lifecycle trust rule and federation/enable-access refusal copy (same objects your
   * provisioning and enable-access previews use, so plans and fingerprints agree). */
  readonly federation: { readonly classifyTrust: AgentPluginMcpTrustClassifier; readonly messages: AgentPluginEnableAccessMessages };
  /** @agent-note Actor recorded when a person declines the access card (`AgentPluginConnectActors.connectDeclined`). */
  readonly actors: { readonly connectDeclined: string };
  /** @agent-note Your sign-in card waiter (typically `waitAtAgentPluginSignInCardWithPorts` bound to your cards,
   * card identity and SAME process exchange store). Skip resolves with your skipped result. */
  waitAtSignInCard(required: {
    surfaces: Surfaces; ctx: ToolExecutionContext; pluginId: string; pluginDisplayName: string; credentialCard?: PluginCredentialCard | undefined;
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
  readonly report?: Pick<Logger, 'warn'>;
  readonly ownerPrincipalId?: Promise<string>;
  /** Fresh activation owner; injected so OFF-plugin refusal needs no filesystem in unit tests. */
  readonly isPluginEnabled: (pluginId: string) => Promise<boolean>;
  readonly credentials: { loadSafe(input: { workspaceId: string }, options?: Record<string, never>): Promise<readonly PluginCredentialCard[]> };
  readonly workspaceId: string;
  readonly authorize: AuthorizeFn;
  readonly mcp: AgentPluginMcpProjectionPorts & Pick<AgentPluginMcpPort, "repo" | "saveServer" | "applyAccess"> & Partial<Pick<AgentPluginMcpPort, "notifyRosterChanged">>;
  readonly externalMcpOAuth?: AgentPluginConnectSignInPort;
  readonly derivedPublicOrigin?: string | undefined;
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
export type ConnectDeps = AgentPluginConnectDeps<unknown, unknown>;

/** The injected adapter calls the existing token-card lifecycle without a runtime import cycle.
 * @agent-note Bind your token-card owner with the SAME principal, emitter/options and exchange
 * store. Only safe saved/refusal results return; plaintext tokens never pass through this adapter. */
export type AgentPluginConnectOptions = ToolExecutionOptions & {
  readonly saveToken?: (
    input: { readonly ctx: ToolExecutionContext; readonly pluginId: string },
    optional?: ToolExecutionOptions,
  ) => Promise<
    | { readonly saved: true; readonly next: string }
    | { readonly saved: false; readonly reason: string; readonly message?: string }
  >;
};

/** @agent-note Public connection status only. Host refusal/next-step copy must be safe; no token,
 * provider response body or private sign-in state belongs in these fields. */
export interface AgentPluginConnectResult {
  readonly status: "connected" | "waiting-for-sign-in" | "not-connected";
  readonly cancelled?: boolean;
  readonly note?: string;
  readonly connectionRef?: string;
  readonly reason?: string;
  readonly message?: string;
  readonly next?: string;
}

