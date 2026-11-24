import type { OAuthAppOptions, OAuthClient, OAuthClientAuthMethod, OAuthProviderDescriptor, OAuthProviderRegistry } from "@jini-ai/core/contracts/oauth";
import type { ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import type { HostedMcpSignInPorts } from "./contracts.js";
import type { ExternalMcpOAuthDeps as HostedMcpOAuthDeps } from "@jini-ai/core/contracts/site/api-connections-hosted-mcp";
import type { SharedExternalMcpOwner } from "./shared-sign-in.js";

/** {@link ExternalMcpOAuthDeps} as the service holds them: `providers` defaulted once at construction,
 *  so nothing downstream builds a second registry. */
/** The sign-in's whole input: the canonical deps plus the host's {@link HostedMcpSignInPorts}. */
export type SignInDeps = HostedMcpOAuthDeps<SharedExternalMcpOwner> & { readonly ports: HostedMcpSignInPorts };
export type ExternalMcpOAuthServiceDeps = SignInDeps & { readonly providers: OAuthProviderRegistry };

/** Stable registration identity; callback URLs come only from the host's trusted origin policy.
 * Device-only clients deliberately register no redirect URI (RFC 7591).
 */
export function oauthClientOptions(ports: HostedMcpSignInPorts, record: ExternalMcpServerRecord, redirectUri: string | undefined): OAuthAppOptions {
  return { clientDisplayName: ports.registrationIdentity.clientName(record), softwareId: ports.registrationIdentity.softwareId,
    redirectUris: redirectUri === undefined ? [] : [redirectUri] };
}

/** Loads an OAuth-authenticated row, or explains why it cannot be used.
 *  @throws {ExternalMcpValidationError} */
export async function requireOAuthRecord(deps: SignInDeps, serverId: string): Promise<ExternalMcpServerRecord> {
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
export function noOAuthProviderError(required: { readonly ports: HostedMcpSignInPorts; readonly serverId: string }): Error {
  return required.ports.errors.oauth({ code: "OAUTH_INVALID_REQUEST", message: `external MCP server '${required.serverId}' names no OAuth provider and defines no token endpoint`, operatorAction: required.ports.copy.actions.noProvider, });
}

/** The endpoint trio an operator may type onto a connection, as stored. Absent members mean "this
 *  connection names a registered provider for that part instead", or — on a remote connection — that
 *  discovery has not run yet. */
export interface StoredOAuthEndpoints {
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
   * The client id dynamic registration minted for this row. It marks the row's client as the host's own,
   * which the host may replace; a client id an operator typed never matches it and is never replaced.
   * Compared against the row's live `oauthClientId` rather than trusted as a flag, so an operator
   * who later types a client id over a minted one keeps theirs.
   */
  dynamicClientId?: string;
  /** The callback URL {@link dynamicClientId} was registered with. A server that pins redirect URIs
   *  rejects any other, and the desktop app's port changes on every restart. */
  registeredRedirectUri?: string;
}

/** Reads the stored endpoints column, tolerating a null or corrupt value as "none typed". */
export function readStoredEndpoints(record: ExternalMcpServerRecord): StoredOAuthEndpoints {
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
export function readStoredScopes(record: ExternalMcpServerRecord): string[] {
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
export function resolveProviderDescriptor(deps: ExternalMcpOAuthServiceDeps, record: ExternalMcpServerRecord): OAuthProviderDescriptor {
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
export async function resolveClient(
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

/**
 * Whether the row's client is one the host minted by dynamic registration, and so the host's to replace.
 *
 * A row written before {@link StoredOAuthEndpoints.dynamicClientId} existed carries no such mark.
 * For those, a stored `clientAuth` stands in for it: that member is only ever written by dynamic
 * registration. A pre-mark self-registered PUBLIC client (no secret, so no `clientAuth`) is not
 * recognized, and keeps the old reuse-forever behavior until an operator clears it.
 * @complexity O(1).
 */
export function isSelfRegisteredClient(record: ExternalMcpServerRecord, endpoints: StoredOAuthEndpoints): boolean {
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
export function isStaleSelfRegisteredClient({ record, endpoints, redirectUri }: { record: ExternalMcpServerRecord; endpoints: StoredOAuthEndpoints; redirectUri: string | undefined }, _optional = {}): boolean {
  if (redirectUri === undefined || record.oauthGrant === "device_code") return false;
  return isSelfRegisteredClient(record, endpoints) && endpoints.registeredRedirectUri !== redirectUri;
}

/** The endpoints blob minus everything that describes a self-registered client. @complexity O(1). */
export function withoutSelfRegisteredClient(endpoints: StoredOAuthEndpoints): StoredOAuthEndpoints {
  const next = { ...endpoints };
  delete next.clientAuth;
  delete next.dynamicClientId;
  delete next.registeredRedirectUri;
  return next;
}
