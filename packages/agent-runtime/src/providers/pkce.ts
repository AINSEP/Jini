/**
 * @module providers/pkce
 *
 * Generic OAuth 2.0 Authorization Code + PKCE (RFC 7636) client primitives —
 * verifier/challenge/state generation, authorize-URL building, and the
 * code-exchange/refresh token-endpoint calls.
 *
 * Vendored from the minimal subset of OD's `apps/daemon/src/mcp-oauth.ts`
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
 * strings in the vendored subset — ported verbatim apart from doc-comment
 * wording.
 */
import { createHash, randomBytes } from 'node:crypto';

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

const VERIFIER_LEN = 64; // RFC 7636 §4.1: 43-128 chars

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function generateCodeVerifier(): string {
  return base64url(randomBytes(VERIFIER_LEN));
}

export function deriveCodeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function generateState(): string {
  return base64url(randomBytes(32));
}

export interface AuthorizeUrlInput {
  authServer: AuthorizationServerMetadata;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
  resource?: string;
}

export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const u = new URL(input.authServer.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', input.clientId);
  u.searchParams.set('redirect_uri', input.redirectUri);
  u.searchParams.set('state', input.state);
  u.searchParams.set('code_challenge', input.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (input.scope) u.searchParams.set('scope', input.scope);
  // RFC 8707 resource indicator — narrows the issued token to the resource
  // actually being requested. Most authoritative servers require it;
  // harmless when ignored.
  if (input.resource) u.searchParams.set('resource', input.resource);
  return u.toString();
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

export async function exchangeCodeForToken(
  input: ExchangeCodeInput,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokenResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', input.code);
  form.set('redirect_uri', input.redirectUri);
  form.set('client_id', input.clientId);
  form.set('code_verifier', input.codeVerifier);
  if (input.resource) form.set('resource', input.resource);
  return tokenRequest(input.tokenEndpoint, form, input.clientSecret, fetchImpl);
}

export interface RefreshTokenInput {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  scope?: string;
  resource?: string;
}

export async function refreshAccessToken(
  input: RefreshTokenInput,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokenResponse> {
  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', input.refreshToken);
  form.set('client_id', input.clientId);
  if (input.scope) form.set('scope', input.scope);
  if (input.resource) form.set('resource', input.resource);
  return tokenRequest(input.tokenEndpoint, form, input.clientSecret, fetchImpl);
}

async function tokenRequest(
  tokenEndpoint: string,
  form: URLSearchParams,
  clientSecret: string | undefined,
  fetchImpl: typeof fetch,
): Promise<OAuthTokenResponse> {
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (clientSecret) {
    // RFC 6749 §2.3.1 — confidential clients use HTTP Basic with the
    // client_id already in the form. Public clients (PKCE-only) skip this.
    const basic = Buffer.from(`${form.get('client_id')}:${clientSecret}`).toString('base64');
    headers['authorization'] = `Basic ${basic}`;
  }
  const res = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers,
    body: form.toString(),
  });
  if (!res.ok) {
    const txt = await safeText(res);
    throw new Error(
      `token endpoint rejected request: HTTP ${res.status} ${res.statusText} ${txt}`,
    );
  }
  const json = (await res.json()) as OAuthTokenResponse;
  if (!json.access_token) {
    throw new Error('token endpoint response missing access_token');
  }
  return json;
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * In-memory pending-authorization cache keyed by the OAuth `state`
 * parameter. Bridges the "begin" (mint state + verifier) and "complete"
 * (browser returns code + state) halves of the dance; persistence isn't
 * needed because the caller completes auth in the same process, and state
 * is single-use.
 */
export class PendingAuthCache {
  private store = new Map<string, PendingAuthState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ttlMs: number = 10 * 60 * 1000) {}

  put(state: string, value: PendingAuthState): void {
    this.store.set(state, value);
    this.startSweeper();
  }

  /** One-shot consume — any successful callback removes the state so a replay can't reuse it. */
  consume(state: string): PendingAuthState | null {
    const v = this.store.get(state);
    if (!v) return null;
    this.store.delete(state);
    if (Date.now() - v.createdAt > this.ttlMs) return null;
    return v;
  }

  size(): number {
    return this.store.size;
  }

  /** Stops the background sweeper. Production lets the timer ride on the host process lifetime. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startSweeper(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), Math.min(this.ttlMs, 60_000));
    // unref so the cache doesn't keep the event loop alive in tests.
    if (typeof this.timer === 'object' && this.timer && typeof (this.timer as { unref?: () => void }).unref === 'function') {
      (this.timer as { unref: () => void }).unref();
    }
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
