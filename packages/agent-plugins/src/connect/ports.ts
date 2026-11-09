/** Consumer-owned service boundaries. Composition binds concrete services and secret stores. */
import type { ChatAgentPlugins } from "@jini-ai/agent-plugins/lifecycle";
import type { SurfaceCardsPort, SurfaceCardSecretForm as SecretCardForm } from "@jini-ai/core/contracts/cards";
import type { ExternalMcpConnectStart, ExternalMcpServerRepoPort, ExternalMcpServerView, SaveExternalMcpServerInput } from "../external-mcp/contracts.js";
import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";
import type { DeclaredApiConnection } from "../api-connections/contribution.js";
import type { ApiConnectionConnectStatus } from "../api-connections/connect.js";

/** Roster persistence and safe classification; sealing/keyring dependencies stay in composition. */
export interface AgentPluginMcpPort {
  readonly repo: AgentPluginMcpRepo;
  /** Atomically save exactly the approved source and previous grants through the store owner. */
  applyAccess(input: import("../../contracts/core/external-mcp-access.js").ExternalMcpApprovedAccess, options?: Record<string, never>): Promise<void>;
  saveServer(input: AgentPluginMcpSave, options?: Record<string, never>): Promise<AgentPluginMcpView>;
  classifyError(input: { error: unknown }, options?: Record<string, never>): "validation" | "unconfigured" | "other";
  notifyRosterChanged(input: { readonly lowered?: import("@jini-ai/daemon").ToolAccessChange }, options?: Record<string, never>): Promise<void>;
}

/** Connect-time OAuth discovery and the existing validation error identity, adapted by composition. */
export interface AgentPluginOAuthPort {
  beginConnect(input: { serverId: string; redirectUri?: string; delivery?: "hosted" }, options?: Record<string, never>): Promise<ExternalMcpConnectStart>;
  /** @agent-note Same rule as {@link AgentPluginSignInPort.isSignInRefusal}: true only for a refusal
   * that opened no card (the key-card fallback is offered); every other fault propagates unchanged. */
  isSignInRefusal(input: { error: unknown }, options?: Record<string, never>): boolean;
}

/** Plugin-declared credential cards and the guarded, read-only token probe. */
export interface PluginCredentialsPort {
  apply(input: { card?: PluginCredentialCard; form: SecretCardForm }, options?: Record<string, never>): SecretCardForm;
  loadSafe(input: { workspaceId: string }, options?: Record<string, never>): Promise<readonly PluginCredentialCard[]>;
  find(input: { workspaceId: string; saveKind: PluginCredentialCard["saveKind"]; target: string }, options?: Record<string, never>): Promise<PluginCredentialCard | undefined>;
  probe(input: { probeUrl: string; token: string }, options?: Record<string, never>): Promise<"ok" | "refused" | "unavailable">;
}

/** Effective operator preferences with principal resolution supplied by the host. */
export interface AgentPluginPreferencesPort {
  locale(input: { workspaceId: string; principalId: string }, options?: Record<string, never>): Promise<string>;
  /** Anything but the stored Ask or Off preference (including no value) resolves to Auto. */
  mode(input: { workspaceId: string; principalId: string }, options?: Record<string, never>): Promise<ChatAgentPlugins>;
  /** Effective mode plus the addressed personal layer's revision, fixed before the approval. */
  snapshot(input: { workspaceId: string; principalId: string }, options?: Record<string, never>): Promise<{ mode: ChatAgentPlugins; revisionSeq: number }>;
  saveAuto(input: { workspaceId: string; principalId: string; expectedRevisionSeq?: number }, options?: Record<string, never>): Promise<void>;
}

/** Declared API connections; the host retains OAuth clients, browser binding and token custody. */
export interface AgentPluginApiConnectionsPort {
  readonly sharingAvailable?: boolean;
  listConnections(input: { pluginId: string }, options?: Record<string, never>): Promise<readonly DeclaredApiConnection[]>;
  connect(input: { destination?: 'site' | 'shared'; connection: DeclaredApiConnection; actorId: string; signal: AbortSignal; pollIntervalMs: number; waitTimeoutMs: number; showSignIn: (input: { readonly signInUrl: string }) => Promise<void> }, options?: Record<string, never>): Promise<ApiConnectionConnectStatus>;
}

/** Resolved host paths; consumers take only the facts they need. */
export interface AgentPluginPathsPort {
  readonly siteDir: string;
  readonly bundledSourceRoot: string;
}

/** @agent-note These aliases stay in Tovu until the H0/H1 vocabulary lane. Never copy the record,
 * access snapshot or repository: adoption must retain the canonical store's whole saved row. */
export type AgentPluginMcpRecord = import('../external-mcp/contracts.js').ExternalMcpServerRecord;
export type AgentPluginMcpSave = SaveExternalMcpServerInput;
export type AgentPluginMcpView = ExternalMcpServerView;
export type AgentPluginMcpRepo = Pick<ExternalMcpServerRepoPort, 'findByServerId' | 'upsert' | 'deleteByServerId' | 'updateAccessIfCurrent'>;
export type AgentPluginMcpAccessSnapshot = import('../../contracts/core/external-mcp-access.js').ExternalMcpAccessSnapshot;
/** @agent-note A second host supplies all six projections together with the paired
 * {@link AgentPluginMcpProjectionPorts.classifyError}; preview, provisioning, sign-in revalidation and
 * status reads must all receive the SAME object, never a per-call default. */
export interface AgentPluginMcpProjections {
  /** @agent-note The canonical saved representation of a row's admitted source. The snapshot must be
   * JSON-serializable with a stable key order: approval revalidation compares JSON.stringify of the
   * previewed and re-read snapshots byte-for-byte, so any reordering refuses a valid approval. */
  readonly accessSnapshot: typeof import('../../contracts/core/external-mcp-access.js').externalMcpAccessSnapshot;
  /** @agent-note Canonical saved admission revision; same stability rule as `accessSnapshot`. */
  readonly admissionRevision: typeof import('../../contracts/core/external-mcp-access.js').externalMcpAdmissionRevision;
  /** @agent-note With `{ strict: true }` an unreadable stored list throws; it never reads as an empty
   * or fresh grant, which would silently widen or drop an existing grant. */
  readonly readToolGrants: typeof import('../../contracts/core/external-mcp-access.js').readExternalMcpToolGrants;
  /** @agent-note Throws an error the paired `classifyError` reports as `'validation'`; its message is
   * the public repair reason shown to the model, so it must never carry credential material. */
  readonly validateToolNames: typeof import('../../contracts/core/external-mcp-access.js').validateExternalMcpToolNames;
  /** @agent-note Pure: no I/O, no cache, never opens sealed credential material (status reads stay token-free). */
  readonly oauthStatus: typeof import('../../contracts/core/external-mcp-auth.js').resolveExternalMcpOAuthStatus;
  /** @agent-note Pure: no I/O, no cache, never opens sealed credential material (status reads stay token-free). */
  readonly hasStaticAccessToken: typeof import('../../contracts/core/external-mcp-auth.js').externalMcpRecordHasStaticAccessToken;
}
/** @agent-note Bound once per binding/factory and passed whole: a host never supplies one half. */
export interface AgentPluginMcpProjectionPorts {
  readonly projections: AgentPluginMcpProjections;
  /** @agent-note Paired with `projections.validateToolNames`: whatever it throws classifies as
   * `'validation'`. Classification alone does not redact; consumers redact before model text. */
  readonly classifyError: AgentPluginMcpPort['classifyError'];
}
/** Old Tovu entry signatures only: custom projections always come with their classifier. */
export type AgentPluginMcpContext = AgentPluginMcpProjectionPorts | { readonly projections?: undefined; readonly classifyError?: AgentPluginMcpPort['classifyError'] };
/** New composition must fulfill the full contract. */
export interface AgentPluginMcpServicesPort extends Omit<AgentPluginMcpPort, 'classifyError'>, AgentPluginMcpProjectionPorts {}
export interface AgentPluginSignInPort {
  readonly beginConnect: AgentPluginOAuthPort['beginConnect'];
  /** @agent-note True only for a refusal that opened NO card, so chat offers the key-card fallback;
   * any other fault returns false and propagates unchanged. Matching does not make a message safe:
   * the consumer passes model-facing text through the core redaction boundary. */
  isSignInRefusal(required: { error: unknown }, optional?: Record<string, never>): boolean;
}
/** Resource stays concrete through waitAtSignInCard's card callback. */
export type AgentPluginCardsPort<Resource> = SurfaceCardsPort<Resource>;
export type AgentPluginCardBuilders<Resource> = Omit<AgentPluginCardsPort<Resource>, 'waitAtSignInCard'>;
