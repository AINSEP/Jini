import { randomBytes } from "node:crypto";
import { nowIso as readNowIso, type UUID } from "@jini-ai/core/primitives";
import type { DeviceAuthorization, DiscoveredOAuthConfiguration, OAuthClient, OAuthClientAuthMethod, OAuthProviderDescriptor, OAuthTokenSet, OAuthAppOptions, OAuthProviderRegistry } from "@jini-ai/core/contracts/oauth";
import type { ExternalMcpOAuthGrant, ExternalMcpOAuthStatus, ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import type { DeviceAuthorizationStore, ExternalMcpOAuthDeps as HostedMcpOAuthDeps, ExternalMcpOAuthService, HostedMcpSignInPorts } from "./contracts.js";
import { createSharedExternalMcpOAuth, type SharedExternalMcpOwner } from "./shared-sign-in.js";

/**
 * @file Connects `@jini-ai/oauth`'s generic client to one external-MCP connection row.
 *
 * This is the ONLY module that knows both halves. `@jini-ai/oauth` knows nothing about MCP;
 * `external-mcp-store.ts` knows nothing about token endpoints; this file owns the join and nothing
 * else — no HTTP routing (that is `server/routes/`), no federation (that is `mcp-federation/`).
 *
 * Callback routes reuse the connectors' public mount, XSS-safe page, origin-checked popup bridge,
 * focus-regain fallback and per-IP limiters. Authorization grants, PKCE, exchange, refresh and
 * expiry are owned by `@jini-ai/oauth` behind provider-agnostic descriptors.
 *
 * ## Connect-time failures are loud, fast and never retried
 *
 * A connect attempt is a FOREGROUND action with a human watching a spinner — the exact opposite of
 * `mcp-federation/bootstrap.ts`'s boot-time federation, which fails open precisely because nobody
 * asked for that server at that moment. So every call here is bounded by a timeout and reports a
 * specific failure; nothing loops. An authorization code is single-use and the first response may
 * have been lost AFTER the provider redeemed it, so an automatic retry can burn a code that
 * actually worked. The operator retries with one click; the machine does not retry at all.
 */

/** A human is watching. Long enough for a slow but working provider, short enough that a dead one is
 *  reported while the operator still has the tab open. */
const CONNECT_TIMEOUT_MS = 15_000;
/**
 * How long a process may hold the cross-process refresh lease.
 *
 * Comfortably longer than {@link CONNECT_TIMEOUT_MS} so a legitimate in-flight refresh is never
 * treated as abandoned, and short enough that a process killed mid-refresh frees the connection
 * within a minute rather than until the next restart.
 */
const REFRESH_LEASE_MS = 45_000;

/**
 * Attempts `setOAuthStatus`'s clear-token re-seal is given before it gives up.
 *
 * Small and fixed, no backoff: a keyring write that fails because its active key briefly could not
 * be resolved usually succeeds on the very next try, so this exists to smooth over that blip rather
 * than to ride out a sustained outage — a re-seal still failing after this many immediate retries is
 * treated as a real, reportable failure, not something to keep retrying indefinitely.
 */
const CLEAR_TOKEN_RESEAL_ATTEMPTS = 3;

/** Bounded by the per-workspace server cap, so no explicit eviction policy is needed beyond
 *  overwriting a connection's own previous attempt. */
export function createDeviceAuthorizationStore(): DeviceAuthorizationStore {
  const byServerId = new Map<string, DeviceAuthorization>();
  return {
    async put(serverId, authorization) {
      byServerId.set(serverId, authorization);
    },
    async get(serverId) {
      return byServerId.get(serverId);
    },
    async delete(serverId) {
      byServerId.delete(serverId);
    },
  };
}

/** {@link ExternalMcpOAuthDeps} as the service holds them: `providers` defaulted once at construction,
 *  so nothing downstream builds a second registry. */
/** The sign-in's whole input: the canonical deps plus the host's {@link HostedMcpSignInPorts}. */
type SignInDeps = HostedMcpOAuthDeps<SharedExternalMcpOwner> & { readonly ports: HostedMcpSignInPorts };
type ExternalMcpOAuthServiceDeps = SignInDeps & { readonly providers: OAuthProviderRegistry };

/** Stable registration identity; callback URLs come only from the host's trusted origin policy.
 * Device-only clients deliberately register no redirect URI (RFC 7591).
 */
function oauthClientOptions(ports: HostedMcpSignInPorts, record: ExternalMcpServerRecord, redirectUri: string | undefined): OAuthAppOptions {
  return { clientDisplayName: ports.registrationIdentity.clientName(record), softwareId: ports.registrationIdentity.softwareId,
    redirectUris: redirectUri === undefined ? [] : [redirectUri] };
}

/** Calls {@link ExternalMcpOAuthDeps.onConnected}, keeping its failure out of the sign-in's result. */
async function notifyConnected(deps: SignInDeps, serverId: string): Promise<void> {
  if (!deps.onConnected) return;
  try {
    await deps.onConnected(serverId);
  } catch (error) {
    deps.ports.log.postConnectFailed({ serverId, error });
  }
}

/** Loads an OAuth-authenticated row, or explains why it cannot be used.
 *  @throws {ExternalMcpValidationError} */
async function requireOAuthRecord(deps: SignInDeps, serverId: string): Promise<ExternalMcpServerRecord> {
  const record = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId });
  if (!record) {
    throw deps.ports.errors.validation(`no external MCP server is configured as '${serverId}'`, "id");
  }
  if (deps.ports.projections.authMode(record) !== "oauth") {
    throw deps.ports.errors.validation(`external MCP server '${serverId}' is not configured to use OAuth`, "authMode");
  }
  return record;
}

/** The refusal for a row that names no provider and no token endpoint. One builder for both places
 *  that reach it — provider resolution and self-configuration on a row with no URL to discover from —
 *  because from the operator's side it is the same problem with the same fix. */
function noOAuthProviderError(required: { readonly ports: HostedMcpSignInPorts; readonly serverId: string }): Error {
  return required.ports.errors.oauth({ code: "OAUTH_INVALID_REQUEST", message: `external MCP server '${required.serverId}' names no OAuth provider and defines no token endpoint`, operatorAction: required.ports.copy.actions.noProvider, });
}

/** The endpoint trio an operator may type onto a connection, as stored. Absent members mean "this
 *  connection names a registered provider for that part instead", or — on a remote connection — that
 *  discovery has not run yet. */
interface StoredOAuthEndpoints {
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  deviceAuthorizationEndpoint?: string;
  /** RFC 8707 audience advertised by the protected server; legacy rows omit it. */
  resource?: string | undefined;
  /**
   * How the token endpoint expects this client to authenticate.
   *
   * Only ever written by dynamic client registration, and only when the authorization server
   * volunteered a `client_secret` and asked for a secret-bearing method despite being asked for a
   * public client. It is stored because {@link buildConnectionOwnedProvider} rebuilds the descriptor
   * from this blob on every later call — a refresh six weeks from now has nothing else to read it
   * from, and a client that keeps authenticating as `none` at a server that issued it a secret gets
   * `invalid_client` on every token request.
   */
  clientAuth?: string;
  /**
   * The client id dynamic registration minted for this row. It marks the row's client as Tovu's own,
   * which Tovu may replace; a client id an operator typed never matches it and is never replaced.
   * Compared against the row's live `oauthClientId` rather than trusted as a flag, so an operator
   * who later types a client id over a minted one keeps theirs.
   */
  dynamicClientId?: string;
  /** The callback URL {@link dynamicClientId} was registered with. A server that pins redirect URIs
   *  rejects any other, and the desktop app's port changes on every restart. */
  registeredRedirectUri?: string;
}

/** Reads the stored endpoints column, tolerating a null or corrupt value as "none typed". */
function readStoredEndpoints(record: ExternalMcpServerRecord): StoredOAuthEndpoints {
  try {
    const parsed: unknown = JSON.parse(record.oauthEndpointsJson ?? "{}");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StoredOAuthEndpoints) : {};
  } catch {
    return {};
  }
}

/** Builds a descriptor from the endpoints an operator typed on this connection.
 *  @throws {OAuthError} When they do not form a usable provider. */
function buildConnectionOwnedProvider(deps: SignInDeps, record: ExternalMcpServerRecord, endpoints: StoredOAuthEndpoints & { tokenEndpoint: string }): OAuthProviderDescriptor {
  const clientAuth = readStoredClientAuth(endpoints);
  return deps.ports.flow.buildOperatorOAuthProvider({
    guard: deps.httpPorts.guard,
    providerId: record.oauthProviderId ?? `connection-${record.serverId}`,
    label: record.label ?? record.serverId,
    tokenEndpoint: endpoints.tokenEndpoint,
  }, {
    ...(endpoints.authorizationEndpoint === undefined ? {} : { authorizationEndpoint: endpoints.authorizationEndpoint }),
    ...(endpoints.deviceAuthorizationEndpoint === undefined ? {} : { deviceAuthorizationEndpoint: endpoints.deviceAuthorizationEndpoint }),
    scopes: readStoredScopes(record),
    ...(clientAuth === null ? {} : { clientAuth }),
  });
}

/** The three RFC 6749 §2.3 methods `token-endpoint.ts` can actually perform. A stored value outside
 *  this set is treated as absent rather than trusted — the blob is plaintext on the row. */
const STORED_CLIENT_AUTH_METHODS: readonly string[] = ["none", "client_secret_post", "client_secret_basic"];

/** @complexity O(1). */
function readStoredClientAuth(endpoints: StoredOAuthEndpoints): OAuthClientAuthMethod | null {
  const stored = endpoints.clientAuth;
  return stored !== undefined && STORED_CLIENT_AUTH_METHODS.includes(stored) ? (stored as OAuthClientAuthMethod) : null;
}

/** The scopes column, tolerating a null or corrupt value as "none requested". @complexity O(n). */
function readStoredScopes(record: ExternalMcpServerRecord): string[] {
  try {
    const parsed: unknown = JSON.parse(record.oauthScopesJson ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Resolves the provider descriptor for a row: a registered id, or the operator's own endpoints.
 *
 * Both paths end at the same validated {@link OAuthProviderDescriptor}, which is what keeps every
 * flow in `@jini-ai/oauth` provider-agnostic. `buildOperatorOAuthProvider` derives the supported grants
 * from which endpoints are present, so a row cannot claim a grant it has no endpoint for.
 *
 * @throws {OAuthError} `OAUTH_INVALID_REQUEST` when the row names neither, or
 * `OAUTH_UNSAFE_ENDPOINT` when a typed endpoint fails the outbound-safety check.
 * @complexity O(1).
 */
function resolveProviderDescriptor(deps: ExternalMcpOAuthServiceDeps, record: ExternalMcpServerRecord): OAuthProviderDescriptor {
  const endpoints = readStoredEndpoints(record);
  if (endpoints.tokenEndpoint !== undefined) {
    return buildConnectionOwnedProvider(deps, record, { ...endpoints, tokenEndpoint: endpoints.tokenEndpoint });
  }
  if (record.oauthProviderId === null) {
    throw noOAuthProviderError({ ports: deps.ports, serverId: record.serverId });
  }
  if (deps.lookupProvider) return deps.lookupProvider(record.oauthProviderId);
  return deps.providers.get({ providerId: record.oauthProviderId });
}

/** Builds the client identity for one row, unsealing the client secret only when there is one.
 *  @throws {OAuthError} When the row carries no client id — a state `saveExternalMcpServer` refuses
 *  to create, so reaching it means the row was written by something else. */
async function resolveClient(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
  provider: OAuthProviderDescriptor,
): Promise<OAuthClient> {
  if (record.oauthClientId === null) {
    throw deps.ports.errors.oauth({ code: "OAUTH_INVALID_REQUEST", message: `external MCP server '${record.serverId}' has no OAuth client id`, operatorAction: deps.ports.copy.actions.noClientId, });
  }
  const payload = await deps.ports.store.openPayload(deps.sealer, record);
  return {
    clientId: record.oauthClientId,
    ...(payload.clientSecret === undefined ? {} : { clientSecret: payload.clientSecret }),
    authMethod: provider.clientAuth,
  };
}

// ---------------------------------------------------------------------------
// Self-configuration: discovery + dynamic client registration
//
// A connection may reach `beginConnect` missing the two things every grant needs: where the
// authorization server is, and who Tovu is to it. Operators can configure both for a provider
// with a developer console. A growing share of hosted MCP servers have
// no console at all — they publish RFC 9728 / RFC 8414 metadata and an RFC 7591 registration endpoint
// and expect clients to self-register — and for those there is no human path to a client id, so the
// connection is unreachable without this.
//
// It runs ONLY in `beginConnect`, and what it learns is PERSISTED. The callback, poll and refresh
// paths read the persisted row, so there is one place where a connection can
// change shape rather than four. Persisting is also what keeps registration a once-per-connection
// event: an authorization server does not garbage-collect clients, so a connect that registered every
// time would leave one dead client behind per retry.
// ---------------------------------------------------------------------------

/** Whether a row still has to be told where its authorization server is. @complexity O(1). */
function needsEndpointDiscovery(record: ExternalMcpServerRecord, endpoints: StoredOAuthEndpoints): boolean {
  return endpoints.tokenEndpoint === undefined && record.oauthProviderId === null;
}

/**
 * Narrows a discovered authorization server into the blob shape the row stores.
 *
 * The `registration_endpoint` is deliberately NOT stored: nothing reads it once the client is minted,
 * and a credential-adjacent URL kept for no reader is a liability rather than a convenience.
 *
 * @complexity O(1).
 */
function toStoredEndpoints(discovered: DiscoveredOAuthConfiguration & { readonly resource?: string | null | undefined }): StoredOAuthEndpoints {
  const server = discovered.server;
  return {
    issuer: server.issuer,
    tokenEndpoint: server.tokenEndpoint,
    ...(discovered.resource == null ? {} : { resource: discovered.resource }),
    ...(server.authorizationEndpoint === null ? {} : { authorizationEndpoint: server.authorizationEndpoint }),
    ...(server.deviceAuthorizationEndpoint === null ? {} : { deviceAuthorizationEndpoint: server.deviceAuthorizationEndpoint }),
  };
}

/**
 * Runs RFC 9728 / RFC 8414 discovery against the connection's own MCP endpoint.
 *
 * @throws {OAuthError} `OAUTH_INVALID_REQUEST` when the row has no URL to discover from — a stdio
 *   connection, which the store still requires to name its provider explicitly. Same message the
 *   non-discovering path has always used, because from the operator's side it is the same problem.
 * @complexity O(1) in row size; a bounded, small number of outbound requests.
 */
async function discoverConnectionAuthorizationServer(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
): Promise<DiscoveredOAuthConfiguration> {
  const resourceUrl = record.url;
  if (resourceUrl === null) {
    throw noOAuthProviderError({ ports: deps.ports, serverId: record.serverId });
  }
  return deps.ports.withCopy({ call: () => deps.ports.flow.discoverAuthorizationServer(
    { ...deps.httpPorts, resourceUrl },
    { timeoutMs: 10_000, metadataPolicy: deps.ports.discoveryPolicy({ guard: deps.httpPorts.guard }) },
  ) });
}

/** RFC 8628's grant-type identifier — how both RFC 8414's `grant_types_supported` and RFC 7591's own
 *  `grant_types` name the device flow. Tovu's internal grant alias is the shorter `device_code`
 *  (`EXTERNAL_MCP_OAUTH_GRANTS`), so this is the one place that URN gets spelled out — everywhere
 *  else compares against or registers the short name and translates through this constant instead of
 *  repeating the URN. */
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/** The grant types to register for. Takes the RESOLVED grant rather than reading `record.oauthGrant`
 *  itself, because a row self-configuring its grant for the first time has not persisted it yet at
 *  the point registration runs — reading the record here would silently register for
 *  `authorization_code` on a connection that is actually about to become a device grant.
 *  `refresh_token` is always included: it is what decides whether this connection survives its first
 *  access-token expiry, and a server that does not support it ignores the entry. @complexity O(1). */
function registrationGrantTypes(grant: ExternalMcpOAuthGrant): readonly string[] {
  return grant === "device_code" ? [DEVICE_CODE_GRANT_TYPE, "refresh_token"] : ["authorization_code", "refresh_token"];
}

/**
 * Resolves the sign-in method for a connection whose row names none, from what its OWN
 * authorization server advertises — the same "ask the server, don't ask the operator" move as
 * {@link discoverConnectionAuthorizationServer} makes for endpoints and {@link mintClientForConnection}
 * makes for client identity.
 *
 * `authorization_code` wins whenever the server offers it: it is the redirect-based grant every
 * browser-capable client uses, and it is what an operator would pick by default anyway.
 * `device_code` exists specifically for the flow a browser cannot run (RFC 8628 — the human types a
 * code at the provider instead of being redirected), so it is a fallback rather than a co-equal
 * choice, taken only when the server names no other grant Tovu implements.
 *
 * @throws {OAuthError} `OAUTH_INVALID_REQUEST` when the metadata names neither grant Tovu
 *   implements — naming exactly what the server DID advertise, since an operator who only sees
 *   "connect failed" has no way to guess that from the failure alone.
 * @complexity O(n) in the number of advertised grant types.
 */
function resolveGrantFromDiscovery(grantTypesSupported: readonly string[], serverId: string, ports: HostedMcpSignInPorts): ExternalMcpOAuthGrant {
  if (grantTypesSupported.includes("authorization_code")) return "authorization_code";
  if (grantTypesSupported.includes(DEVICE_CODE_GRANT_TYPE)) return "device_code";
  throw ports.errors.oauth({ code: "OAUTH_INVALID_REQUEST", message: ports.copy.noSupportedGrant({ serverId, offered: grantTypesSupported }), operatorAction: ports.copy.actions.chooseGrant });
}

/**
 * Mints a client for a connection that has none.
 *
 * @param input.redirectUri - Registered as this client's only callback. A server that pins redirect
 *   URIs will refuse an authorization whose `redirect_uri` was not registered, so the value used at
 *   authorization time is the value registered here — not a re-derived one. `undefined` registers no
 *   callback at all, which is correct (and the only honest option) for a device-grant client.
 * @param input.grant - The RESOLVED grant — see {@link registrationGrantTypes} for why this must not
 *   be read back off `record`.
 * @throws {OAuthError} `OAUTH_INVALID_REQUEST` when the authorization server offers no registration
 *   endpoint, which is the point at which an operator genuinely does have to supply a client id.
 * @complexity O(1) — one bounded outbound request.
 */
async function mintClientForConnection(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
  discovered: DiscoveredOAuthConfiguration,
  input: { readonly redirectUri: string | undefined; readonly scopes: readonly string[]; readonly grant: ExternalMcpOAuthGrant },
) {
  const registrationEndpoint = discovered.server.registrationEndpoint;
  if (registrationEndpoint === null) {
    throw deps.ports.errors.oauth({ code: "OAUTH_INVALID_REQUEST", message: `external MCP server '${record.serverId}' has no OAuth client id and its authorization server offers no dynamic client registration`, operatorAction: deps.ports.copy.actions.noRegistration });
  }
  return deps.ports.withCopy({ call: () => deps.ports.flow.registerOAuthClientDynamically(
    {
      ...deps.httpPorts,
      options: oauthClientOptions(deps.ports, record, input.redirectUri),
      registrationEndpoint,
      scopes: input.scopes,
    },
    {
      messages: deps.ports.oauthMessages,
      // Empty for a device-only client: RFC 7591 requires `redirect_uris` only for a client that
      // registers a redirect-based grant, and `registrationGrantTypes` below registers none for
      // `device_code`. Registering a placeholder instead would mint a client pinned to a callback
      // nothing serves.
      // oauthClientOptions carries exactly this grant's callback, or [] for device-only clients.
      grantTypes: registrationGrantTypes(input.grant),
      // Read only if the server issues a secret without saying how to present it.
      authMethodsSupported: discovered.server.tokenEndpointAuthMethodsSupported,
      timeoutMs: CONNECT_TIMEOUT_MS,
    },
  ) });
}

/** Writes one connect's self-configuration onto the row, preserving anything already sealed beside it.
 *
 *  Read-modify-write for the same reason {@link persistTokens} is: sealing `{ clientSecret }` alone
 *  would delete a token the connection is still holding.
 *  @complexity O(1) — one unseal, one seal, one upsert. */
async function persistSelfConfiguration(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
  identity: {
    readonly endpoints: StoredOAuthEndpoints;
    readonly scopes: readonly string[];
    readonly grant: ExternalMcpOAuthGrant;
    readonly clientId: string;
    /** `undefined` keeps the sealed secret; `null` removes it (a freshly minted public client must
     *  not inherit the secret of the client it replaced). */
    readonly clientSecret: string | null | undefined;
  },
  options: { readonly configurationOnly?: boolean } = {},
): Promise<ExternalMcpServerRecord> {
  const existing = await deps.ports.store.openPayload(deps.sealer, record);
  const clientSecret = identity.clientSecret === undefined ? existing.clientSecret : (identity.clientSecret ?? undefined);
  const { sealedOAuth, oauthAadVersion } = await deps.ports.store.sealPayload(deps, record, {
    ...(clientSecret === undefined ? {} : { clientSecret }),
    ...(existing.tokens === undefined ? {} : { tokens: existing.tokens }),
  });

  const next: ExternalMcpServerRecord = {
    ...record,
    oauthGrant: identity.grant,
    oauthClientId: identity.clientId,
    oauthEndpointsJson: JSON.stringify(identity.endpoints),
    oauthScopesJson: JSON.stringify(identity.scopes),
    sealedOAuth,
    // Carried from the seal, never from `...record` — the spread holds the row's OLD version.
    oauthAadVersion,
    updatedAt: readNowIso({ clock: deps.clock }),
  };
  if (!options.configurationOnly) await deps.repo.upsert(next);
  return next;
}

/**
 * Fills in whatever a connection is missing, persists it, and returns the row as it now stands.
 *
 * A no-op — and, importantly, ZERO outbound requests — for a connection that already names its
 * endpoints, its grant AND its client id. That is what keeps every existing connection behaving
 * exactly as it did: self-configuration is reached only by a row that could not have connected at
 * all before, or that named everything except which grant to use.
 *
 * Nothing is written until every step has succeeded, so a failed registration leaves the row exactly
 * as it was and the operator's retry is a clean retry rather than one over half-written state.
 *
 * @param redirectUri - The absolute callback URL this connect will use, registered verbatim.
 * @returns The row, self-configured if it needed to be.
 * @throws {OAuthError} From discovery, grant resolution, or registration; every one is terminal and
 *   nothing is retried.
 * @complexity O(1) in row size; a bounded, small number of outbound requests, and none at all on the
 *   already-configured path.
 */
async function selfConfigureConnection(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
  redirectUri: string | undefined,
  options: { readonly configurationOnly?: boolean } = {},
): Promise<ExternalMcpServerRecord> {
  const stored = readStoredEndpoints(record);
  const mustDiscover = needsEndpointDiscovery(record, stored);
  const mustResolveGrant = record.oauthGrant === null;
  const keepClient = record.oauthClientId !== null && !isStaleSelfRegisteredClient(record, stored, redirectUri);
  if (!mustDiscover && !mustResolveGrant && keepClient) return record;

  const discovered = await discoverConnectionAuthorizationServer(deps, record);
  const discoveredEndpoints = toStoredEndpoints(discovered);
  // Endpoints the operator typed win; discovery only fills the ones left blank (a typed token
  // endpoint alone has no authorization endpoint to redirect to).
  const endpoints: StoredOAuthEndpoints = mustDiscover ? discoveredEndpoints : { ...discoveredEndpoints, ...stored, resource: discoveredEndpoints.resource ?? stored.resource };
  const grant = selfConfiguredGrant({ record, discovered, ports: deps.ports });
  const scopes = selfConfiguredScopes({ record, discovered });

  // Narrowed on the field rather than on `mustRegister`, so there is no fallback that could write an
  // empty client id if the two ever disagreed.
  if (keepClient && record.oauthClientId !== null) {
    return persistSelfConfiguration(deps, record, { endpoints, scopes, grant, clientId: record.oauthClientId, clientSecret: undefined }, options);
  }

  const minted = await mintClientForConnection(deps, record, discovered, { redirectUri, scopes, grant });
  return persistSelfConfiguration(deps, record, {
    endpoints: withMintedClient({ endpoints, minted, redirectUri }),
    scopes,
    grant,
    clientId: minted.clientId,
    clientSecret: minted.clientSecret,
  }, options);
}

/**
 * The grant a self-configuring connect uses. Resolved from the SAME discovery call that found the
 * endpoints, on the same terms as those and the client id: an operator-named grant always wins, and
 * only a row that left it blank asks the server what it actually supports rather than have
 * `beginConnect` guess. The cast is safe: every non-null `oauthGrant` on a row was either validated by
 * `assertOAuthGrant` at save time or written by a PRIOR call to this same resolver, so it is always one
 * of `EXTERNAL_MCP_OAUTH_GRANTS` even though the column's declared type is a bare `string | null`.
 * @throws {OAuthError} From {@link resolveGrantFromDiscovery}.
 * @complexity O(n) in the number of advertised grant types.
 */
function selfConfiguredGrant(required: { readonly record: ExternalMcpServerRecord; readonly discovered: DiscoveredOAuthConfiguration; readonly ports: HostedMcpSignInPorts }): ExternalMcpOAuthGrant {
  const { record, discovered } = required;
  return record.oauthGrant === null ? resolveGrantFromDiscovery(discovered.server.grantTypesSupported, record.serverId, required.ports) : (record.oauthGrant as ExternalMcpOAuthGrant);
}

/**
 * The scopes a self-configuring connect requests. Scopes the operator named win; an empty list adopts
 * what the resource itself asks for, because a resource that advertises `offline_access` is naming
 * the scope that decides whether this connection can ever refresh.
 * @complexity O(n) in the number of scopes.
 */
function selfConfiguredScopes(required: { readonly record: ExternalMcpServerRecord; readonly discovered: DiscoveredOAuthConfiguration }): string[] {
  const operatorScopes = readStoredScopes(required.record);
  return operatorScopes.length > 0 ? operatorScopes : [...required.discovered.resourceScopes];
}

/**
 * The endpoints blob for a freshly minted client: any previous self-registered client's marks
 * dropped, then this client's own — its id, the callback it was registered with (none for a
 * device-grant connect), and `clientAuth` only when the server issued a secret.
 * @complexity O(1).
 */
function withMintedClient(required: {
  readonly endpoints: StoredOAuthEndpoints;
  readonly minted: Awaited<ReturnType<typeof mintClientForConnection>>;
  readonly redirectUri: string | undefined;
}): StoredOAuthEndpoints {
  const { endpoints, minted, redirectUri } = required;
  return {
    ...withoutSelfRegisteredClient(endpoints),
    ...(minted.clientSecret === null ? {} : { clientAuth: minted.tokenEndpointAuthMethod }),
    dynamicClientId: minted.clientId,
    ...(redirectUri === undefined ? {} : { registeredRedirectUri: redirectUri }),
  };
}

/**
 * Whether the row's client is one Tovu minted by dynamic registration, and so Tovu's to replace.
 *
 * A row written before {@link StoredOAuthEndpoints.dynamicClientId} existed carries no such mark.
 * For those, a stored `clientAuth` stands in for it: that member is only ever written by dynamic
 * registration. A pre-mark self-registered PUBLIC client (no secret, so no `clientAuth`) is not
 * recognized, and keeps the old reuse-forever behavior until an operator clears it.
 * @complexity O(1).
 */
function isSelfRegisteredClient(record: ExternalMcpServerRecord, endpoints: StoredOAuthEndpoints): boolean {
  if (record.oauthClientId === null) return false;
  if (endpoints.dynamicClientId !== undefined) return endpoints.dynamicClientId === record.oauthClientId;
  return endpoints.clientAuth !== undefined;
}

/**
 * Whether a self-registered client must be replaced before this connect: it was registered for a
 * different callback URL than this redirect-based connect will send (or, on a pre-mark row, for an
 * unknown one). A device-grant connect sends no callback, so it never makes a client stale.
 * @complexity O(1).
 */
function isStaleSelfRegisteredClient(record: ExternalMcpServerRecord, endpoints: StoredOAuthEndpoints, redirectUri: string | undefined): boolean {
  if (redirectUri === undefined || record.oauthGrant === "device_code") return false;
  return isSelfRegisteredClient(record, endpoints) && endpoints.registeredRedirectUri !== redirectUri;
}

/** The endpoints blob minus everything that describes a self-registered client. @complexity O(1). */
function withoutSelfRegisteredClient(endpoints: StoredOAuthEndpoints): StoredOAuthEndpoints {
  const next = { ...endpoints };
  delete next.clientAuth;
  delete next.dynamicClientId;
  delete next.registeredRedirectUri;
  return next;
}

/** Provider `error` codes that mean the client itself is refused (RFC 6749 §4.1.2.1 and §5.2), as
 *  opposed to the grant or the request. */
const CLIENT_REJECTED_PROVIDER_CODES: readonly string[] = ["invalid_client", "unauthorized_client"];

/** The binding key an authorization `state` is issued against. Workspace-scoped so a state minted in
 *  one workspace cannot be redeemed in another, and server-scoped so it cannot be redeemed against a
 *  different connection in the same workspace. */
function ownerKeyOf(workspaceId: UUID, serverId: string): string {
  return `${workspaceId}:${serverId}`;
}

/** EXTRACT-S5 H3 (moved under `exactOptionalPropertyTypes`): an absent audience is omitted instead of passed as
 *  `undefined`; the OAuth operations treat both the same (`input.resource === undefined`). No I/O. */
function resourceOption(resource: string | undefined): { resource?: string } {
  return resource === undefined ? {} : { resource };
}

/** Thin site-key codec; Jini owns the expiring redirect payload and all binding checks.
 * Stateless (no pending-store row) because the agent daemon can begin a connect that the web server
 * completes in a different process; a process-local Map cannot join those two legs, and a sealed
 * state needs no shared table. The exact redirect URI is bound into the state and replayed on
 * exchange (RFC 6749 §4.1.3), never rebuilt from a callback Host header. Every open/expiry/binding
 * failure is the same `OAUTH_INVALID_STATE`, so a guessed or tampered state is not an oracle.
 * @complexity O(state bytes), bounded by Jini; one site-key seal/open, no pending-store I/O.
 */
function sealedRedirectState({ deps, serverId, browserBinding }: { deps: SignInDeps; serverId: string; browserBinding?: string | undefined }, _optional: Record<string, never> = {}) {
  // The HTTP callback always supplies browser proof. Unbound pre-upgrade links cannot decrypt
  // there; persisted grants use their existing vault AAD and remain usable across reconnects.
  const parts = browserBinding === undefined ? [deps.workspaceId, serverId] : [deps.workspaceId, serverId, browserBinding];
  const aad = deps.ports.aad.format({ kind: "oauth-redirect-state", version: "v1", parts: [JSON.stringify(parts)] });
  return deps.ports.flow.createSealedAuthorizationState({ clock: deps.clock, workspaceId: deps.workspaceId, serverId, codec: {
    async seal({ plaintext }, _options = {}) {
      const sealed = await deps.sealer.seal({ plaintext, key: await deps.keyring.activeKey({}), aad });
      return Buffer.from(JSON.stringify(sealed), "utf8").toString("base64url");
    },
    async open({ state }, _options = {}) {
      return deps.sealer.open({ sealed: JSON.parse(Buffer.from(state, "base64url").toString("utf8")) }, { aad });
    },
  } });
}

/** Writes a token set into the row: sealed blob (preserving the client secret) plus the PLAINTEXT
 *  status and expiry beside it. One place, so the plaintext metadata cannot drift from the blob.
 *  @complexity O(1) — one unseal, one seal, one upsert. */
async function persistTokens(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
  tokens: OAuthTokenSet,
): Promise<void> {
  const existing = await deps.ports.store.openPayload(deps.sealer, record);
  const { sealedOAuth, oauthAadVersion } = await deps.ports.store.sealPayload(deps, record, {
    // Read-modify-write: sealing `{ tokens }` alone would silently delete the operator's client
    // secret, and the next refresh would fail with a message about the provider rather than about us.
    ...(existing.clientSecret === undefined ? {} : { clientSecret: existing.clientSecret }),
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
      scopes: [...tokens.scopes],
      expiresAt: tokens.expiresAt,
    },
  });

  await deps.repo.upsert({
    ...record,
    oauthStatus: "connected" satisfies ExternalMcpOAuthStatus,
    oauthExpiresAt: tokens.expiresAt,
    oauthRefreshLeaseUntil: null,
    sealedOAuth,
    // Carried from the seal, never from `...record` — the spread holds the row's OLD version.
    oauthAadVersion,
    updatedAt: readNowIso({ clock: deps.clock }),
  });
}

/** The row-patch fields {@link setOAuthStatus} merges on top of `status`/`oauthRefreshLeaseUntil`
 *  when clearing a token. Empty when `clearToken` was not requested. */
type ClearedTokenPatch = Partial<Pick<ExternalMcpServerRecord, "sealedOAuth" | "oauthExpiresAt" | "oauthAadVersion">>;

/** {@link setOAuthStatus}'s options. `forgetSelfRegisteredClient` also drops a client Tovu minted by
 *  dynamic registration — its id and its sealed secret — so the next connect registers afresh. It
 *  leaves an operator-typed client alone (see {@link isSelfRegisteredClient}). */
interface SetOAuthStatusOptions {
  readonly clearToken?: boolean;
  readonly forgetSelfRegisteredClient?: boolean;
}

/**
 * Resolves {@link setOAuthStatus}'s token-clear patch. Split out purely to keep that function's
 * complexity under the shop ceiling — behavior is unchanged.
 *
 * Read-modify-write, the same rule `persistTokens` follows: `sealedOAuth` holds
 * `{ clientSecret?, tokens? }` TOGETHER, so nulling it wholesale on a token clear would delete an
 * operator's client secret along with the dead token. For a dynamically-registered (RFC 7591)
 * client the operator never saw that secret, so losing it here means the row can never be
 * re-authorized — only deleted and recreated.
 *
 * The open and the re-seal below are kept in SEPARATE try/catches on purpose, even though both can
 * throw the same `ExternalMcpSecretStoreUnconfiguredError`
 * (`openExternalMcpOAuthPayload`/`sealExternalMcpOAuthPayload`'s own `@throws`): they mean different
 * things about whether the secret is actually lost. If OPEN fails, the blob could not be decrypted
 * at all — a rotated site key or a corrupt row — so whatever it held is already unrecoverable, and
 * falling back to the pre-existing wholesale-null behavior loses nothing that was not lost already
 * (this is what keeps `markNeedsReauth`, `disconnect()`, and the device-poll terminal path from
 * wedging on a blob that is already dead). If OPEN succeeds but the RE-SEAL fails, the secret was
 * just read successfully — it is NOT lost, only the write-back (a transient keyring/active-key
 * problem, say) failed, so it is retried a few times — bounded, no backoff — before giving up.
 * Wholesale-nulling would destroy a secret this call proves is still recoverable, so it is never the
 * outcome here; but silently leaving `sealedOAuth` untouched and reporting success would leave the
 * row's `oauthStatus` claiming a state (e.g. `disconnected`) the stored blob does not actually match,
 * with nothing to say so. So once the retry budget is exhausted, this rethrows instead: each of this
 * function's callers already has a place that reacts to `ExternalMcpSecretStoreUnconfiguredError`
 * without inventing a new one — `disconnect()`'s admin route already maps it to a 503
 * `SECRET_STORE_UNCONFIGURED`, `reportAuthFailure` already carries an unexpected `setOAuthStatus`
 * failure as `cause` on its terminal error, and `markNeedsReauth`'s two call sites in
 * `token-refresh.ts`'s `performRefresh` treat this write as best-effort the same way — its failure
 * is carried as `cause` on the `OAUTH_INVALID_GRANT` error they throw next, never left to propagate
 * in that error's place. (An earlier version of this comment claimed that path "already folds" a
 * write failure into the boot report; it did not — the failure escaped unguarded and displaced the
 * reauth signal every downstream caller branches on. Both call sites now guard it explicitly.) Any
 * OTHER error (a genuine bug, not an unopenable or unsealable blob) still propagates from either
 * step — this is a documented, targeted degrade, not a blanket swallow.
 *
 * @throws {ExternalMcpSecretStoreUnconfiguredError} If the re-seal never recovers within
 *   {@link CLEAR_TOKEN_RESEAL_ATTEMPTS} attempts.
 */
async function resolveClearedTokenPatch(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
  options: { readonly clearToken?: boolean; readonly dropClientSecret: boolean },
): Promise<ClearedTokenPatch> {
  if (options.clearToken !== true) return {};

  const opened = await openExistingOAuthPayloadForClear(deps, record);
  if ("wholesale" in opened) return { sealedOAuth: null, oauthExpiresAt: null };

  const kept = options.dropClientSecret ? undefined : opened.existing.clientSecret;
  const clientSecret = kept === undefined ? {} : { clientSecret: kept };
  return resealClearedOAuthToken(deps, record, clientSecret);
}

/** {@link resolveClearedTokenPatch}'s OPEN step — reads the existing payload, or signals the
 *  wholesale-null fallback when the blob cannot be opened at all (see that function's doc for why
 *  this branch is safe). Split out purely to keep that function's cognitive complexity under the
 *  shop ceiling. */
async function openExistingOAuthPayloadForClear(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
): Promise<{ readonly existing: Awaited<ReturnType<HostedMcpSignInPorts["store"]["openPayload"]>> } | { readonly wholesale: true }> {
  try {
    return { existing: await deps.ports.store.openPayload(deps.sealer, record) };
  } catch (error) {
    if (!deps.ports.errors.isUnconfigured(error)) throw error;
    return { wholesale: true };
  }
}

/** {@link resolveClearedTokenPatch}'s RE-SEAL step — retries a bounded number of times before giving
 *  up (see that function's doc for why). Split out purely to keep that function's cognitive
 *  complexity under the shop ceiling.
 *  @throws {ExternalMcpSecretStoreUnconfiguredError} If the re-seal never recovers within
 *  {@link CLEAR_TOKEN_RESEAL_ATTEMPTS} attempts. */
async function resealClearedOAuthToken(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
  clientSecret: { readonly clientSecret?: string },
): Promise<ClearedTokenPatch> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const cleared = await deps.ports.store.sealPayload(deps, record, clientSecret);
      return { sealedOAuth: cleared.sealedOAuth, oauthExpiresAt: null, oauthAadVersion: cleared.oauthAadVersion };
    } catch (error) {
      if (!deps.ports.errors.isUnconfigured(error)) throw error;
      if (attempt >= CLEAR_TOKEN_RESEAL_ATTEMPTS) throw error;
    }
  }
}

/** Moves a row into a terminal or reset OAuth state without touching anything else on it. See
 *  {@link resolveClearedTokenPatch} for the `clearToken` decision tree. */
async function setOAuthStatus(
  deps: SignInDeps,
  serverId: string,
  status: ExternalMcpOAuthStatus,
  options: SetOAuthStatusOptions = {},
): Promise<void> {
  const record = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId });
  if (!record) return;

  const endpoints = readStoredEndpoints(record);
  const forgetClient = options.forgetSelfRegisteredClient === true && isSelfRegisteredClient(record, endpoints);
  // The secret is only ever dropped together with the token (`clearToken`), never on its own.
  const clearedTokenPatch = await resolveClearedTokenPatch(deps, record, { ...options, dropClientSecret: forgetClient });

  await deps.repo.upsert({
    ...record,
    oauthStatus: status,
    ...clearedTokenPatch,
    ...(forgetClient ? { oauthClientId: null, oauthEndpointsJson: JSON.stringify(withoutSelfRegisteredClient(endpoints)) } : {}),
    oauthRefreshLeaseUntil: null,
    updatedAt: readNowIso({ clock: deps.clock }),
  });
}

/**
 * Builds the OAuth service for one workspace.
 *
 * @returns The service plus its `tokenResolver`, which `readEnabledExternalMcpConfigs` takes.
 * @complexity Construction is O(1) and performs no I/O.
 * @tradeoffs The assistant daemon can start a redirect that the web server completes: encrypted
 *   state carries the verifier and connection binding across that split using the same site key.
 *   No pending row or shared process memory is needed. The provider's single-use code and the
 *   state's expiry prevent replay. Device authorization still uses the injected durable store;
 *   its in-memory adapter is only suitable when begin and poll run in the same process.
 */
export function createHostedMcpSignInService(required: SignInDeps, _optional: Record<string, never> = {}): ExternalMcpOAuthService {
  const deps: ExternalMcpOAuthServiceDeps = { ...required, providers: required.providers ?? required.ports.flow.createOAuthProviderRegistry({ guard: required.httpPorts.guard }) };
  const refresher = deps.ports.flow.createTokenRefresher({
    clock: deps.clock,
    sleep: ({ ms }) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    port: {
      async load({ key: serverId }) {
        const record = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId });
        if (!record) return null;
        // A row already parked in `needs_reauth` must not be probed again on every tool call: the
        // state is durable and only a human clears it.
        if (deps.ports.projections.oauthStatus(record) === "needs_reauth") return null;
        const payload = await deps.ports.store.openPayload(deps.sealer, record);
        return payload.tokens === undefined
          ? null
          : { ...payload.tokens, scopes: [...payload.tokens.scopes] };
      },

      async refresh({ key: serverId, refreshToken }) {
        const record = await requireOAuthRecord(deps, serverId);
        const provider = resolveProviderDescriptor(deps, record);
        return deps.ports.withCopy({ call: async () => deps.ports.flow.refreshAccessToken(
          { ...deps.httpPorts, clock: deps.clock, tokenEndpoint: provider.tokenEndpoint,
            client: await resolveClient(deps, record, provider), refreshToken },
          { scopes: readStoredScopes(record), ...resourceOption(readStoredEndpoints(record).resource), timeoutMs: CONNECT_TIMEOUT_MS },
        ) });
      },

      async persist({ key: serverId, tokens }) {
        const record = await requireOAuthRecord(deps, serverId);
        await persistTokens(deps, record, tokens);
      },

      async markNeedsReauth({ key: serverId }) {
        // The token is CLEARED, not kept: it is known dead, and a dead credential sitting in the
        // row is one accidental read away from being sent to a provider that will reject it.
        await setOAuthStatus(deps, serverId, "needs_reauth", { clearToken: true });
      },

      async tryAcquireRefreshLease({ key: serverId }) {
        const nowIso = readNowIso({ clock: deps.clock });
        return deps.repo.tryClaimOAuthRefreshLease({
          workspaceId: deps.workspaceId,
          serverId,
          nowIso,
          leaseUntil: new Date(Date.parse(nowIso) + REFRESH_LEASE_MS).toISOString(),
        });
      },

      async releaseRefreshLease({ key: serverId }) {
        await deps.repo.releaseOAuthRefreshLease({ workspaceId: deps.workspaceId, serverId });
      },
    },
  });

  const shared = deps.shared ? createSharedExternalMcpOAuth({ deps, shared: deps.shared, ports: deps.ports, resolveProvider: record => resolveProviderDescriptor(deps, record), configure: async input => {
    const record = await selfConfigureConnection(deps, await requireOAuthRecord(deps, input.serverId), input.redirectUri, { configurationOnly: true });
    const provider = resolveProviderDescriptor(deps, record);
    const endpoints = readStoredEndpoints(record);
    return { record, provider, client: await resolveClient(deps, record, provider), scopes: readStoredScopes(record),
      resource: endpoints.resource ?? record.url ?? undefined, issuer: endpoints.issuer };
  } }) : undefined;

  return {
    ...(shared ? { assertSharedAuthorized: shared.assertAuthorized, useSharedConnection: shared.useSaved, useLocalConnection: shared.useLocal, listSharedConnections: shared.list } : {}),
    async beginConnect(input) {
      if (input.destination === 'shared' && !shared) throw deps.ports.errors.validation(deps.ports.copy.sharedLocalOnly, 'destination');
      if (shared && (input.destination === 'shared' || await shared.hasBinding(input))) return shared.beginConnect(input);
      // Self-configuration first: a row that names no endpoints or no client id gets them here, once,
      // and every step below then reads an ordinary fully-specified connection.
      const record = await selfConfigureConnection(deps, await requireOAuthRecord(deps, input.serverId), input.redirectUri);
      const provider = resolveProviderDescriptor(deps, record);
      const client = await resolveClient(deps, record, provider);
      const scopes = readStoredScopes(record);
      // Keep the advertised audience across grants; the MCP URL need not be the resource id.
      const resource = readStoredEndpoints(record).resource;

      if (record.oauthGrant === "device_code") {
        const authorization = await deps.ports.withCopy({ call: () => deps.ports.flow.beginDeviceAuthorization(
          { ...deps.httpPorts, provider, clock: deps.clock, client },
          { scopes, ...resourceOption(resource), timeoutMs: CONNECT_TIMEOUT_MS },
        ) });
        await deps.devices.put(record.serverId, authorization);
        await setOAuthStatus(deps, record.serverId, "pending");
        return {
          kind: "device_code",
          userCode: authorization.userCode,
          verificationUri: authorization.verificationUri,
          verificationUriComplete: authorization.verificationUriComplete,
          expiresAt: authorization.expiresAt,
          intervalSeconds: authorization.intervalSeconds,
        };
      }

      // Every path below this line is redirect-based, so the requirement is real rather than
      // defensive — and it is stated where it can name both the grant and the fix, instead of being
      // a blanket precondition a caller had to satisfy before it knew which grant it had.
      const redirectUri = input.redirectUri;
      if (redirectUri === undefined) {
        throw deps.ports.errors.validation(deps.ports.copy.noPublicOrigin({ serverId: record.serverId }), "redirectUri");
      }

      // The authenticated GET sets the shared browser-binding cookie before revealing a provider
      // URL. This also works when the daemon prepared the connection in another process.
      if (input.delivery === 'hosted') {
        await setOAuthStatus(deps, record.serverId, 'pending');
        return {
          kind: 'redirect_required',
          authorizationUrl: deps.ports.signInLink({ callbackUrl: redirectUri, workspaceId: deps.workspaceId, serverId: record.serverId }),
          expiresAt: new Date(deps.clock.nowMs() + 600_000).toISOString(),
        };
      }
      const started = await deps.ports.withCopy({ call: () => deps.ports.flow.beginAuthorizationCode(
        { provider, stateless: sealedRedirectState({ deps, serverId: record.serverId, browserBinding: input.browserBinding }), guard: deps.httpPorts.guard,
          randomBytesFn: ({ byteLength }) => randomBytes(byteLength),
          options: oauthClientOptions(deps.ports, record, redirectUri),
          ownerKey: ownerKeyOf(deps.workspaceId, record.serverId),
          client,
          redirectUri,
        }, {
          scopes,
          ...resourceOption(resource),
          messages: deps.ports.oauthMessages,
        },
      ) });
      await setOAuthStatus(deps, record.serverId, "pending");
      return { kind: "redirect_required", authorizationUrl: started.authorizationUrl, expiresAt: started.expiresAt };
    },

    async completeAuthorizationCallback(input, _options = {}) {
      if (shared && await shared.hasBinding(input)) { await shared.completeAuthorizationCallback(input); await notifyConnected(deps, input.serverId); return; }
      const record = await requireOAuthRecord(deps, input.serverId);
      const provider = resolveProviderDescriptor(deps, record);
      const client = await resolveClient(deps, record, provider);

      let tokens: OAuthTokenSet;
      try {
        tokens = await deps.ports.withCopy({ call: () => deps.ports.flow.completeAuthorizationCode(
          { ...deps.httpPorts, provider, stateless: sealedRedirectState({ deps, serverId: record.serverId, browserBinding: input.browserBinding }), clock: deps.clock,
            redirectUri: input.redirectUri,
            ownerKey: ownerKeyOf(deps.workspaceId, record.serverId),
            client,
            params: input.params,
          }, {
            timeoutMs: CONNECT_TIMEOUT_MS,
          },
        ) });
      } catch (error) {
        // A provider that refuses the CLIENT (revoked, or never known) will refuse it on every retry,
        // so a self-registered one is dropped and the next connect mints a fresh one. The provider's
        // error still reaches the caller.
        if (deps.ports.errors.isOAuthError(error) && CLIENT_REJECTED_PROVIDER_CODES.includes(error.providerErrorCode ?? "")) {
          await setOAuthStatus(deps, record.serverId, "disconnected", { clearToken: true, forgetSelfRegisteredClient: true });
        }
        throw error;
      }
      // Re-read rather than reusing `record`: `beginConnect` wrote `pending` to it, and persisting a
      // stale copy would resurrect the pre-connect row wholesale.
      await persistTokens(deps, await requireOAuthRecord(deps, input.serverId), tokens);
      await notifyConnected(deps, input.serverId);
    },

    async pollDeviceAuthorization(input) {
      if (shared && await shared.hasBinding(input)) {
        const result = await shared.pollDeviceAuthorization(input);
        if (result.status === "connected") await notifyConnected(deps, input.serverId);
        return result;
      }
      const record = await requireOAuthRecord(deps, input.serverId);
      const authorization = await deps.devices.get(input.serverId);
      if (!authorization) {
        throw deps.ports.errors.oauth({ code: "OAUTH_INVALID_STATE", message: `no device authorization is in progress for '${input.serverId}'`, operatorAction: deps.ports.copy.actions.restartDevice, });
      }

      const provider = resolveProviderDescriptor(deps, record);
      const client = await resolveClient(deps, record, provider);
      try {
        const tokens = await deps.ports.withCopy({ call: () => deps.ports.flow.pollDeviceAuthorizationOnce(
          { ...deps.httpPorts, provider, clock: deps.clock,
            client,
            deviceCode: authorization.deviceCode,
            expiresAt: authorization.expiresAt,
          }, {
            // The token request names the same audience the device start asked for (RFC 8707).
            ...resourceOption(readStoredEndpoints(record).resource),
            timeoutMs: CONNECT_TIMEOUT_MS,
          },
        ) });
        await deps.devices.delete(input.serverId);
        await persistTokens(deps, record, tokens);
        await notifyConnected(deps, input.serverId);
        return { status: "connected" };
      } catch (error) {
        // The ONLY retryable branch in this whole module — RFC 8628 §3.5 requires the client to keep
        // polling on these two, and only these two.
        if (deps.ports.errors.isOAuthError(error) && error.retryable) {
          return { status: "pending", retryAfterSeconds: error.retryAfterSeconds ?? authorization.intervalSeconds };
        }
        await deps.devices.delete(input.serverId);
        await setOAuthStatus(deps, input.serverId, "disconnected");
        throw error;
      }
    },

    async disconnect(input) {
      if (shared && await shared.hasBinding(input)) {
        await shared.disconnect(input);
        return;
      }
      await deps.devices.delete(input.serverId);
      // A self-registered client goes too, so a reconnect is a clean one: a client the vendor has
      // since dropped would otherwise be reused forever. An operator-typed client is kept.
      await setOAuthStatus(deps, input.serverId, "disconnected", { clearToken: true, forgetSelfRegisteredClient: true });
    },

    async reportAuthFailure(serverId, error) {
      if (shared && await shared.hasBinding({ serverId })) {
        await shared.markNeedsReauth({ serverId });
        throw deps.ports.errors.reauthRequired({ serverId, cause: error });
      }
      const record = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId });
      // A preset connection, a `static_env` row, or one already deleted has no reauth state this
      // service owns — see `createExternalMcpConnectionGate`'s identical passthrough.
      if (!record || deps.ports.projections.authMode(record) !== "oauth") throw error;

      // The state write is BEST EFFORT; the terminal error below is the guarantee. `setOAuthStatus`
      // can still fail here — a row write that rejects, or a blob `openExternalMcpOAuthPayload`
      // refuses for a reason that is NOT `ExternalMcpSecretStoreUnconfiguredError` (a payload written
      // at a newer schema version, which `hydrateExternalMcpOAuthPayload` throws deliberately outside
      // its own catch). Letting that escape would hand the caller an incidental error in place of the
      // terminal one, and every consumer branches on the CLASS: the connection gate would not engage,
      // the in-chat `external_mcp_reauth_prompt` surface would never render, and the "do not retry"
      // sentence a model needs in order to stop hammering a dead connection would be gone — the
      // failure mode that surface exists for. So the write's failure is carried out as `cause`
      // instead of thrown in its place: nothing is silently swallowed, and nothing displaces the
      // signal. A row left un-updated is recoverable on the next call; a lost signal is not.
      let statusWriteFailure: unknown;
      // Idempotent: a call that arrives after `tokenResolver` already discovered the same dead
      // grant must not re-clear an already-cleared token or bump `updatedAt` needlessly.
      if (deps.ports.projections.oauthStatus(record) !== "needs_reauth") {
        try {
          await setOAuthStatus(deps, serverId, "needs_reauth", { clearToken: true });
        } catch (writeError) {
          statusWriteFailure = writeError;
        }
      }
      throw deps.ports.errors.reauthRequired({
        serverId,
        label: record.label,
        ...(statusWriteFailure === undefined ? {} : { cause: statusWriteFailure }),
      });
    },

    tokenResolver: {
      ...(shared ? { resolveSharedAccessToken: shared.getAccessToken } : {}),
      async resolveAccessToken({ serverId }) {
        const sharedToken = await shared?.getAccessToken({ serverId });
        if (sharedToken !== undefined) return sharedToken;
        try {
          return await refresher.getAccessToken({ key: serverId });
        } catch (error) {
          // Whatever the refresher's own taxonomy says, the caller here is about to hand a message to
          // a model, so a `needs_reauth` outcome is translated into the one non-retryable sentence
          // that makes it stop. Anything else (a provider outage) keeps its own error, because it is
          // NOT a durable state and must not be reported as one.
          if (deps.ports.errors.isOAuthError(error) && error.code === "OAUTH_INVALID_GRANT") {
            const record = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId });
            throw deps.ports.errors.reauthRequired({ serverId, label: record?.label ?? null });
          }
          throw error;
        }
      },
    },
  };
}
