import type { DiscoveredOAuthConfiguration } from "@jini-ai/core/contracts/oauth";
import type { ExternalMcpOAuthGrant, ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import type { HostedMcpSignInPorts } from "./contracts.js";
import { noOAuthProviderError, oauthClientOptions, type SignInDeps, type StoredOAuthEndpoints } from "./sign-in-provider.js";
import { CONNECT_TIMEOUT_MS } from "./sign-in-flow.js";

// ---------------------------------------------------------------------------
// Self-configuration: discovery + dynamic client registration
//
// A connection may reach `beginConnect` missing the two things every grant needs: where the
// authorization server is, and who the host is to it. Operators can configure both for a provider
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
export function needsEndpointDiscovery(record: ExternalMcpServerRecord, endpoints: StoredOAuthEndpoints): boolean {
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
export function toStoredEndpoints(discovered: DiscoveredOAuthConfiguration & { readonly resource?: string | null | undefined }): StoredOAuthEndpoints {
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
export async function discoverConnectionAuthorizationServer(
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
 *  `grant_types` name the device flow. The internal grant alias is the shorter `device_code`
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
 * choice, taken only when the server names no other grant this sign-in implements.
 *
 * @throws {OAuthError} `OAUTH_INVALID_REQUEST` when the metadata names neither grant this sign-in
 *   implements — naming exactly what the server DID advertise, since an operator who only sees
 *   "connect failed" has no way to guess that from the failure alone.
 * @complexity O(n) in the number of advertised grant types.
 */
export function resolveGrantFromDiscovery({ grantTypesSupported, serverId, ports }: { grantTypesSupported: readonly string[]; serverId: string; ports: HostedMcpSignInPorts }, _optional = {}): ExternalMcpOAuthGrant {
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
export async function mintClientForConnection({ deps, record, discovered, input }: { deps: SignInDeps; record: ExternalMcpServerRecord; discovered: DiscoveredOAuthConfiguration; input: { readonly redirectUri: string | undefined; readonly scopes: readonly string[]; readonly grant: ExternalMcpOAuthGrant } }, _optional = {}
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
