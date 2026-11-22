import { ExternalMcpValidationError } from "./validation-error.js";
import { EXTERNAL_MCP_OAUTH_GRANTS } from "./vocabulary.js";
import { parseExternalMcpJsonArray } from "./access.js";
import { ENV_NAME_PATTERN, parseOAuthScopes } from "./store-input.js";
import type { ExternalMcpAuthMode, ExternalMcpOAuthGrant, ExternalMcpServerRecord, ExternalMcpTransport, SaveExternalMcpOAuthInput, SaveExternalMcpServerInput } from "@jini-ai/core/contracts/hosted-mcp";
import type { HostedMcpStorePorts } from "./store-ports.js";

/** Bounds the single-line OAuth identity fields (client id, secret). A real one is far shorter; the
 *  cap exists so a pasted file cannot become a database row. */
const MAX_OAUTH_FIELD_LENGTH = 1024;
/** Matches the OAuth provider identifier rule. Restated rather than imported for the reason this
 *  file's header gives: the row shape must not depend on the flow module. */
const OAUTH_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Parses a stored JSON object column, tolerating a null/absent/corrupt value as `{}` — the same
 *  posture {@link parseJsonArray} takes, and for the same reason: one unreadable column must not
 *  make a whole row unreadable. */
function parseJsonObject(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

/** The endpoints an operator typed for a connection that defines its own provider. Empty strings are
 *  dropped so `{}` — "this connection names a registered provider instead" — stays representable. */
function buildOAuthEndpoints(oauth: SaveExternalMcpOAuthInput): Record<string, string> {
  const entries: readonly (readonly [string, string | undefined])[] = [
    ["authorizationEndpoint", oauth.authorizationEndpoint],
    ["tokenEndpoint", oauth.tokenEndpoint],
    ["deviceAuthorizationEndpoint", oauth.deviceAuthorizationEndpoint],
  ];
  const endpoints: Record<string, string> = {};
  for (const [key, value] of entries) {
    const trimmed = value?.trim();
    if (trimmed) endpoints[key] = trimmed;
  }
  return endpoints;
}

/** The OAuth columns produced by one save, plus the operator's client-secret instruction. */
export interface ResolvedOAuthFields {
  readonly oauthProviderId: string | null;
  readonly oauthGrant: string | null;
  readonly oauthClientId: string | null;
  readonly oauthEndpointsJson: string | null;
  readonly oauthScopesJson: string | null;
  readonly oauthTokenEnvName: string | null;
  /** Three-state, as `env` is: `undefined` keeps, a string replaces, `""` clears. */
  readonly clientSecret: string | undefined;
}

/**
 * Validates and resolves the OAuth columns for one save.
 *
 * @throws {ExternalMcpValidationError} On any invalid operator input, with `field` naming the
 * offending form control (`oauth.clientId`, `oauth.grant`, ...).
 * @complexity O(n) in the number of scopes.
 */
/** The OAuth columns of a row that is NOT OAuth-authenticated: all cleared.
 *
 *  Cleared rather than preserved, deliberately: a row switched to `static_env` that still carried a
 *  provider and a client id would silently re-adopt them if it were ever switched back, along with a
 *  token issued under configuration nobody has looked at since. */
const NO_OAUTH_FIELDS: ResolvedOAuthFields = {
  oauthProviderId: null,
  oauthGrant: null,
  oauthClientId: null,
  oauthEndpointsJson: null,
  oauthScopesJson: null,
  oauthTokenEnvName: null,
  clientSecret: "",
};

/**
 * The first non-empty trimmed candidate, or `""`.
 *
 * Every OAuth identity field follows the same precedence — what the operator just submitted, then
 * what the row already holds, then nothing — and writing that as a `??` chain at each field is both
 * repetitive and, measurably, most of these functions' branch count. One helper makes the precedence
 * a single named rule instead of five copies of it.
 *
 * @complexity O(n) in the number of candidates, each trimmed once.
 */
export function firstTrimmed(...candidates: readonly (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * Validates a sign-in method, or admits its absence on a row that can discover it for itself.
 *
 * The same exception {@link assertOAuthClientId} documents, extended to the grant: a REMOTE row can
 * run RFC 8414 discovery against its own URL at connect time and read the authorization server's own
 * `grant_types_supported` (`discovery.ts`) instead of an operator having to guess between "Browser
 * sign-in" and "Device code" before they know what the server even offers. See
 * the sign-in service's `selfConfigureConnection`, which resolves and persists a concrete grant
 * the first time such a row connects. A stdio row has no URL to discover from, so for those the
 * requirement stands unchanged.
 *
 * @returns The validated grant, or `null` when the row will resolve one at connect.
 * @throws {ExternalMcpValidationError} On an empty grant the row cannot leave to discovery, or one
 * outside {@link EXTERNAL_MCP_OAUTH_GRANTS}.
 * @complexity O(1).
 */
function assertOAuthGrant(grant: string, selfConfigurable: boolean): ExternalMcpOAuthGrant | null {
  if (grant === "") {
    if (selfConfigurable) return null;
    throw new ExternalMcpValidationError("an OAuth connection needs a sign-in method", "oauth.grant");
  }
  if (!EXTERNAL_MCP_OAUTH_GRANTS.includes(grant as ExternalMcpOAuthGrant)) {
    throw new ExternalMcpValidationError(
      `OAuth grant '${grant}' is not supported — expected one of ${EXTERNAL_MCP_OAUTH_GRANTS.join(", ")}`,
      "oauth.grant",
    );
  }
  return grant as ExternalMcpOAuthGrant;
}

/**
 * Validates a client id, or admits its absence on a row that can obtain one for itself.
 *
 * `selfConfigurable` is what makes an empty client id legitimate rather than a validation failure.
 * A growing share of hosted authorization servers publish an RFC 7591 `registration_endpoint` and no
 * developer console at all, so for those there is no human path to a client id — demanding one here
 * would make the connection unreachable by any amount of operator effort. A row that carries a REMOTE
 * URL can run discovery against it at connect time and mint one; a stdio row has nothing to discover
 * from, so for those the requirement stands unchanged.
 *
 * @returns The validated client id, or `null` when the row will mint one at connect.
 * @throws {ExternalMcpValidationError} On an empty client id the row cannot obtain, or an oversized one.
 * @complexity O(1).
 */
function assertOAuthClientId(clientId: string, selfConfigurable: boolean): string | null {
  if (clientId === "") {
    if (selfConfigurable) return null;
    throw new ExternalMcpValidationError("an OAuth connection needs a client id", "oauth.clientId");
  }
  if (clientId.length > MAX_OAUTH_FIELD_LENGTH) {
    throw new ExternalMcpValidationError(`the OAuth client id may be at most ${MAX_OAUTH_FIELD_LENGTH} characters`, "oauth.clientId");
  }
  return clientId;
}

/**
 * Resolves the provider half of an OAuth connection: a registered provider id, its own endpoints, or
 * both.
 *
 * Endpoints are re-derived whenever the operator actually TYPED into either identity field, so
 * clearing a provider id and typing endpoints (or the reverse) cannot leave half of the old pairing
 * behind. "Actually typed" is judged by content, not key presence: the admin form sends both fields
 * on every save (it cannot round-trip a connection's own endpoints), so treating mere presence as a
 * touch made an untouched save look like an identity change on every edit. The host's form must preserve that distinction.
 *
 * The dynamic-registration members (`clientAuth`, `dynamicClientId`, `registeredRedirectUri`) are
 * exempted from re-derivation regardless of branch: they are server-owned, written only by dynamic
 * client registration by the sign-in service, and no operator input can express them, so even a
 * save that legitimately edits the other endpoints must not drop them.
 *
 * @throws {ExternalMcpValidationError} When neither a provider id nor a token endpoint is present,
 * or the provider id is malformed.
 * @complexity O(1).
 */
function resolveOAuthEndpoints(
  oauth: SaveExternalMcpOAuthInput,
  existing: ExternalMcpServerRecord | null,
): Record<string, string> {
  const stored = parseJsonObject(existing?.oauthEndpointsJson ?? null);
  const touchedIdentity = (oauth.providerId ?? "").trim() !== "" || (oauth.tokenEndpoint ?? "").trim() !== "";
  if (!touchedIdentity) return stored;
  const rebuilt = buildOAuthEndpoints(oauth);
  for (const key of DYNAMIC_REGISTRATION_ENDPOINT_KEYS) {
    if (stored[key] !== undefined) rebuilt[key] = stored[key];
  }
  return rebuilt;
}

/** The endpoints-blob members only dynamic client registration writes. */
const DYNAMIC_REGISTRATION_ENDPOINT_KEYS = ["clientAuth", "dynamicClientId", "registeredRedirectUri"] as const;

/**
 * @param selfConfigurable - Whether this row can discover its own endpoints — see
 *   {@link assertOAuthClientId} for the same argument applied to the client id.
 * @throws {ExternalMcpValidationError} When neither identity is present on a row that cannot
 *   discover one, or the id is malformed.
 */
function assertOAuthProviderIdentity(providerId: string, endpoints: Record<string, string>, selfConfigurable: boolean): void {
  if (providerId === "" && endpoints.tokenEndpoint === undefined && !selfConfigurable) {
    throw new ExternalMcpValidationError(
      "an OAuth connection needs either a registered provider id or its own token endpoint",
      "oauth.providerId",
    );
  }
  if (providerId !== "" && !OAUTH_PROVIDER_ID_PATTERN.test(providerId)) {
    throw new ExternalMcpValidationError(
      `'${providerId}' is not a valid provider id (lowercase letters, digits and hyphens)`,
      "oauth.providerId",
    );
  }
}

function resolveOAuthProviderIdentity(
  oauth: SaveExternalMcpOAuthInput,
  existing: ExternalMcpServerRecord | null,
  selfConfigurable: boolean,
): { readonly oauthProviderId: string | null; readonly oauthEndpointsJson: string | null } {
  const providerId = firstTrimmed(oauth.providerId, existing?.oauthProviderId);
  const endpoints = resolveOAuthEndpoints(oauth, existing);
  assertOAuthProviderIdentity(providerId, endpoints, selfConfigurable);

  return {
    oauthProviderId: providerId === "" ? null : providerId,
    oauthEndpointsJson: Object.keys(endpoints).length === 0 ? null : JSON.stringify(endpoints),
  };
}

/**
 * Resolves which child-process environment variable receives the access token.
 *
 * `null` for every non-`stdio` transport: only `stdio` hands credentials to a child process, so only
 * `stdio` needs a name for one.
 *
 * @throws {ExternalMcpValidationError} When a stdio+OAuth row names none, or names an invalid one.
 * @complexity O(n) in the name length.
 */
function resolveOAuthTokenEnvName(
  transport: ExternalMcpTransport,
  oauth: SaveExternalMcpOAuthInput,
  existing: ExternalMcpServerRecord | null,
): string | null {
  if (transport !== "stdio") return null;

  const tokenEnvName = firstTrimmed(oauth.tokenEnvName, existing?.oauthTokenEnvName);
  if (tokenEnvName === "") {
    throw new ExternalMcpValidationError(
      "a stdio server authenticated with OAuth needs the name of the environment variable that receives its access token",
      "oauth.tokenEnvName",
    );
  }
  if (!ENV_NAME_PATTERN.test(tokenEnvName)) {
    throw new ExternalMcpValidationError(
      `'${tokenEnvName}' is not a valid environment variable name (letters, digits and underscore, not starting with a digit)`,
      "oauth.tokenEnvName",
    );
  }
  return tokenEnvName;
}

/** Scopes for one save. Absent input KEEPS the stored list (the three-state rule `env` sets); an
 *  empty string clears it, since {@link parseOAuthScopes} of `""` is `[]`. */
function resolveSavedOAuthScopes(oauth: SaveExternalMcpOAuthInput, existing: ExternalMcpServerRecord | null): string[] {
  if (oauth.scopes === undefined) return parseExternalMcpJsonArray({ raw: existing?.oauthScopesJson ?? null });
  return parseOAuthScopes({ raw: oauth.scopes });
}

export function resolveOAuthFields(
  authMode: ExternalMcpAuthMode,
  transport: ExternalMcpTransport,
  input: SaveExternalMcpServerInput,
  existing: ExternalMcpServerRecord | null,
  credential: HostedMcpStorePorts["credential"],
): ResolvedOAuthFields {
  if (authMode !== "oauth") return NO_OAUTH_FIELDS;

  const oauth = input.oauth ?? {};
  // Only a remote row has a URL for the sign-in service to run RFC 9728 / RFC 8414 discovery
  // against, so only a remote row may leave its provider identity, grant and client id to be filled
  // in at connect time.
  const selfConfigurable = transport !== "stdio";

  return {
    ...resolveOAuthProviderIdentity(oauth, existing, selfConfigurable),
    oauthGrant: assertOAuthGrant(firstTrimmed(oauth.grant, existing?.oauthGrant), selfConfigurable),
    oauthClientId: assertOAuthClientId(firstTrimmed(oauth.clientId, existing?.oauthClientId), selfConfigurable),
    oauthScopesJson: JSON.stringify(resolveSavedOAuthScopes(oauth, existing)),
    oauthTokenEnvName: resolveOAuthTokenEnvName(transport, oauth, existing),
    clientSecret: oauth.clientSecret === '' || oauth.clientSecret === undefined ? undefined : normalizeOAuthClientSecret({ value: oauth.clientSecret, credential }),
  };
}

/** Host error adapter for the shared token policy. The store alone normalizes the value. */
function normalizeOAuthClientSecret({ value, credential }: { value: string; credential: HostedMcpStorePorts["credential"] }): string {
  try { return credential.normalize({ value, field: 'oauth.clientSecret' }); }
  catch (err) {
    if (err instanceof credential.InputError) throw new ExternalMcpValidationError(err.message, err.field);
    throw err;
  }
}
