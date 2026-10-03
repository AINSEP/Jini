/**
 * @module providers/pkce
 *
 * Fixed-issuer OAuth 2.0 Authorization Code + PKCE (RFC 7636) provider adapters —
 * verifier/challenge/state generation, authorize-URL building, and the
 * code-exchange/refresh token-endpoint calls.
 *
 * Originally vendored from the minimal subset of OD's `apps/daemon/src/mcp-oauth.ts`
 * (a 601-line "daemon-side OAuth 2.1 client for HTTP/SSE MCP servers") that
 * `integrations/xai-oauth.ts` actually depends on: PKCE generation,
 * `buildAuthorizeUrl`, `exchangeCodeForToken`, `refreshAccessToken`, and the
 * in-memory `PendingAuthCache`. The origin file's protected-resource /
 * authorization-server RFC 9728+8414 *discovery* and Dynamic Client
 * Registration (RFC 7591) machinery — `discoverProtectedResource`,
 * `discoverAuthServer`, `registerClient`, `getOrRegisterClient`, `beginAuth`
 * — is a distinct, separately-scoped MCP-server-OAuth-discovery subsystem
 * that `xai-oauth.ts` never calls (xAI's OAuth server is hardcoded, no MCP
 * discovery involved) and is not part of this task's 13-file scope; not
 * ported, mirroring the same reasoning `@jini-ai/agent-runtime`'s
 * `acp-model-probe.ts` used to exclude the ACP transport (a distinct
 * subsystem named as its own future extraction target). No product-identity
 * strings in the vendored subset. Protocol implementation now lives in
 * `@jini-ai/oauth`; this module retains the provider DTO and synchronous callback adapter.
 * The historical split still explains why discovery and dynamic registration do not
 * belong in this fixed-issuer bridge.
 */
import { randomBytes } from 'node:crypto';
import {
  createPkcePair, deriveCodeChallenge as deriveOAuthCodeChallenge, generateOAuthState,
  buildOAuthAuthorizationUrl, exchangeOAuthAuthorizationCode, refreshAccessToken as refreshOAuthAccessToken,
  createPendingAuthorizationStore, createOAuthUrlGuard, type PendingAuthorizationCache,
  type OAuthTokenSet, type OAuthClient,
} from '@jini-ai/oauth';


/** RFC 8414 / OIDC discovery document fields a PKCE client needs. */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
}

/** RFC 6749 §5.1 token endpoint response (subset). */
export interface OAuthTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/** In-flight authorization request, stashed in memory while the user approves in their browser. */
export interface PendingAuthState {
  serverId: string;
  authServerIssuer: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  codeVerifier: string;
  scope?: string;
  resource?: string;
  createdAt: number;
}


const entropy = ({ byteLength }: { byteLength: number }) => randomBytes(byteLength);
/** RFC 7636 §4.1 permits 43–128 verifier characters; 64 random bytes encode to 86. */
export function generateCodeVerifier(): string { return createPkcePair({ randomBytesFn: entropy }, { verifierBytes: 64 }).codeVerifier; }
export function deriveCodeChallenge({ verifier }: { verifier: string }): string { return deriveOAuthCodeChallenge({ codeVerifier: verifier }); }
export function generateState(): string { return generateOAuthState({ randomBytesFn: entropy }); }

export interface AuthorizeUrlInput {
  authServer: AuthorizationServerMetadata;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
  resource?: string;
}

export function buildAuthorizeUrl(requiredArgs: Pick<AuthorizeUrlInput, "authServer" | "clientId" | "redirectUri" | "state" | "codeChallenge">, optionalArgs: Omit<AuthorizeUrlInput, "authServer" | "clientId" | "redirectUri" | "state" | "codeChallenge"> = {}): string {
  return buildOAuthAuthorizationUrl({
    authorizationEndpoint: requiredArgs.authServer.authorization_endpoint,
    clientId: requiredArgs.clientId, redirectUri: requiredArgs.redirectUri,
    state: requiredArgs.state, codeChallenge: requiredArgs.codeChallenge,
  }, optionalArgs);
}

export interface ExchangeCodeInput {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  resource?: string;
}

export async function exchangeCodeForToken({ input }: { input: ExchangeCodeInput }, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): Promise<OAuthTokenResponse> {
  let issuedAtMs = 0;
  const tokenClock = { nowMs: () => (issuedAtMs = Date.now()) };
  const tokens = await exchangeOAuthAuthorizationCode({
    fetchFn: ({ url }, init) => fetchImpl(url, init), guard, clock: tokenClock,
    tokenEndpoint: input.tokenEndpoint, client: clientFor(input),
    redirectUri: input.redirectUri, code: input.code, codeVerifier: input.codeVerifier,
  }, input.resource === undefined ? {} : { resource: input.resource });
  return persistedWireTokens({ tokens, issuedAtMs });
}

export interface RefreshTokenInput {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  scope?: string;
  resource?: string;
}

export async function refreshAccessToken({ input }: { input: RefreshTokenInput }, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}): Promise<OAuthTokenResponse> {
  let issuedAtMs = 0;
  const tokenClock = { nowMs: () => (issuedAtMs = Date.now()) };
  const tokens = await refreshOAuthAccessToken({
    fetchFn: ({ url }, init) => fetchImpl(url, init), guard, clock: tokenClock,
    tokenEndpoint: input.tokenEndpoint, client: clientFor(input), refreshToken: input.refreshToken,
  }, { ...(input.scope === undefined ? {} : { scopes: input.scope.split(/\s+/).filter(Boolean) }),
       ...(input.resource === undefined ? {} : { resource: input.resource }) });
  return persistedWireTokens({ tokens, issuedAtMs });
}

const clock = { nowMs: () => Date.now() };
// Fixed-issuer provider definitions supply endpoints; the shared scheme gate
// still refuses plaintext except for explicitly allowed local authorization servers.
const guard = createOAuthUrlGuard({ assertAllowed: () => undefined }, { allowLoopbackHttp: true });
function clientFor(input: { clientId: string; clientSecret?: string }): OAuthClient {
  return input.clientSecret
    ? { clientId: input.clientId, clientSecret: input.clientSecret, authMethod: 'client_secret_basic' }
    : { clientId: input.clientId, authMethod: 'none' };
}
/** Persistence keeps the provider adapter's existing snake_case format; parsing is OAuth-owned. */
function persistedWireTokens({ tokens, issuedAtMs }: { tokens: OAuthTokenSet; issuedAtMs: number }): OAuthTokenResponse {
  return { access_token: tokens.accessToken, token_type: tokens.tokenType,
    ...(tokens.refreshToken === null ? {} : { refresh_token: tokens.refreshToken }),
    ...(tokens.expiresAt === null ? {} : { expires_in: Math.max(0, (Date.parse(tokens.expiresAt) - issuedAtMs) / 1000) }),
    ...(tokens.scopes.length === 0 ? {} : { scope: tokens.scopes.join(' ') }) };
}
/** In-memory pending authorization keyed by the OAuth state parameter. Bridges the
 * begin (mint state + verifier) and complete (browser returns code + state) halves.
 * Persistence is not needed because the caller completes auth in the same process,
 * and state is single-use. The host timer adapter retains unref and the synchronous
 * cache contract while delegating storage and expiry to the main OAuth factory.
 */
export class PendingAuthCache {
  private readonly cache: PendingAuthorizationCache<PendingAuthState>;
  constructor(_requiredArgs: Record<string, never> = {}, { ttlMs = 10 * 60 * 1000 }: { ttlMs?: number } = {}) {
    this.cache = createPendingAuthorizationStore<PendingAuthState>({ clock }, {
      ttlMs, expiry: ({ value, ttlMs }) => value.createdAt + ttlMs, exclusiveExpiry: true,
      scheduler: {
        every: ({ intervalMs, run }) => {
          const timer = setInterval(run, intervalMs);
          // Pending browser authorization must not keep an otherwise idle host process alive.
          timer.unref();
          return () => clearInterval(timer);
        },
      },
    });
  }
  put({ state, value }: { state: string; value: PendingAuthState }): void { this.cache.put({ state, value }); }
  /** One-shot consume removes state before returning so a callback replay cannot reuse it. */
  consume({ state }: { state: string }): PendingAuthState | null { return this.cache.consume({ state }); }
  size(): number { return this.cache.size({}); }
  /** Stops the background sweeper; its timer ownership belongs to the host scheduler. */
  stop(): void { this.cache.stop({}); }
}
