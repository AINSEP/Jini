/**
 * @file A minimal fake OAuth provider ("acme") on 127.0.0.1 for API-connection tests.
 *
 * Exists so tests drive the real HTTP token exchange, PKCE verification, identity read,
 * refresh and revocation without any third-party network call. Tokens are opaque counters.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

interface IssuedCode { challenge: string; redirectUri: string; account: string; scopes: string[]; omitRefreshToken: boolean }
interface Grant { account: string; scopes: string[] }

export interface AcmeProvider {
  readonly origin: string;
  /** Simulate the browser consent screen for an authorization URL; returns callback params. */
  approve(args: { authorizationUrl: string; account: string; grantScopes?: string[]; omitRefreshToken?: boolean }): Record<string, string>;
  readonly revoked: string[];
  readonly tokenRequests: URLSearchParams[];
  failRevocation: boolean;
  /** When set, a code exchange whose client_secret differs is refused with `invalid_client`. */
  expectedClientSecret: string | null;
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export async function startAcmeProvider(): Promise<AcmeProvider> {
  const codes = new Map<string, IssuedCode>();
  const accessTokens = new Map<string, Grant>();
  const refreshTokens = new Map<string, Grant>();
  let counter = 0;
  const issue = (grant: Grant, withRefresh: boolean) => {
    counter += 1;
    accessTokens.set(`acme-at-${counter}`, grant);
    if (withRefresh) refreshTokens.set(`acme-rt-${counter}`, grant);
    return { access_token: `acme-at-${counter}`, token_type: 'Bearer', expires_in: 3600, scope: grant.scopes.join(' '),
      ...(withRefresh ? { refresh_token: `acme-rt-${counter}` } : {}) };
  };
  const provider: AcmeProvider = {
    origin: '', revoked: [], tokenRequests: [], failRevocation: false, expectedClientSecret: null,
    approve({ authorizationUrl, account, grantScopes, omitRefreshToken = false }) {
      const param = (name: string) => new URL(authorizationUrl).searchParams.get(name) ?? '';
      const code = `acme-code-${codes.size + 1}`;
      codes.set(code, { challenge: param('code_challenge'), redirectUri: param('redirect_uri'),
        account, scopes: grantScopes ?? param('scope').split(' '), omitRefreshToken });
      return { state: param('state'), code };
    },
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
  const refresh = (form: URLSearchParams, response: ServerResponse) => {
    const grant = refreshTokens.get(form.get('refresh_token') ?? '');
    return grant ? send(response, 200, issue(grant, false)) : send(response, 400, { error: 'invalid_grant' });
  };
  const token = (form: URLSearchParams, response: ServerResponse) => {
    provider.tokenRequests.push(form);
    if (form.get('grant_type') === 'refresh_token') return refresh(form, response);
    if (provider.expectedClientSecret !== null && form.get('client_secret') !== provider.expectedClientSecret) {
      return send(response, 401, { error: 'invalid_client' });
    }
    const code = form.get('code') ?? '';
    const issued = codes.get(code);
    codes.delete(code);
    const verifier = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
    if (!issued || issued.challenge !== verifier || issued.redirectUri !== form.get('redirect_uri')) {
      return send(response, 400, { error: 'invalid_grant' });
    }
    return send(response, 200, issue({ account: issued.account, scopes: issued.scopes }, !issued.omitRefreshToken));
  };
  const server: Server = createServer(async (request, response) => {
    const body = await readBody(request);
    if (request.url === '/token') return token(new URLSearchParams(body), response);
    if (request.url === '/userinfo') {
      const grant = accessTokens.get((request.headers.authorization ?? '').replace(/^Bearer /, ''));
      return grant ? send(response, 200, { id: grant.account, name: `${grant.account} at acme` }) : send(response, 401, {});
    }
    if (request.url === '/revoke' && !provider.failRevocation) {
      const revokedToken = new URLSearchParams(body).get('token') ?? '';
      provider.revoked.push(revokedToken);
      refreshTokens.delete(revokedToken);
      return send(response, 200, {});
    }
    return send(response, 503, {});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  (provider as { origin: string }).origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return provider;
}
