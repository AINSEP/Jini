/**
 * @module @jini-ai/mcp/core/oauth
 * Daemon-side OAuth 2.1 / PKCE client for remote (HTTP / SSE) MCP servers:
 * auth-server discovery, dynamic client registration, the authorize/token/refresh
 * exchanges, and the in-memory `PendingAuthCache`. Part of the MCP `core` kernel;
 * depends on no sibling subdirectory.
 */
// Daemon-side OAuth 2.1 client for HTTP / SSE MCP servers.
//
// Replaces the per-agent `mcp-remote` subprocess that bound a transient
// `localhost:<port>` listener — that pattern can never work for a cloud-
// deployed daemon (the user's browser can't reach the listener) and it
// also broke locally because the listener died with the agent turn.
//
// What this module owns:
//   - Discovery of the auth server for a given MCP URL
//     (RFC 9728 protected-resource → RFC 8414 authorization-server).
//   - Dynamic Client Registration (RFC 7591) when the server supports it,
//     cached per `(authServerUrl, redirectUri)` in `<dataDir>/mcp-oauth-clients.json`
//     so we register once and reuse forever.
//   - PKCE (RFC 7636) code-verifier / code-challenge generation.
//   - Authorization-code → token exchange and refresh-token rotation.
//   - In-memory state cache keyed by the `state` parameter, used to look
//     up the originating server + verifier when the browser hits our
//     callback endpoint.
//
// Token persistence lives in `tokens.ts`. This file is the protocol
// layer; storage is somebody else's job.

import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import type { LookupFunction } from 'node:net';
import path from 'node:path';
import { Agent } from 'undici';
import { assertSafePublicUrl, createValidatingLookup } from '@jini-ai/platform';
import { writeSecretFileAtomic } from './secure-write.js';

// ───────────────────────────────────────────────────────────────────────
// Types — narrow subsets of the relevant RFC payloads.
// ───────────────────────────────────────────────────────────────────────

/** RFC 9728 `oauth-protected-resource` document fields we use. */
export interface ProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
}

/** RFC 8414 / OIDC discovery document fields we use. */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
}

/** Cached client registration for a given auth server + redirect URI. */
export interface RegisteredClient {
  authServerIssuer: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  registeredAt: number;
}

/** RFC 6749 §5.1 token endpoint response (subset). */
export interface OAuthTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/** In-flight authorization request. Stashed in memory while the user
 * approves in their browser. */
export interface PendingAuthState {
  serverId: string;
  authServerIssuer: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  codeVerifier: string;
  scope?: string;
  resourceUrl?: string;
  createdAt: number;
}

// ───────────────────────────────────────────────────────────────────────
// Outbound-fetch safety (SEC-RB-001 / CR-005).
// ───────────────────────────────────────────────────────────────────────
//
// Every network hop below — protected-resource discovery, authorization-
// server discovery, dynamic client registration, and the token endpoint —
// fetches a URL that is ultimately caller- or metadata-controlled (a
// user-supplied MCP server URL, or an endpoint a remote server's own
// discovery document names). A hostile or compromised server can point any
// of these at an internal service, a cloud-metadata endpoint, or an
// attacker-controlled host that redirects or replies with an oversized /
// slow response. `safeOAuthFetch` is the single choke point all of that
// traffic goes through:
//   - HTTPS-only (no plaintext downgrade).
//   - `@jini-ai/platform`'s `assertSafePublicUrl` rejects embedded credentials,
//     localhost, and literal private/link-local IPs before any socket opens.
//   - A `createValidatingLookup`-wrapped dispatcher re-validates the
//     *actual* resolved address at connection time, closing the
//     DNS-rebinding / TOCTOU gap a one-time pre-check would leave open —
//     mirrors `packages/deploy/src/reachability.ts` and
//     `packages/platform/src/asset-cache.ts`, the two existing SSRF-safe
//     fetch call sites in this repo.
//   - Redirects are refused (`redirect: 'error'` plus an explicit
//     status/type check, so a test double that bypasses real fetch
//     semantics is still caught) rather than followed.
//   - Every response is read through a byte-capped reader and every
//     request carries an `AbortSignal`-based timeout.
const OAUTH_FETCH_TIMEOUT_MS = 10_000;
const OAUTH_FETCH_MAX_BYTES = 1_000_000; // 1 MB — generous for OAuth metadata/token JSON

// Not exported: only used to type the optional `lookupImpl` test seam
// threaded through this file's public functions (mirrors
// `packages/deploy/src/reachability.ts`'s `ReachabilityOptions.lookupImpl`).
type DnsLookupCb = Parameters<typeof createValidatingLookup>[0];

function assertSafeOAuthUrl(raw: string): URL {
  const url = assertSafePublicUrl(raw);
  if (url.protocol !== 'https:') {
    // OAuth authorization servers always serve discovery/DCR/token endpoints
    // over TLS; a plaintext candidate is never legitimate and downgrading a
    // request that may carry client secrets or tokens to http is its own risk.
    throw new Error(`OAuth endpoint must use https: ${raw}`);
  }
  return url;
}

// A fresh Agent per call would needlessly discard connection pooling; the
// common (no test override) case shares one lazily-created dispatcher. A
// caller-supplied `lookupImpl` (tests only) always gets its own dispatcher
// instead of touching the shared one — mirrors reachability.ts's own
// `resolveDispatcher`.
let defaultOAuthDispatcher: Agent | null = null;
function resolveOAuthDispatcher(lookupImpl?: DnsLookupCb): Agent {
  if (lookupImpl) {
    return new Agent({ connect: { lookup: createValidatingLookup(lookupImpl) as unknown as LookupFunction } });
  }
  defaultOAuthDispatcher ??= new Agent({ connect: { lookup: createValidatingLookup() as unknown as LookupFunction } });
  return defaultOAuthDispatcher;
}

function isRedirectResponse(res: Response): boolean {
  return (res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect';
}

/**
 * Read a response body up to `maxBytes`, aborting `controller` (when given)
 * and throwing the moment the cap is exceeded rather than buffering an
 * unbounded body first. Falls back to a single `res.text()` call (tolerant
 * of a throw, matching the old `safeText`'s forgiving error-path behavior)
 * for response-like test doubles that don't expose a real `ReadableStream`
 * body.
 *
 * `controller` is real, intentional API surface — a caller that already has
 * an in-flight fetch's `AbortController` can pass it so an oversized
 * response stops being pulled from upstream the moment the cap is exceeded,
 * not merely rejected after the fact — but no real call site in this file
 * currently has one in scope to pass (each of the four call sites reads a
 * `Response` it received after its own `safeOAuthFetch` call already
 * returned, by which point that call's own `AbortController` is out of
 * scope). Exported (not just internal) so this real, functioning behavior
 * is directly unit-testable without inventing an unused call site just to
 * reach it — matching this repo's established "extract into a directly-
 * testable pure function" convention.
 */
export async function readCappedText(
  res: Response,
  maxBytes: number,
  controller?: AbortController,
): Promise<string> {
  const body = (res as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body || typeof body.getReader !== 'function') {
    try {
      return await res.text();
    } catch {
      return '';
    }
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        controller?.abort(); // stop pulling more bytes from upstream
        throw new Error(`response body exceeds ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // reader already closed/errored — nothing to release
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Best-effort, size-capped extraction of an error response's body text for
 *  inclusion in a thrown error message. Never throws. */
async function safeErrorText(res: Response): Promise<string> {
  try {
    const text = await readCappedText(res, OAUTH_FETCH_MAX_BYTES);
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

interface SafeOAuthFetchInit {
  method?: 'GET' | 'POST';
  // Required, not optional: this is a private, file-internal type (never exported), and all three
  // real call sites always supply headers (at minimum an `accept`) — an optional field here was a
  // dead branch no real caller ever exercised.
  headers: Record<string, string>;
  body?: string;
}

/**
 * The single outbound-fetch choke point for this file. Validates the URL,
 * attaches the connection-time SSRF guard, refuses redirects, and enforces a
 * request timeout. Callers still own reading/bounding the response body via
 * `readCappedText`.
 */
async function safeOAuthFetch(
  rawUrl: string,
  init: SafeOAuthFetchInit,
  fetchImpl: typeof fetch,
  lookupImpl?: DnsLookupCb,
): Promise<Response> {
  const url = assertSafeOAuthUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OAUTH_FETCH_TIMEOUT_MS);
  try {
    const reqInit: RequestInit = {
      method: init.method ?? 'GET',
      headers: init.headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
      redirect: 'error',
      signal: controller.signal,
    };
    // `dispatcher` is an undici extension of RequestInit; attach it at
    // runtime (see asset-cache.ts / reachability.ts for the same pattern) to
    // avoid the undici-types (bundled with @types/node) vs undici@7
    // Dispatcher version skew a typed field would trip over.
    (reqInit as { dispatcher?: unknown }).dispatcher = resolveOAuthDispatcher(lookupImpl);
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), reqInit);
    } catch (err) {
      throw new Error(`request to ${url.origin} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (isRedirectResponse(res)) {
      // Never follow a redirect: the destination has not been validated,
      // and a hostile or rebound server could point it at an internal
      // address. `redirect: 'error'` already makes a *real* fetch reject
      // before returning a Response; this explicit check is defense in
      // depth for response-like test doubles that don't implement real
      // HTTP redirect semantics.
      throw new Error(`refusing to follow a redirect response from ${url.origin}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────────────────────────────────────────────────────
// PKCE + state helpers.
// ───────────────────────────────────────────────────────────────────────

const VERIFIER_LEN = 64; // RFC 7636 §4.1: 43–128 chars

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Generate a cryptographically random PKCE code verifier (RFC 7636 §4.1).
 * Produces a 64-byte base64url-encoded string, within the 43–128 character range.
 * @returns A fresh code verifier string for use in a single authorization request.
 */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(VERIFIER_LEN));
}

/**
 * Derive the S256 PKCE code challenge from a code verifier (RFC 7636 §4.2).
 * Computes `BASE64URL(SHA256(ASCII(verifier)))`.
 * @param verifier The code verifier string produced by `generateCodeVerifier`.
 * @returns The base64url-encoded SHA-256 hash to pass as `code_challenge`.
 */
export function deriveCodeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/**
 * Generate a cryptographically random OAuth `state` parameter.
 * Used as the CSRF token for the authorization request; must be unique per flow.
 * @returns A base64url-encoded 32-byte random string.
 */
export function generateState(): string {
  return base64url(randomBytes(32));
}

// ───────────────────────────────────────────────────────────────────────
// Discovery.
// ───────────────────────────────────────────────────────────────────────

/**
 * Try to fetch the protected-resource metadata for a given MCP URL.
 *
 * Per RFC 9728, the well-known is at the resource origin's
 * `/.well-known/oauth-protected-resource[<path>]`. We try both the
 * path-suffixed form and the bare `/.well-known/...` so servers that
 * only publish at the root still work.
 *
 * @param lookupImpl Injectable `dns.lookup` for the connection-time SSRF
 *   guard (tests only — see `safeOAuthFetch`).
 */
export async function discoverProtectedResource(
  resourceUrl: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: DnsLookupCb,
): Promise<ProtectedResourceMetadata | null> {
  let parsed: URL;
  try {
    parsed = new URL(resourceUrl);
  } catch {
    return null;
  }
  const candidates = [
    new URL(
      `/.well-known/oauth-protected-resource${parsed.pathname.replace(/\/+$/u, '')}`,
      `${parsed.protocol}//${parsed.host}`,
    ).toString(),
    new URL('/.well-known/oauth-protected-resource', `${parsed.protocol}//${parsed.host}`).toString(),
  ];
  for (const url of candidates) {
    const json = await fetchJson<ProtectedResourceMetadata>(url, fetchImpl, lookupImpl);
    if (json) return json;
  }
  return null;
}

/**
 * Fetch the authorization-server metadata for an issuer URL. Tries both
 * the OAuth (RFC 8414) and OIDC layouts (`/.well-known/oauth-authorization-server`
 * and `/.well-known/openid-configuration`); some providers only publish one.
 *
 * Per RFC 8414 §3.3, a discovery document's `issuer` — when present — MUST
 * match the issuer used to construct the request; a mismatched document is
 * rejected rather than trusted (SEC-RB-001 / CR-005). Every endpoint the
 * document names (`authorization_endpoint`, `token_endpoint`,
 * `registration_endpoint`) is additionally required to be an absolute
 * `https:` URL sharing the queried issuer's own origin, so a compromised or
 * hostile document can't redirect DCR or token exchange at an unrelated
 * origin.
 *
 * @param lookupImpl Injectable `dns.lookup` for the connection-time SSRF
 *   guard (tests only — see `safeOAuthFetch`).
 */
export async function discoverAuthServer(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: DnsLookupCb,
): Promise<AuthorizationServerMetadata | null> {
  let parsedIssuer: URL;
  try {
    parsedIssuer = new URL(issuer);
  } catch {
    return null;
  }
  const trimmed = parsedIssuer.pathname.replace(/\/+$/u, '');
  const base = `${parsedIssuer.protocol}//${parsedIssuer.host}`;
  const candidates = [
    `${base}/.well-known/oauth-authorization-server${trimmed}`,
    `${base}/.well-known/openid-configuration${trimmed}`,
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
  ];
  for (const url of candidates) {
    const json = await fetchJson<AuthorizationServerMetadata>(url, fetchImpl, lookupImpl);
    if (json && typeof json.authorization_endpoint === 'string' && typeof json.token_endpoint === 'string') {
      if (typeof json.issuer === 'string' && json.issuer !== issuer) continue; // RFC 8414 §3.3 issuer mismatch
      if (!endpointsShareIssuerOrigin(parsedIssuer, json)) continue;
      // Spread first so the explicit issuer wins (otherwise duplicate-key
      // assignments under exactOptionalPropertyTypes complain).
      return { ...json, issuer: json.issuer ?? issuer };
    }
  }
  return null;
}

function endpointsShareIssuerOrigin(issuerUrl: URL, meta: AuthorizationServerMetadata): boolean {
  const endpoints = [meta.authorization_endpoint, meta.token_endpoint, meta.registration_endpoint].filter(
    (v): v is string => typeof v === 'string',
  );
  for (const endpoint of endpoints) {
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:' || parsed.origin !== issuerUrl.origin) return false;
  }
  return true;
}

async function fetchJson<T>(
  url: string,
  fetchImpl: typeof fetch,
  lookupImpl?: DnsLookupCb,
): Promise<T | null> {
  try {
    const res = await safeOAuthFetch(url, { headers: { accept: 'application/json' } }, fetchImpl, lookupImpl);
    if (!res.ok) return null;
    const text = await readCappedText(res, OAUTH_FETCH_MAX_BYTES);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────
// Dynamic Client Registration (RFC 7591) + cache.
// ───────────────────────────────────────────────────────────────────────

interface ClientCacheFile {
  clients: RegisteredClient[];
}

function clientsFile(dataDir: string): string {
  return path.join(dataDir, 'mcp-oauth-clients.json');
}

async function readClientCache(dataDir: string): Promise<ClientCacheFile> {
  try {
    const raw = await readFile(clientsFile(dataDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.clients)) return { clients: [] };
    return { clients: parsed.clients.filter(isRegisteredClient) };
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'ENOENT') return { clients: [] };
    throw err;
  }
}

function isRegisteredClient(v: unknown): v is RegisteredClient {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.authServerIssuer === 'string' &&
    typeof r.redirectUri === 'string' &&
    typeof r.clientId === 'string'
  );
}

/**
 * Persist the client cache to `<dataDir>/mcp-oauth-clients.json`. May
 * contain a confidential client's `clientSecret` (CR-006 / SEC-RB-002), so
 * the file is created with owner-only (0600) permissions from the very
 * first byte via `writeSecretFileAtomic` rather than a post-rename chmod —
 * see that module for why.
 */
async function writeClientCache(
  dataDir: string,
  next: ClientCacheFile,
): Promise<void> {
  await writeSecretFileAtomic(clientsFile(dataDir), JSON.stringify(next, null, 2));
}

/**
 * POST to the auth server's `registration_endpoint` per RFC 7591. Returns
 * a freshly issued client_id (and optional client_secret). Caller is
 * responsible for caching the result.
 * @param lookupImpl Injectable `dns.lookup` for the connection-time SSRF
 *   guard (tests only — see `safeOAuthFetch`).
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: DnsLookupCb,
): Promise<{ clientId: string; clientSecret?: string }> {
  const body = {
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_name: 'Jini',
    application_type: 'web',
  };
  const res = await safeOAuthFetch(
    registrationEndpoint,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    },
    fetchImpl,
    lookupImpl,
  );
  if (!res.ok) {
    const txt = await safeErrorText(res);
    throw new Error(
      `dynamic client registration failed: HTTP ${res.status} ${res.statusText} ${txt}`,
    );
  }
  const json = JSON.parse(await readCappedText(res, OAUTH_FETCH_MAX_BYTES)) as {
    client_id?: string;
    client_secret?: string;
  };
  if (!json.client_id) {
    throw new Error('dynamic client registration response missing client_id');
  }
  const out: { clientId: string; clientSecret?: string } = { clientId: json.client_id };
  if (json.client_secret) out.clientSecret = json.client_secret;
  return out;
}

/**
 * Cached version of `registerClient`. Looks up `(authServerIssuer, redirectUri)`
 * in the cache file and re-uses the existing client; falls back to a fresh
 * DCR call when nothing is cached.
 * @param lookupImpl Injectable `dns.lookup` for the connection-time SSRF
 *   guard (tests only — see `safeOAuthFetch`).
 */
export async function getOrRegisterClient(
  dataDir: string,
  authServer: AuthorizationServerMetadata,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: DnsLookupCb,
): Promise<RegisteredClient> {
  const cache = await readClientCache(dataDir);
  const cached = cache.clients.find(
    (c) => c.authServerIssuer === authServer.issuer && c.redirectUri === redirectUri,
  );
  if (cached) return cached;
  if (!authServer.registration_endpoint) {
    throw new Error(
      `auth server ${authServer.issuer} does not advertise a registration_endpoint and no client is pre-registered`,
    );
  }
  const reg = await registerClient(
    authServer.registration_endpoint,
    redirectUri,
    fetchImpl,
    lookupImpl,
  );
  const next: RegisteredClient = {
    authServerIssuer: authServer.issuer,
    redirectUri,
    clientId: reg.clientId,
    registeredAt: Date.now(),
  };
  if (reg.clientSecret) next.clientSecret = reg.clientSecret;
  cache.clients.push(next);
  await writeClientCache(dataDir, cache);
  return next;
}

// ───────────────────────────────────────────────────────────────────────
// Authorization URL builder.
// ───────────────────────────────────────────────────────────────────────

/** Inputs required to assemble the authorization redirect URL. */
export interface AuthorizeUrlInput {
  authServer: AuthorizationServerMetadata;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
  /** RFC 8707 resource indicator — narrows the issued token to the target MCP server. */
  resource?: string;
}

/**
 * Assemble the authorization endpoint URL the user's browser must be directed to.
 * Sets PKCE parameters (`code_challenge`, `code_challenge_method=S256`), the `state`
 * CSRF token, and optionally the RFC 8707 `resource` indicator.
 * @param input All parameters needed to build the URL.
 * @returns The fully-qualified authorization URL as a string.
 */
export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const u = new URL(input.authServer.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', input.clientId);
  u.searchParams.set('redirect_uri', input.redirectUri);
  u.searchParams.set('state', input.state);
  u.searchParams.set('code_challenge', input.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (input.scope) u.searchParams.set('scope', input.scope);
  // RFC 8707 resource indicator — narrows the issued token to the MCP
  // resource we actually care about. Most authoritative MCP servers
  // require it; harmless when ignored.
  if (input.resource) u.searchParams.set('resource', input.resource);
  return u.toString();
}

// ───────────────────────────────────────────────────────────────────────
// Token endpoint: code exchange + refresh.
// ───────────────────────────────────────────────────────────────────────

/** Inputs for the authorization-code → token exchange (RFC 6749 §4.1.3). */
export interface ExchangeCodeInput {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  /** RFC 8707 resource indicator to include in the token request. */
  resource?: string;
}

/**
 * Exchange an authorization code for access and refresh tokens (RFC 6749 §4.1.3).
 * Includes the PKCE `code_verifier` and, when supplied, the RFC 8707 `resource`
 * indicator. Throws when the token endpoint returns a non-2xx status.
 * @param input The code-exchange parameters.
 * @param fetchImpl Injectable fetch, defaults to the global `fetch`.
 * @param lookupImpl Injectable `dns.lookup` for the connection-time SSRF
 *   guard (tests only — see `safeOAuthFetch`).
 * @returns The token endpoint response containing at least an `access_token`.
 */
export async function exchangeCodeForToken(
  input: ExchangeCodeInput,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: DnsLookupCb,
): Promise<OAuthTokenResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', input.code);
  form.set('redirect_uri', input.redirectUri);
  form.set('client_id', input.clientId);
  form.set('code_verifier', input.codeVerifier);
  if (input.resource) form.set('resource', input.resource);
  return tokenRequest(input.tokenEndpoint, form, input.clientSecret, fetchImpl, lookupImpl);
}

/** Inputs for the refresh-token → new-access-token exchange (RFC 6749 §6). */
export interface RefreshTokenInput {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  scope?: string;
  /** RFC 8707 resource indicator, included when the original token was resource-scoped. */
  resource?: string;
}

/**
 * Exchange a refresh token for a new access token (RFC 6749 §6).
 * Preserves scope and resource binding from the original authorization.
 * Throws when the token endpoint returns a non-2xx status.
 * @param input The refresh parameters.
 * @param fetchImpl Injectable fetch, defaults to the global `fetch`.
 * @param lookupImpl Injectable `dns.lookup` for the connection-time SSRF
 *   guard (tests only — see `safeOAuthFetch`).
 * @returns A fresh `OAuthTokenResponse`; the server may issue a new refresh token.
 */
export async function refreshAccessToken(
  input: RefreshTokenInput,
  fetchImpl: typeof fetch = fetch,
  lookupImpl?: DnsLookupCb,
): Promise<OAuthTokenResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', input.refreshToken);
  form.set('client_id', input.clientId);
  if (input.scope) form.set('scope', input.scope);
  if (input.resource) form.set('resource', input.resource);
  return tokenRequest(input.tokenEndpoint, form, input.clientSecret, fetchImpl, lookupImpl);
}

async function tokenRequest(
  tokenEndpoint: string,
  form: URLSearchParams,
  clientSecret: string | undefined,
  fetchImpl: typeof fetch,
  lookupImpl?: DnsLookupCb,
): Promise<OAuthTokenResponse> {
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (clientSecret) {
    // RFC 6749 §2.3.1 — confidential clients use HTTP Basic with the
    // client_id we already put in the form. Public clients (PKCE-only)
    // skip this branch.
    const basic = Buffer.from(`${form.get('client_id')}:${clientSecret}`).toString('base64');
    headers['authorization'] = `Basic ${basic}`;
  }
  const res = await safeOAuthFetch(
    tokenEndpoint,
    { method: 'POST', headers, body: form.toString() },
    fetchImpl,
    lookupImpl,
  );
  if (!res.ok) {
    const txt = await safeErrorText(res);
    throw new Error(
      `token endpoint rejected request: HTTP ${res.status} ${res.statusText} ${txt}`,
    );
  }
  const json = JSON.parse(await readCappedText(res, OAUTH_FETCH_MAX_BYTES)) as OAuthTokenResponse;
  if (!json.access_token) {
    throw new Error('token endpoint response missing access_token');
  }
  return json;
}

// ───────────────────────────────────────────────────────────────────────
// In-memory pending-state cache.
// ───────────────────────────────────────────────────────────────────────

/**
 * The OAuth dance is split across two HTTP requests on our side:
 *   1. the "start" request                 — we mint state + verifier
 *   2. the "callback" request              — browser returns code + state
 * State has to survive between (1) and (2) on the daemon. We keep it in a
 * Map with a TTL sweeper; persistence isn't needed because the user has
 * to complete auth in the same daemon process anyway (state is single-use).
 */
export class PendingAuthCache {
  private store = new Map<string, PendingAuthState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ttlMs: number = 10 * 60 * 1000) {}

  /**
   * Store a pending auth state keyed by the OAuth `state` parameter.
   * Starts the TTL sweeper if it is not already running.
   * @param state The random `state` string from the authorization request.
   * @param value The associated pending auth metadata to stash.
   */
  put(state: string, value: PendingAuthState): void {
    this.store.set(state, value);
    this.startSweeper();
  }

  /** One-shot consume — any successful callback removes the state so a
   * replay can't reuse it. */
  consume(state: string): PendingAuthState | null {
    const v = this.store.get(state);
    if (!v) return null;
    this.store.delete(state);
    if (Date.now() - v.createdAt > this.ttlMs) return null;
    return v;
  }

  /** Return the number of pending auth states currently held in the cache. */
  size(): number {
    return this.store.size;
  }

  /** Stop the background sweeper. Used by tests; production lets the
   * timer ride on the process lifetime. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startSweeper(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), Math.min(this.ttlMs, 60_000));
    // unref so the cache doesn't keep the event loop alive in tests
    this.timer.unref();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (now - v.createdAt > this.ttlMs) this.store.delete(k);
    }
    if (this.store.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// ───────────────────────────────────────────────────────────────────────
// Top-level "begin auth" helper.
// ───────────────────────────────────────────────────────────────────────

/** Inputs for the full pre-redirect OAuth dance. */
export interface BeginAuthInput {
  /** The `McpServerConfig.id` of the server being authorized. */
  serverId: string;
  /** The MCP server endpoint URL (used for protected-resource discovery). */
  serverUrl: string;
  /** The OAuth redirect URI the daemon has registered. */
  redirectUri: string;
  /** The resolved data directory (for caching the client registration). */
  dataDir: string;
  scope?: string;
  /** Injectable fetch implementation; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable `dns.lookup` for the connection-time SSRF guard (tests only). */
  lookupImpl?: DnsLookupCb;
}

/** Result of `beginAuth`: everything needed to redirect the browser and later complete the flow. */
export interface BeginAuthResult {
  /** The fully-qualified authorization URL to redirect the user's browser to. */
  authorizeUrl: string;
  /** The random `state` string; must be passed to `PendingAuthCache.put` before redirecting. */
  state: string;
  /** The pending-auth metadata to store in `PendingAuthCache` keyed by `state`. */
  pending: PendingAuthState;
}

/**
 * Run the entire pre-redirect half of the OAuth dance:
 *   discovery → DCR (cached) → PKCE → authorize URL.
 *
 * Returns everything the caller needs to (a) push the user's browser at the
 * correct authorize URL, and (b) finish the flow when the callback hits.
 */
export async function beginAuth(
  input: BeginAuthInput,
): Promise<BeginAuthResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const lookupImpl = input.lookupImpl;

  // Step 1: ask the MCP server who its auth server is. If the server
  // doesn't publish protected-resource metadata, fall back to assuming
  // the resource origin IS the auth server — most "stand-alone" MCP
  // providers host both at the same host.
  const prm = await discoverProtectedResource(input.serverUrl, fetchImpl, lookupImpl);
  const issuerHint = prm?.authorization_servers?.[0];
  const issuer = issuerHint ?? new URL(input.serverUrl).origin;

  // Step 2: discovery on the auth server.
  const authServer = await discoverAuthServer(issuer, fetchImpl, lookupImpl);
  if (!authServer) {
    throw new Error(`could not discover OAuth metadata for ${issuer}`);
  }

  // Step 3: ensure we have a registered client_id (DCR if missing).
  const client = await getOrRegisterClient(
    input.dataDir,
    authServer,
    input.redirectUri,
    fetchImpl,
    lookupImpl,
  );

  // Step 4: PKCE + state.
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);
  const state = generateState();

  const scope =
    input.scope ??
    (Array.isArray(prm?.scopes_supported) && prm!.scopes_supported!.length > 0
      ? prm!.scopes_supported!.join(' ')
      : authServer.scopes_supported?.join(' '));

  const resource = prm?.resource ?? input.serverUrl;
  const authUrlInput: AuthorizeUrlInput = {
    authServer,
    clientId: client.clientId,
    redirectUri: input.redirectUri,
    state,
    codeChallenge,
    resource,
  };
  if (scope) authUrlInput.scope = scope;
  const authorizeUrl = buildAuthorizeUrl(authUrlInput);

  const pending: PendingAuthState = {
    serverId: input.serverId,
    authServerIssuer: authServer.issuer,
    tokenEndpoint: authServer.token_endpoint,
    clientId: client.clientId,
    redirectUri: input.redirectUri,
    codeVerifier,
    resourceUrl: resource,
    createdAt: Date.now(),
  };
  if (client.clientSecret) pending.clientSecret = client.clientSecret;
  if (scope) pending.scope = scope;

  return { authorizeUrl, state, pending };
}
