import type { Clock } from '@jini-ai/core/primitives';
import type { OAuthAppOptions, OAuthClient, OAuthHttpPorts } from '@jini-ai/core/contracts/oauth';
import type { ApiConnectionDeclaration, ApiConnectionHooksModule } from './declarations.js';
import type { ApiConnectionClientKind } from './deps.js';
import type { ApiConnectionError } from './errors.js';
import type { ApiConnectionRecordStore, ApiConnectionTokenStore } from './ports.js';
import type { ApiConnectionService } from './service.js';
import type { SharedOAuthConnection } from './shared.js';
import type { ApiConnectionAccount, ApiConnectionAttempt, ApiConnectionDescriptor } from './types.js';
import type { CreateConnectionBudgetLimiter } from './budgets.js';

export type ApiConnectionRuntime = 'hosted' | 'desktop';

/** The trusted projection a host loader returns; declarations and hooks remain in this domain. */
export interface DeclaredApiConnection {
  readonly pluginId: string;
  readonly descriptor: ApiConnectionDescriptor;
  readonly clients: ApiConnectionDeclaration['clients'];
  readonly budgets: ApiConnectionDeclaration['budgets'];
  readonly scopeSets: ApiConnectionDeclaration['scopeSets'];
  readonly apiOrigins: ApiConnectionDeclaration['apiOrigins'];
  readonly byoClient: ApiConnectionDeclaration['byoClient'];
  readonly module: ApiConnectionHooksModule;
}

/** Buffered request options only; the host retains URL, redirect and DNS policy enforcement. */
export interface ApiConnectionHttpOptions {
  readonly method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}
export interface PluginHttp {
  fetch(required: { readonly url: string }, optional?: ApiConnectionHttpOptions): Promise<Response>;
}

/** A non-consuming attempt lookup is needed by the host's public callback route. */
export interface ApiConnectionHostRecordStore extends ApiConnectionRecordStore {
  peekAttempt(required: { readonly state: string }, optional?: Record<string, never>): Promise<ApiConnectionAttempt | null>;
}
export interface ApiConnectionHostStorage {
  readonly records: ApiConnectionHostRecordStore;
  tokensFor(required: { owner: { workspaceId: string; pluginId: string; connectionId: string; clientId: string } }): ApiConnectionTokenStore;
}

/** Only the selected credential's client fields and allowed origins cross this boundary. */
export interface ApiConnectionByoCredential {
  readonly connection: { readonly username?: string | undefined; readonly token: string };
  /**
   * The saved credential's allowed origins, projected only when called.
   * @agent-note Deferred on purpose: `resolveByoClient` calls it after the read has resolved and
   * outside the read's "unreadable" catch, so a projection failure (e.g. a malformed saved base URL)
   * rejects with the host's own raw error instead of being reported as an unreadable credential.
   */
  readonly allowedOrigins: () => readonly string[];
}
export type ApiConnectionByoRefusal = { connection: Pick<DeclaredApiConnection, 'descriptor'>; label: string } & (
  { problem: 'unreadable' | 'missing-client-id' } | { problem: 'wrong-origin'; tokenOrigin: string }
);
export interface ApiConnectionByoCredentials {
  read(required: { workspaceId: string; label: string }): Promise<ApiConnectionByoCredential | null>;
  refuse(required: ApiConnectionByoRefusal): ApiConnectionError;
}

/** Sealed owner context is projected by the host's existing shared storage, never copied or reissued. */
export interface ApiConnectionSharedIssuingContext {
  readonly credentialId: string;
  readonly identity: SharedOAuthConnection['identity'];
  readonly client: OAuthClient;
  readonly clientKind: ApiConnectionClientKind;
  readonly descriptor: ApiConnectionDescriptor;
}
export interface ApiConnectionSharedStorage {
  readonly records: ApiConnectionRecordStore;
  readContext(required: { credentialId: string }): Promise<ApiConnectionSharedIssuingContext | null>;
  tokensFor(required: { context: ApiConnectionSharedIssuingContext }): ApiConnectionTokenStore;
}
export interface ApiConnectionPreparedSignIn {
  readonly service: ApiConnectionService;
  readonly workspaceId: string;
  onCompleted(): Promise<void>;
}
export interface ApiConnectionSharedConnections {
  bind(required: { keyId: string; use: boolean }, optional?: Record<string, never>): Promise<void>;
  hasBinding(connection: DeclaredApiConnection, optional?: Record<string, never>): Promise<boolean>;
  getStatus(connection: DeclaredApiConnection, optional?: Record<string, never>): Promise<SharedOAuthConnection | null>;
  readAccount(connection: DeclaredApiConnection, optional?: Record<string, never>): Promise<ApiConnectionAccount | null>;
  getAccessToken(connection: DeclaredApiConnection, optional?: { expectedAccountId?: string }): Promise<string>;
  selectLocal(connection: DeclaredApiConnection, optional?: Record<string, never>): Promise<void>;
  stopUsing(connection: DeclaredApiConnection, optional?: Record<string, never>): Promise<void>;
  prepare(required: { connection: DeclaredApiConnection; actorId: string; context: ApiConnectionSharedIssuingContext; redirectUri?: string }, optional?: Record<string, never>): Promise<ApiConnectionPreparedSignIn>;
}
export interface ApiConnectionSharedFactoryInput {
  readonly workspaceId: string;
  readonly listConnections: (required: { pluginId: string }) => Promise<readonly DeclaredApiConnection[]>;
  readonly requestedScopes: (required: { connection: DeclaredApiConnection; scopeSetIds: readonly string[] }) => Promise<readonly string[]>;
  readonly createService: (required: { connection: DeclaredApiConnection; context: ApiConnectionSharedIssuingContext; redirectUri?: string }) => ApiConnectionService;
}
/**
 * What a host binds once for the API-connection runtime.
 * @agent-note The host binds its one storage owner, fresh declaration loader, guarded HTTP,
 * credential projection and application identity. These ports never construct a host or store.
 */
export interface ApiConnectionHostPorts {
  readonly apiConnectionStorage: ApiConnectionHostStorage;
  readonly loadDeclaredConnections: (required: { workspaceId: string }) => Promise<{ connections: readonly DeclaredApiConnection[]; refusals: readonly string[] }>;
  readonly createSharedConnections: (required: ApiConnectionSharedFactoryInput) => ApiConnectionSharedConnections;
  readonly appIdentity: Pick<OAuthAppOptions, 'clientDisplayName' | 'softwareId'>;
  readonly byoCredentials: ApiConnectionByoCredentials;
  readonly createLimiter: CreateConnectionBudgetLimiter;
}

/** Connection attempt outcomes are projected through a local shape; the host supplies their owner. */
export interface ApiConnectionSignInAttempt { readonly code: string; readonly nextAction: string }
export interface ApiConnectionCallbackKey { readonly workspaceId: string; readonly pluginId: string; readonly connectionId: string; readonly attemptId: string }
export interface ApiConnectionCallbackInbox {
  deposit(required: ApiConnectionCallbackKey & { readonly fields: Readonly<Record<string, string>> }, optional?: Record<string, never>): void;
  take(required: ApiConnectionCallbackKey, optional?: Record<string, never>): Readonly<Record<string, string>> | null;
}
export type ApiConnectionStartLoopback = (required: Record<string, never>, optional?: {
  readonly callbackFields?: readonly string[]; readonly timeoutMs?: number; readonly signal?: AbortSignal;
  readonly timers?: { after(required: { readonly ms: number; readonly run: () => void }): () => void };
}) => Promise<{ readonly redirectUri: string; receive(required: { readonly expectedState: string }): Promise<{ readonly code: string; readonly fields: Readonly<Record<string, string>> }> }>;

/** Product wording and environment setting names are host inputs, including refusal punctuation. */
export interface ApiConnectionHostMessages {
  readonly callbackOriginsEnv: string;
  notConfigured(required: { label: string; runtime: ApiConnectionRuntime; what: string }): string;
  missingReturnAddress(required: { label: string }): string;
  unregisteredOrigin(required: { label: string }): string;
  noPublicOrigin(required: { label: string }): string;
}
/** @agent-note Pass the already-built state store/inbox over the same storage used by the callback route.
 * State is opaque to this domain; integrations never imports its owner's package. */
export interface ApiConnectionRuntimeHostDeps<State> extends ApiConnectionHostPorts {
  readonly workspaceId: string;
  readonly clock: Clock;
  readonly oauthHttp: OAuthHttpPorts;
  readonly pluginHttp: PluginHttp;
  readonly runtime: ApiConnectionRuntime;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly publicOrigin: () => string | undefined;
  readonly pluginState: State;
  readonly callbackInbox: ApiConnectionCallbackInbox;
  readonly callbackPath: string;
  readonly startLoopback: ApiConnectionStartLoopback;
  readonly messages: ApiConnectionHostMessages;
}
export interface ApiConnectionRuntimeHostOptions { readonly shared?: ApiConnectionSharedStorage }
export type ApiConnectionSignInLink = (required: { callbackUrl: string; workspaceId: string; handoffId: string }) => string;
export interface ApiConnectionConnectMessages {
  toolError(required: { message: string }): string;
  readonly sharedUnavailable: string;
}
