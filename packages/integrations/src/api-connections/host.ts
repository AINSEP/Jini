import { randomBytes } from "node:crypto";

import { createApiConnectionService, type ApiConnectionService } from './service.js';
import { createSignInHandoffs } from './hosted-sign-in.js';
import { deriveApiConnectionKey } from './keys.js';
import { ApiConnectionError } from './errors.js';
import { createConnectionBudgets } from './budgets.js';
import { resolveByoClient, type ByoClient } from './byo-client.js';
import type { ApiConnectionRuntimeHostDeps, ApiConnectionRuntimeHostOptions, ApiConnectionHostMessages, ApiConnectionSignInAttempt, ApiConnectionRuntime, ApiConnectionHostRecordStore, DeclaredApiConnection } from './host-ports.js';
import type { ApiConnectionClientConfig } from './declarations.js';
import type { ApiConnectionClientKind } from './deps.js';
import type { OAuthClient } from "@jini-ai/core/contracts/oauth";
import type { ApiConnectionRecord } from "./types.js";


import { createConnectionHookHttp } from "./hook-http.js";

/**
 * @file Composes Jini's api-connections service (G1) with the host's vault stores (G2 + 0020) for every
 * connection an active plugin declares. One host per workspace; callers ask it for a connection's
 * service, its record store or a fresh access token. Nothing here names a provider.
 *
 * Runtime decides the client: `hosted` uses the plugin's web client (confidential: its secret is
 * required) and the fixed public callback; `desktop` uses the installed-app client (public, PKCE,
 * optionally with a provider-issued non-confidential secret) and a per-attempt loopback redirect.
 * Tokens stay bound to the client that issued them. Every token read first spends the connection's
 * declared request budgets (`budgets.ts`), counted in this host's memory. The host also owns the
 * workspace's plugin settings store (`plugin-state.ts`, same vault) and the consume-once inbox where
 * a completed sign-in's declared callback fields wait for the plugin's surface handler.
 *
 * A connection that allows it (`byoClient`) uses the workspace admin's own OAuth client when one is
 * saved (`byo-client.ts`); its secret stays in this host's memory for the call and goes to the token
 * endpoint only. Tokens are sealed for the client id that issued them, so after the client changes
 * (BYO saved, replaced or removed) a connected record would claim "connected" with tokens nobody can
 * read: every status read and token read here notices that and durably moves the record to
 * `reconnect-required` (the honest state: a reconnect issues tokens for the current client).
 */


export type { ApiConnectionRuntime } from "./host-ports.js";

type ApiConnectionRuntimeDeps<State> = ApiConnectionRuntimeHostDeps<State>;
type ApiConnectionRuntimeOptions = ApiConnectionRuntimeHostOptions;

/** The one refusal for a ref the calling plugin does not own here, whatever the reason. */
function notAvailable(): ApiConnectionError {
  return new ApiConnectionError({ code: "connection-not-found", message: "This connection is not available to this plugin here. Connect the plugin's account, then retry." });
}

/** Why a connection cannot be used on this host, in words for the person, never a secret value. */
function setupRefused(message: string): ApiConnectionError {
  return new ApiConnectionError({ code: "descriptor-invalid", message });
}

/** A configured host setting, trimmed; undefined when the plugin names none or it is unset. @complexity O(1). */
function configured(env: ApiConnectionRuntimeDeps<unknown>["env"], name: string | undefined): string | undefined {
  return name === undefined ? undefined : env[name]?.trim() || undefined;
}

/** True when a stored token set cannot be opened by this owner (sealed for another client id, or malformed). */
function isUnreadableTokenRecord(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return error instanceof Error && error.name === "OAuthTokenStoreError" && (code === "owner-mismatch" || code === "invalid-record");
}

/** True when Jini's service already turned an unreadable token record into its generic reconnect-required refusal. */
function wrapsUnreadableTokenRecord(error: unknown): boolean {
  return error instanceof ApiConnectionError && isUnreadableTokenRecord(error.cause);
}

function clientChanged(cause: unknown): ApiConnectionError {
  return new ApiConnectionError({ code: "reconnect-required", message: "This connection's sign-in client changed, so its stored sign-in can no longer be used. Reconnect the account in the connection settings." }, { cause });
}

/** The client kind a runtime signs in as: the installed app is public, the hosted site confidential. */
function clientKindFor(runtime: ApiConnectionRuntime): ApiConnectionClientKind {
  return runtime === "desktop" ? "public" : "confidential";
}

type ResolvedClient = { readonly client: OAuthClient; readonly clientKind: ApiConnectionClientKind };

/** An admin's own client for this runtime; its secret goes to the token endpoint like the host's. @complexity O(1). */
function byoOAuthClient(byo: ByoClient, runtime: ApiConnectionRuntime): ResolvedClient {
  return { clientKind: clientKindFor(runtime), client: { clientId: byo.clientId, clientSecret: byo.clientSecret, authMethod: "client_secret_post" } };
}

/**
 * The runtime's OAuth client and how it is registered. Desktop is the installed app (`public`): PKCE,
 * and a provider-issued secret only when the provider requires one for installed apps (it is not
 * confidential there, but it still stays in host config and is never shown or logged). Hosted is the
 * web client (`confidential`) and must have its server-held secret.
 * @complexity O(1).
 */
function resolveClient(connection: DeclaredApiConnection, runtime: ApiConnectionRuntime, env: ApiConnectionRuntimeDeps<unknown>["env"], messages: ApiConnectionHostMessages): ResolvedClient {
  const config: ApiConnectionClientConfig | undefined = runtime === "desktop" ? connection.clients.desktop : connection.clients.web;
  const clientId = configured(env, config?.clientIdEnv);
  if (!config || !clientId) throw notConfigured(connection, runtime, "sign-in client", messages);
  const clientSecret = configured(env, config.clientSecretEnv);
  const clientKind = clientKindFor(runtime);
  if (clientKind === "confidential" && !clientSecret) throw notConfigured(connection, runtime, "sign-in client secret", messages);
  return { clientKind, client: clientSecret ? { clientId, clientSecret, authMethod: "client_secret_post" } : { clientId, authMethod: "none" } };
}

/** Each listed entry's origin; an entry that is not a URL is dropped (it can match nothing). @complexity O(n). */
function configuredOrigins(env: ApiConnectionRuntimeDeps<unknown>["env"], setting: string): string[] {
  const listed = configured(env, setting)?.split(",") ?? [];
  return listed.flatMap((entry) => URL.parse(entry.trim())?.origin ?? []);
}

function notConfigured(connection: DeclaredApiConnection, runtime: ApiConnectionRuntime, what: string, messages: ApiConnectionHostMessages): ApiConnectionError {
  return setupRefused(messages.notConfigured({ label: connection.descriptor.label, runtime, what }));
}

/** Status projection shared by local records and token-free owner connection metadata. */
function connectionStatus({ connectionRef, record }: { connectionRef: string; record: Pick<ApiConnectionRecord, "status" | "grantedScopes"> | null }) {
  return { connectionRef, status: record?.status ?? "disconnected", grantedScopes: record?.grantedScopes ?? [] };
}

/**
 * Builds the workspace host. Declarations are read fresh per call, so enabling or disabling a
 * plugin takes effect without a restart (Node caches each hooks module per file URL).
 * @complexity O(1) setup; each lookup is one contribution load, O(p + c).
 */
export function createApiConnectionHost<State>(
  required: ApiConnectionRuntimeDeps<State>,
  optional: ApiConnectionRuntimeOptions = {},
) {
  const { records } = required.apiConnectionStorage;
  const budgets = createConnectionBudgets({ clock: required.clock, createLimiter: required.createLimiter });
  // In-process: the public callback and the admin-surface routes run in this host's process.
  const callbackInbox = required.callbackInbox;
  const pluginState = required.pluginState;
  // In-process, by connection ref: the last desktop sign-in that failed after the browser opened, so
  // the plugin's panel can say so (the loopback page is all the user saw). At most one per declared
  // connection; a later success deletes it.
  const lastSignInAttempts = new Map<string, ApiConnectionSignInAttempt>();
  // Hosted sign-ins started here, waiting for their starter's browser to open the host link.
  const signInHandoffs = createSignInHandoffs({ clock: required.clock, randomBytesFn: ({ byteLength }) => randomBytes(byteLength) });
  // Per host (so per workspace) and per loaded declaration object: a BYO client never travels with a
  // connection object into another host, and the secret is never a field anything could serialize.
  const byoClients = new WeakMap<DeclaredApiConnection, ByoClient | ApiConnectionError>();

  /** The declared connections, each with this workspace's BYO client resolved fresh. @complexity O(p + c) plus one credential open per BYO connection. */
  async function listConnections(input: { readonly pluginId?: string } = {}): Promise<readonly DeclaredApiConnection[]> {
    const { connections } = await required.loadDeclaredConnections({ workspaceId: required.workspaceId });
    const listed = input.pluginId === undefined ? connections : connections.filter((connection) => connection.pluginId === input.pluginId);
    for (const connection of listed) {
      const byo = await resolveByoClient({ byoCredentials: required.byoCredentials, workspaceId: required.workspaceId, connection });
      if (byo) byoClients.set(connection, byo);
    }
    return listed;
  }

  /** The connection's OAuth client here: the admin's own when saved (an unusable one refuses), else the host's. @complexity O(1). */
  function clientFor(connection: DeclaredApiConnection): ResolvedClient {
    const byo = byoClients.get(connection);
    if (byo instanceof ApiConnectionError) throw byo;
    return byo ? byoOAuthClient(byo, required.runtime) : resolveClient(connection, required.runtime, required.env, required.messages);
  }

  function tokensFor(connection: DeclaredApiConnection, clientId: string) {
    const owner = { workspaceId: required.workspaceId, pluginId: connection.pluginId, connectionId: connection.descriptor.connectionId, clientId };
    return required.apiConnectionStorage.tokensFor({ owner });
  }

  /** Durably moves a record to `reconnect-required` (revision CAS); a lost race returns what won. @complexity Two vault calls at most. */
  async function markReconnectRequired(record: ApiConnectionRecord): Promise<ApiConnectionRecord | null> {
    const next: ApiConnectionRecord = { ...record, status: "reconnect-required", revision: record.revision + 1, updatedAt: new Date(required.clock.nowMs()).toISOString() };
    return (await records.compareAndSet({ key: record.key, expectedRevision: record.revision, record: next })) ? next : records.read({ key: record.key });
  }

  /**
   * True when a connected record's tokens were sealed for another client than the one this host
   * would use now. A connection no longer declared, or with no usable client, is left as it is: its
   * actions already refuse with their own reason.
   * @complexity One contribution load and one token-row open.
   */
  async function tokensForAnotherClient(record: ApiConnectionRecord): Promise<boolean> {
    if (record.status !== "connected") return false;
    const connection = (await listConnections({ pluginId: record.pluginId })).find((candidate) => candidate.descriptor.connectionId === record.connectionId);
    if (!connection) return false;
    let clientId: string;
    try { clientId = clientFor(connection).client.clientId; } catch { return false; }
    return tokensFor(connection, clientId).load({ key: record.key }).then(() => false, (error: unknown) => {
      if (isUnreadableTokenRecord(error)) return true;
      throw error;
    });
  }

  /** The record as it really stands: a connected record whose tokens belong to another client reads (and is stored) as reconnect-required. */
  async function readHonestRecord(input: { readonly key: string }): Promise<ApiConnectionRecord | null> {
    const record = await records.read(input);
    return record && (await tokensForAnotherClient(record)) ? markReconnectRequired(record) : record;
  }
  const honestRecords: ApiConnectionHostRecordStore = { ...records, read: readHonestRecord };

  /** The https origins `pluginId`'s connections declare here (union); another workspace declares none. @complexity O(p + c). */
  async function apiOriginsFor(input: { readonly workspaceId: string; readonly pluginId: string }): Promise<readonly string[]> {
    if (input.workspaceId !== required.workspaceId) return [];
    return (await listConnections({ pluginId: input.pluginId })).flatMap((connection) => connection.apiOrigins);
  }

  /**
   * The hosted callback URL. Fails closed: refused when no return address is registered at all
   * (declared or configured), when this site has no public origin, or when its origin is not one of
   * them, so an unregistered site gets this actionable refusal instead of the provider's error page.
   */
  function hostedCallbackUrl({ connection }: { readonly connection: DeclaredApiConnection }): string {
    const origin = required.publicOrigin();
    // A BYO web client is the admin's own registration: they registered this site's own callback.
    const byo = byoClients.get(connection);
    if (byo && !(byo instanceof ApiConnectionError)) return byoCallbackUrl(connection, origin);
    const allowed = [...(connection.clients.web?.redirectOrigins ?? []), ...configuredOrigins(required.env, required.messages.callbackOriginsEnv)];
    if (allowed.length === 0) {
      throw setupRefused(required.messages.missingReturnAddress({ label: connection.descriptor.label }));
    }
    if (!origin || !allowed.includes(origin)) {
      throw setupRefused(required.messages.unregisteredOrigin({ label: connection.descriptor.label }));
    }
    return `${origin}${required.callbackPath}`;
  }

  function byoCallbackUrl(connection: DeclaredApiConnection, origin: string | undefined): string {
    if (!origin) throw setupRefused(required.messages.noPublicOrigin({ label: connection.descriptor.label }));
    return `${origin}${required.callbackPath}`;
  }

  /** The connection's hooks over HTTP limited to its declared API origins and token endpoint origin. @complexity O(1). */
  function hooksFor(connection: DeclaredApiConnection) {
    return connection.module.createHooks({ http: createConnectionHookHttp({ http: required.pluginHttp, connection }) });
  }

  /** One connection's service. Desktop passes the loopback redirect URI its attempt listens on. @complexity O(1). */
  function serviceFor(input: { readonly connection: DeclaredApiConnection; readonly redirectUri?: string }): ApiConnectionService {
    const { connection } = input;
    const { client, clientKind } = clientFor(connection);
    const redirectUri = input.redirectUri ?? (required.runtime === "hosted" ? hostedCallbackUrl({ connection }) : undefined);
    return createApiConnectionService({
      descriptor: connection.descriptor, client, clientKind,
      appOptions: { ...required.appIdentity, redirectUris: redirectUri ? [redirectUri] : [] },
      hooks: hooksFor(connection),
      records, tokens: tokensFor(connection, client.clientId),
      fetchFn: required.oauthHttp.fetchFn, guard: required.oauthHttp.guard, clock: required.clock,
      randomBytesFn: ({ byteLength }) => randomBytes(byteLength),
      sleep: ({ ms }) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    });
  }

  /** The connection `connectionRef` names, only when THIS plugin declares it in THIS workspace. @complexity O(p + c). */
  async function declaredFor(input: { readonly pluginId: string; readonly connectionRef: string }): Promise<DeclaredApiConnection | undefined> {
    return (await listConnections({ pluginId: input.pluginId })).find((candidate) =>
      deriveApiConnectionKey({ workspaceId: required.workspaceId, pluginId: input.pluginId, connectionId: candidate.descriptor.connectionId }) === input.connectionRef);
  }

  /**
   * The plugin host capability `connections.getAccessToken({ connectionRef })`, scoped to one plugin.
   * The ref must be the key of a connection THIS plugin declares in THIS workspace; anything else is
   * the same refusal, so a plugin cannot probe other plugins' or workspaces' refs. Only an access
   * token ever leaves: the refresh token stays inside the vault token store.
   * @complexity O(p + c) contribution load, then one token read (and at most one refresh).
   */
  function accessTokensFor(scope: { readonly pluginId: string }) {
    return {
      async getAccessToken(input: { readonly connectionRef: string }, options: { readonly expectedAccountId?: string } = {}): Promise<string> {
        const connection = await declaredFor({ pluginId: scope.pluginId, connectionRef: input.connectionRef });
        if (!connection) throw notAvailable();
        await budgets.charge({ workspaceId: required.workspaceId, pluginId: scope.pluginId, connectionId: connection.descriptor.connectionId, connectionRef: input.connectionRef, budgets: connection.budgets });
        if (sharedOAuth && await sharedOAuth.hasBinding(connection)) return sharedOAuth.getAccessToken(connection, options);
        return serviceFor({ connection }).getAccessToken({ connectionRef: input.connectionRef, workspaceId: required.workspaceId }, options).catch(async (error: unknown) => {
          if (!isUnreadableTokenRecord(error) && !wrapsUnreadableTokenRecord(error)) throw error;
          const record = await records.read({ key: input.connectionRef });
          if (record?.status === "connected") await markReconnectRequired(record);
          throw clientChanged(error);
        });
      },
    };
  }

  /**
   * The connection port executable tools and admin-surface handlers receive (one per site; each
   * call names its workspace and plugin). A target in another workspace, or a ref its plugin does
   * not declare here, reads as no account and is refused exactly like an unknown ref.
   * @complexity As {@link accessTokensFor}; `readAccount` is one contribution load and one record read.
   */
  const toolConnections = {
    async readAccount(target: { readonly workspaceId: string; readonly pluginId: string; readonly connectionRef: string }) {
      if (target.workspaceId !== required.workspaceId || !(await declaredFor(target))) return null;
      if (sharedOAuth) {
        const connection = await declaredFor(target);
        if (connection && await sharedOAuth.hasBinding(connection)) {
          return sharedOAuth.readAccount(connection);
        }
      }
      const record = await readHonestRecord({ key: target.connectionRef });
      return record?.status === "connected" && record.account ? { accountId: record.account.accountId, displayName: record.account.displayName } : null;
    },
    async getAccessToken(target: { readonly workspaceId: string; readonly pluginId: string; readonly connectionRef: string }, options: { readonly expectedAccountId?: string } = {}): Promise<string> {
      if (target.workspaceId !== required.workspaceId) throw notAvailable();
      return accessTokensFor({ pluginId: target.pluginId }).getAccessToken({ connectionRef: target.connectionRef }, options);
    },
  };

  /** The scopes a sign-in for these scope sets would request, via the plugin's own hook. @complexity One hook call. */
  async function requestedScopes(input: { readonly connection: DeclaredApiConnection; readonly scopeSetIds: readonly string[] }): Promise<readonly string[]> {
    return hooksFor(input.connection).resolveScopes({ scopeSetIds: [...input.scopeSetIds] });
  }

  /** Token-free status straight from the record; a connection never created reads as disconnected. @complexity One read. */
  async function statusOf({ connection, local = false }: { readonly connection: DeclaredApiConnection; readonly local?: boolean }) {
    const key = deriveApiConnectionKey({ workspaceId: required.workspaceId, pluginId: connection.pluginId, connectionId: connection.descriptor.connectionId });
    if (!local && sharedOAuth && await sharedOAuth.hasBinding(connection)) {
      const shared = await sharedOAuth.getStatus(connection);
      return connectionStatus({ connectionRef: key, record: shared });
    }
    const record = await readHonestRecord({ key });
    return connectionStatus({ connectionRef: key, record });
  }

  const sharedOAuth = optional.shared && required.runtime === "desktop" ? required.createSharedConnections({
    workspaceId: required.workspaceId, listConnections, requestedScopes,
    createService: ({ connection, context, redirectUri }) => createApiConnectionService({
      descriptor: context.descriptor, client: context.client, clientKind: context.clientKind,
      appOptions: { ...required.appIdentity, redirectUris: redirectUri ? [redirectUri] : [] },
      hooks: hooksFor(connection), records: optional.shared!.records, tokens: optional.shared!.tokensFor({ context }),
      fetchFn: required.oauthHttp.fetchFn, guard: required.oauthHttp.guard, clock: required.clock,
      randomBytesFn: ({ byteLength }) => randomBytes(byteLength), sleep: ({ ms }) => new Promise(resolve => { setTimeout(resolve, ms); }),
    }),
  }) : undefined;

  async function prepareSignIn(input: { connection: DeclaredApiConnection; actorId: string; destination?: "site" | "shared" | undefined; redirectUri?: string }) {
    const { connection } = input;
    if (input.destination !== "shared") return { service: serviceFor(input), workspaceId: required.workspaceId, onCompleted: async () => {
      if (input.destination === "site") await sharedOAuth?.selectLocal(connection);
    } };
    if (!sharedOAuth) throw notAvailable();
    const credentialId = deriveApiConnectionKey({ workspaceId: "project", pluginId: connection.pluginId, connectionId: connection.descriptor.connectionId });
    const existing = await optional.shared!.readContext({ credentialId });
    if (existing) return sharedOAuth.prepare({ ...input, context: existing });
    const { client, clientKind } = clientFor(connection);
    const context = { credentialId, client, clientKind, descriptor: connection.descriptor,
      identity: { pluginId: connection.pluginId, connectionId: connection.descriptor.connectionId, tokenEndpoint: connection.descriptor.tokenEndpoint, authorizationEndpoint: connection.descriptor.authorizationEndpoint, clientId: client.clientId } };
    return sharedOAuth.prepare({ ...input, context });
  }

  const startLoopback = required.startLoopback;
  return { sharingAvailable: Boolean(sharedOAuth), sharedOAuth, prepareSignIn, workspaceId: required.workspaceId, runtime: required.runtime, clock: required.clock, records: honestRecords, startLoopback, listConnections, serviceFor, accessTokensFor,
    toolConnections, apiOriginsFor, declaredFor, requestedScopes, hostedCallbackUrl, statusOf, callbackInbox, lastSignInAttempts, signInHandoffs, pluginState };
}

export type ApiConnectionHost<State = unknown> = ReturnType<typeof createApiConnectionHost<State>>;
