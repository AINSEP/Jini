import { nowIso as readNowIso } from "@jini-ai/core/primitives";
import type { DiscoveredOAuthConfiguration } from "@jini-ai/core/contracts/oauth";
import type { ExternalMcpOAuthGrant, ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import type { HostedMcpSignInPorts } from "./contracts.js";
import { updateRowOnce } from "./oauth-row-writes.js";
import { readStoredEndpoints, readStoredScopes, requireOAuthRecord, isStaleSelfRegisteredClient, withoutSelfRegisteredClient, type SignInDeps, type StoredOAuthEndpoints } from "./sign-in-provider.js";
import { needsEndpointDiscovery, toStoredEndpoints, discoverConnectionAuthorizationServer, resolveGrantFromDiscovery, mintClientForConnection } from "./sign-in-discovery.js";

/** Writes one connect's self-configuration onto the row, preserving anything already sealed beside it.
 *
 *  Read-modify-write for the same reason {@link persistTokens} is: sealing `{ clientSecret }` alone
 *  would delete a token the connection is still holding.
 *  @complexity O(1) — one unseal, one seal, one conditional write. */
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
  const build = async (current: ExternalMcpServerRecord): Promise<ExternalMcpServerRecord> => {
    const existing = await deps.ports.store.openPayload(deps.sealer, current);
    const clientSecret = identity.clientSecret === undefined ? existing.clientSecret : (identity.clientSecret ?? undefined);
    const { sealedOAuth, oauthAadVersion } = await deps.ports.store.sealPayload(deps, current, {
      ...(clientSecret === undefined ? {} : { clientSecret }),
      ...(existing.tokens === undefined ? {} : { tokens: existing.tokens }),
    });
    return {
      ...current,
      oauthGrant: identity.grant,
      oauthClientId: identity.clientId,
      oauthEndpointsJson: JSON.stringify(identity.endpoints),
      oauthScopesJson: JSON.stringify(identity.scopes),
      sealedOAuth,
      // Carried from the seal, never from `...current` — the spread holds the row's OLD version.
      oauthAadVersion,
      updatedAt: readNowIso({ clock: deps.clock }),
    };
  };
  if (options.configurationOnly) return build(record);
  // Sign-in configuration is an editor-visible change: compared on version, retried once (M4).
  return (await updateRowOnce({ repo: deps.repo, key: record, build })) ?? requireOAuthRecord(deps, record.serverId);
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
export async function selfConfigureConnection(
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
