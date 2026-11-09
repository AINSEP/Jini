/** @agent-note Types only. Sign-in contracts for hosted MCP connections; the host fulfills every port and passes the same repository instance the store uses. */
import type { Clock as ClockPort, ISODateTime, UUID } from '@jini-ai/core/primitives';
import type { KeyringPort, SecretSealerPort } from '@jini-ai/core/contracts/vault';
import type { AuthorizationCallbackParams, DeviceAuthorization, OAuthHttpPorts, OAuthProviderDescriptor, OAuthProviderRegistry } from '@jini-ai/core/contracts/oauth';
import type { ExternalMcpConnectStart, ExternalMcpOAuthTokenResolverPort, ExternalMcpServerRepoPort } from '@jini-ai/core/contracts/hosted-mcp';

/**
 * One device authorization awaiting the operator's approval.
 *
 * `Promise`-returning because the real adapter
 * (`platform/db/repos/oauth-pending-store.ts`'s `createSqlDeviceAuthorizationStore`)
 * persists to `content.db` and seals `deviceCode` through the same ADR-058 sealer/keyring every
 * other secret there goes through, so both implementations share one async call shape. This file's
 * own `createDeviceAuthorizationStore` below is the in-memory ADR-006 "second adapter" — used by
 * tests and by any composition root with no persistent `content.db` — not the production path.
 * "Worthless after a restart" was never the reason durability matters: the agent daemon starts the
 * handshake and the web server completes it in a different process, and a process-local Map cannot
 * join those two legs. Memory stores remain useful only where the whole handshake stays in one process.
 */
/** @agent-note Fulfilled by the host (durable store in production, memory only when one process runs the whole handshake). The service that starts a device grant and the one that polls it must share this store. */
export interface DeviceAuthorizationStore {
  /** @agent-note Replaces any pending authorization for the server id. */
  put(serverId: string, authorization: DeviceAuthorization): Promise<void>;
  /** @agent-note `undefined` when none is pending or it was deleted. */
  get(serverId: string): Promise<DeviceAuthorization | undefined>;
  /** @agent-note Idempotent. */
  delete(serverId: string): Promise<void>;
}

/** @agent-note `Shared` is the host's shared-owner storage port (Tovu binds `SharedExternalMcpOwner`); absent keeps site-local sign-in. `repo` must be the store's repository instance; `httpPorts` is required guarded transport; `onConnected` runs once after durable success and its failure never fails sign-in. */
export interface ExternalMcpOAuthDeps<Shared = never> {
  /** Desktop owner storage is optional; absence retains existing site-local sign-in. */
  readonly shared?: Shared;
  readonly workspaceId: UUID;
  readonly repo: ExternalMcpServerRepoPort;
  readonly sealer: SecretSealerPort;
  readonly keyring: KeyringPort;
  readonly clock: ClockPort;
  readonly devices: DeviceAuthorizationStore;
  /** Required guarded transport and endpoint policy: no raw-fetch fallback can send a credential. */
  readonly httpPorts: OAuthHttpPorts;
  /** Host-owned registration; separate services do not mutate a process-wide provider map. */
  readonly providers?: OAuthProviderRegistry;
  /** Resolves a REGISTERED provider descriptor. Injected so a test can register its own without
   *  mutating another service's registry. Defaults to this service's host-owned instance. */
  readonly lookupProvider?: (providerId: string) => OAuthProviderDescriptor;
  /** Runs after a sign-in succeeds (redirect callback or device poll), once the token is durable.
   *  The composition root wires `features/agent-plugins/apply-connect-defaults.ts` here. A throw is
   *  logged and never fails the sign-in: the connection itself already succeeded. */
  readonly onConnected?: (serverId: string) => Promise<void>;
}

/** @agent-note One instance per host composition; its `tokenResolver` is what the store receives. OAuth errors keep their original class identity; validation refusals are the canonical `ExternalMcpValidationError` from `@jini-ai/mcp/federation/hosted`. */
export interface ExternalMcpOAuthService {
  /**
   * Starts an authorization for one connection.
   *
   * @param input.redirectUri - The absolute public callback URL, built by the route from the
   *   request so a reverse-proxied deployment gets the origin the browser actually used.
   *
   *   OPTIONAL, because whether one is needed at all is a property of the GRANT, and only this
   *   function knows the grant: `device_code` never uses a redirect URI (RFC 8628 — the human types
   *   a code at the provider; nothing redirects back), while `authorization_code` cannot proceed
   *   without one. Requiring it here pushed that decision up to every caller, and the caller with no
   *   live HTTP request to derive an origin from (`external_mcp_oauth_connect`) consequently refused
   *   EVERY grant whenever `TOVU_PUBLIC_URL` was unset — including the one that needed nothing. So:
   *   omit it when there is genuinely no origin. Never pass one built from anything the CALLER
   *   supplied (a form field, a tool-call argument) — only from operator configuration or this
   *   process's own known bind origin (`features/external-mcp/tool-registrations.ts`'s
   *   `resolveExternalMcpOAuthRedirectUri` covers both). A redirect URI the provider was
   *   not registered with still fails at the vendor with an error about the client, so this is not a
   *   license to guess from arbitrary caller input — it is what makes a value trustworthy enough to
   *   pass at all.
   * @throws {ExternalMcpValidationError} When the server is unknown, is not OAuth-authenticated, or
   *   uses a grant that requires a redirect URI and none was supplied.
   * @throws {OAuthError} Bounded, terminal, never retried — see this file's header.
   * @param input.delivery - Browser-facing callers use `hosted`: only the authenticated host hop
   *   reveals the provider URL and sets the browser cookie. Device grants keep their existing shape.
   * @param input.browserBinding - Host-issued cookie proof when that browser hop mints provider state.
   */
  /** @agent-note The redirect URI comes only from host configuration or its own bind origin, never from caller input. */
  beginConnect(input: { serverId: string; redirectUri?: string; delivery?: "hosted"; browserBinding?: string; destination?: "shared"; actorId?: string }): Promise<ExternalMcpConnectStart>;
  /**
   * Finishes an authorization-code handshake from the public callback route.
   *
   * @param input.params - The callback's query parameters, already narrowed to strings. Untrusted.
   * @param input.redirectUri - Canonical callback URI from the host's existing trusted origin policy.
   * @param input.browserBinding - Public callbacks must supply the validated browser cookie.
   *   Direct in-process callers retain the legacy unbound contract; HTTP never falls back to it.
   */
  /** @agent-note Public callbacks must pass the host-validated browser binding. */
  completeAuthorizationCallback(input: { serverId: string; redirectUri: string; params: AuthorizationCallbackParams; browserBinding?: string }, optionalArgs?: Record<string, never>): Promise<void>;
  /**
   * Polls a device authorization exactly once.
   *
   * @returns `"pending"` with the interval to wait, or `"connected"` once the token is stored.
   * @throws {OAuthError} On any terminal outcome — declined, expired, or a provider failure.
   */
  /** @agent-note Exactly one provider poll per call. */
  pollDeviceAuthorization(input: { serverId: string }): Promise<
    { readonly status: "pending"; readonly retryAfterSeconds: number } | { readonly status: "connected" }
  >;
  /** Clears the stored token and returns the connection to `disconnected`. */
  /** @agent-note Clears the stored token; the row stays. */
  disconnect(input: { serverId: string }): Promise<void>;
  /**
   * Reacts to a live federated call failing because the remote rejected our authorization (HTTP
   * 401/403), discovered mid-session rather than at boot — wired as
   * `mcp-federation/registrations.ts`'s `FederationDeps.onAuthFailed`.
   *
   * For an OAuth-authenticated row this records `needs_reauth` durably, the same state
   * `tokenResolver.resolveAccessToken` reaches at boot, so the NEXT call is refused cheaply by
   * `createExternalMcpConnectionGate`'s row read instead of reaching the network again — and
   * replaces the transport-shaped error with the same terminal, non-retryable
   * {@link ExternalMcpReauthRequiredError} that path already throws.
   *
   * A row that is not OAuth-authenticated (or no longer exists) has no reauth state to record;
   * `error` propagates unchanged.
   * @throws Always — either the original `error`, or {@link ExternalMcpReauthRequiredError}.
   */
  /** @agent-note Always throws: the original error, or the host's canonical re-authorization error. */
  reportAuthFailure(serverId: string, error: Error): Promise<never>;
  /** The port `readEnabledExternalMcpConfigs` takes, wired to this service's refresher. */
  /** @agent-note The same object the store's token resolver port receives. */
  readonly tokenResolver: ExternalMcpOAuthTokenResolverPort;
  /** True when a shared binding was checked; throws if its current grant is unavailable. */
  listSharedConnections?(input: { serverId: string; actorId: string }): Promise<{ available: boolean; connections: readonly { credentialId: string; label: string }[];
    current: { credentialId: string; status: string; granted: boolean } | null }>;
  assertSharedAuthorized?(input: { serverId: string }): Promise<boolean>;
  useLocalConnection?(input: { serverId: string; actorId: string }): Promise<void>;
  useSharedConnection?(input: { serverId: string; credentialId: string; actorId: string }): Promise<void>;
}
