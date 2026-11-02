/**
 * @file A local fake of the Google endpoints the Google Workspace plugin calls: OAuth consent (as a
 * function standing in for the browser), token exchange and refresh, revocation, Drive `about`, plus
 * `route()` so Sheets and Drive tests add the resources they need. It listens on 127.0.0.1 on an
 * ephemeral port; close it in `after`.
 *
 * `fake.fetch` is the only transport plugin tests may inject: it rewrites the four Google origins
 * the plugin uses onto the local server (so the plugin's real URLs are what is asserted) and THROWS
 * for every other host, so no test can reach Google or any third party. Tokens are minted at
 * runtime with non-Google shapes; nothing here is secret-shaped.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export const GOOGLE_HOSTS = Object.freeze(['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'sheets.googleapis.com']);

/** Accounts the fake knows; `permissionId` is what the plugin uses as the stable account id. */
export const FAKE_ACCOUNTS = Object.freeze({
  alice: { permissionId: 'perm-alice', emailAddress: 'alice@example.test', displayName: 'Alice' },
  bob: { permissionId: 'perm-bob', emailAddress: 'bob@example.test', displayName: 'Bob' },
});

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(value === undefined ? '' : JSON.stringify(value));
}

const s256 = (verifier) => createHash('sha256').update(verifier).digest('base64url');

/**
 * Starts the fake.
 * @param {{ clients: Record<string, { secret?: string }> }} required Client ids the token endpoint
 *   accepts; a client with `secret` must send it (`client_secret_post`).
 */
export async function startFakeGoogle(required) {
  const codes = new Map();
  const refreshTokens = new Map();
  const accessTokens = new Map();
  /** account + client → scopes granted so far, for `include_granted_scopes`. */
  const grants = new Map();
  const routes = new Map();
  /** `[method, path prefix, handler]`, for resources whose path carries a variable (Sheets ranges). */
  const prefixRoutes = [];
  const requests = [];
  let minted = 0;
  const behaviour = { rotateRefreshTokens: false, refreshError: undefined, revokeStatus: 200, revokeBody: {} };
  const mint = (kind) => `fake-${kind}-${(minted += 1)}-${randomBytes(6).toString('hex')}`;

  function issueAccessToken(account) {
    const token = mint('access');
    accessTokens.set(token, { account });
    return token;
  }

  function exchangeCode(form) {
    const entry = codes.get(form.get('code'));
    codes.delete(form.get('code'));
    if (!entry || entry.clientId !== form.get('client_id') || entry.redirectUri !== form.get('redirect_uri') || entry.challenge !== s256(form.get('code_verifier') ?? '')) {
      return [400, { error: 'invalid_grant', error_description: 'Bad Request' }];
    }
    const response = { access_token: issueAccessToken(entry.account), expires_in: 3599, token_type: 'Bearer', scope: entry.scopes.join(' ') };
    if (entry.omitRefreshToken) return [200, response];
    const refreshToken = mint('refresh');
    refreshTokens.set(refreshToken, { account: entry.account, clientId: entry.clientId, scopes: entry.scopes });
    return [200, { ...response, refresh_token: refreshToken }];
  }

  function refresh(form) {
    const entry = refreshTokens.get(form.get('refresh_token'));
    if (behaviour.refreshError || !entry || entry.clientId !== form.get('client_id')) {
      return [400, { error: behaviour.refreshError ?? 'invalid_grant', error_description: 'Token has been expired or revoked.' }];
    }
    const response = { access_token: issueAccessToken(entry.account), expires_in: 3599, token_type: 'Bearer', scope: entry.scopes.join(' ') };
    if (!behaviour.rotateRefreshTokens) return [200, response];
    refreshTokens.delete(form.get('refresh_token'));
    const rotated = mint('refresh');
    refreshTokens.set(rotated, entry);
    return [200, { ...response, refresh_token: rotated }];
  }

  function token(form) {
    const client = required.clients[form.get('client_id') ?? ''];
    if (!client || (client.secret !== undefined && form.get('client_secret') !== client.secret)) return [401, { error: 'invalid_client' }];
    if (form.get('grant_type') === 'authorization_code') return exchangeCode(form);
    if (form.get('grant_type') === 'refresh_token') return refresh(form);
    return [400, { error: 'unsupported_grant_type' }];
  }

  const builtIn = {
    'POST /token': (_req, body) => token(new URLSearchParams(body)),
    'POST /revoke': (_req, body) => {
      if (behaviour.revokeStatus === 200) refreshTokens.delete(new URLSearchParams(body).get('token') ?? '');
      return [behaviour.revokeStatus, behaviour.revokeBody];
    },
    'GET /drive/v3/about': (req) => {
      const holder = accessTokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      return holder ? [200, { user: FAKE_ACCOUNTS[holder.account] }] : [401, { error: { code: 401, status: 'UNAUTHENTICATED' } }];
    },
  };

  /** The scopes this consent grants, plus earlier ones when the request asks for incremental grants. */
  function grantFor({ url, grantKey, grantScopes }) {
    const requested = grantScopes ?? (url.searchParams.get('scope') ?? '').split(' ').filter(Boolean);
    const earlier = url.searchParams.get('include_granted_scopes') === 'true' ? grants.get(grantKey) ?? [] : [];
    const scopes = [...new Set([...earlier, ...requested])];
    grants.set(grantKey, scopes);
    return scopes;
  }

  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const routeKey = `${req.method} ${url.pathname}`;
    requests.push({ method: req.method, host: req.headers['x-fake-google-host'], path: url.pathname, query: url.searchParams, headers: req.headers, body });
    const handler = routes.get(routeKey) ?? prefixRoutes.find(([method, prefix]) => method === req.method && url.pathname.startsWith(prefix))?.[2] ?? builtIn[routeKey];
    if (!handler) return sendJson(res, 404, { error: { code: 404, status: 'NOT_FOUND' } });
    const [status, value, headers] = await handler(req, body, url);
    return sendJson(res, status, value, headers);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  return {
    origin,
    requests,
    behaviour,
    /** Test-only transport: Google origins → this server; any other host throws. */
    async fetch({ url }, init = {}) {
      const target = new URL(String(url));
      if (target.protocol !== 'https:' || !GOOGLE_HOSTS.includes(target.hostname)) throw new Error(`test transport refused ${target.protocol}//${target.hostname}`);
      return fetch(`${origin}${target.pathname}${target.search}`, { ...init, headers: { ...init.headers, 'x-fake-google-host': target.hostname } });
    },
    /** Adds or replaces a resource handler: `(req, body, url) => [status, json, headers?]`. */
    route({ method, path }, handler) { routes.set(`${method} ${path}`, handler); },
    /** Adds a handler for every path under `prefix` (exact routes win). */
    routePrefix({ method, prefix }, handler) { prefixRoutes.push([method, prefix, handler]); },
    /**
     * The browser at Google's consent screen. Returns the callback query the redirect carries.
     * `grantScopes` lets a test untick a permission; `deny` cancels consent.
     */
    consent({ authorizationUrl, account = 'alice', grantScopes, deny = false, omitRefreshToken = false }) {
      const url = new URL(authorizationUrl);
      const state = url.searchParams.get('state') ?? '';
      if (deny) return { error: 'access_denied', state };
      const clientId = url.searchParams.get('client_id');
      const scopes = grantFor({ url, grantKey: `${account}\u0000${clientId}`, grantScopes });
      const code = mint('code');
      codes.set(code, { account, clientId, scopes, omitRefreshToken, redirectUri: url.searchParams.get('redirect_uri'), challenge: url.searchParams.get('code_challenge') });
      return { code, state, scope: scopes.join(' ') };
    },
    /** Forget every code, token, grant and added route; restore default behaviour. */
    reset() {
      for (const map of [codes, refreshTokens, accessTokens, grants, routes]) map.clear();
      prefixRoutes.length = 0;
      requests.length = 0;
      Object.assign(behaviour, { rotateRefreshTokens: false, refreshError: undefined, revokeStatus: 200, revokeBody: {} });
    },
    /** Refresh tokens Google still honours (revocation removes them). */
    liveRefreshTokens() { return [...refreshTokens.keys()]; },
    close() { return new Promise((resolve) => server.close(resolve)); },
  };
}
