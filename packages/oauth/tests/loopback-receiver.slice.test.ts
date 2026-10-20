/**
 * @file Vertical-slice proof for the installed-app grant: start the loopback receiver, begin an
 * S256 authorization with its redirect URI, play the browser returning to 127.0.0.1 with a code
 * and a declared callback field, then exchange the code at a local fake token endpoint. Proves
 * the receiver composes with the existing engine end to end; no remote host is contacted.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { beginAuthorizationCode, completeAuthorizationCode, createOAuthUrlGuard, type OAuthProviderDescriptor } from '../src/index.js';
import { startLoopbackAuthorizationReceiver } from '../src/loopback-receiver.js';
import { createPendingAuthorizationStore } from '../src/testing/index.js';
import { createTestClock } from './helpers.js';

const servers: Server[] = [];
const controllers: AbortController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.abort();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

/** Local stand-in for a provider token endpoint; records the form it received. */
async function startFakeTokenEndpoint(): Promise<{ url: string; forms: URLSearchParams[] }> {
  const forms: URLSearchParams[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      forms.push(new URLSearchParams(body));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'issued-access', token_type: 'Bearer', expires_in: 3600 }));
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/token`, forms };
}

test('loopback receiver + PKCE authorization code grant completes against a local fake provider', async () => {
  const tokenEndpoint = await startFakeTokenEndpoint();
  const controller = new AbortController();
  controllers.push(controller);
  const receiver = await startLoopbackAuthorizationReceiver({}, { callbackFields: ['picked_ids'], signal: controller.signal });

  const provider: OAuthProviderDescriptor = {
    providerId: 'acme-office', label: 'Acme Office', supportedGrants: ['authorization_code'],
    authorizationEndpoint: 'http://127.0.0.1:1/authorize', tokenEndpoint: tokenEndpoint.url,
    defaultScopes: ['files.picked'], usesPkce: true, clientAuth: 'none',
  };
  const clock = createTestClock();
  const randomBytesFn = ({ byteLength }: { readonly byteLength: number }) => randomBytes(byteLength);
  const pending = createPendingAuthorizationStore({ clock, randomBytesFn });
  const guard = createOAuthUrlGuard({ assertAllowed: () => {} }, { allowLoopbackHttp: true });
  const client = { clientId: 'installed-app', authMethod: 'none' } as const;
  const options = { clientDisplayName: 'Example Desktop', softwareId: 'example.desktop', redirectUris: [receiver.redirectUri] };

  const started = await beginAuthorizationCode({ provider, pending, randomBytesFn, guard, options, ownerKey: 'connection-1', client, redirectUri: receiver.redirectUri });
  const result = receiver.receive({ expectedState: started.state });

  // The system browser returning from consent.
  const authorization = new URL(started.authorizationUrl);
  const redirect = new URL(authorization.searchParams.get('redirect_uri')!);
  redirect.search = new URLSearchParams({ state: started.state, code: 'one-time-code', picked_ids: 'resource-7' }).toString();
  const page = await fetch(redirect);
  expect(page.status).toBe(200);

  const { code, fields } = await result;
  expect(fields).toEqual({ picked_ids: 'resource-7' });
  const tokens = await completeAuthorizationCode({
    provider, pending, clock, guard, ownerKey: 'connection-1', client, params: { state: started.state, code },
    fetchFn: ({ url }, init) => fetch(url, init),
  });

  expect(tokens.accessToken).toBe('issued-access');
  const form = tokenEndpoint.forms[0]!;
  expect(form.get('code')).toBe('one-time-code');
  expect(form.get('redirect_uri')).toBe(receiver.redirectUri);
  const challenge = createHash('sha256').update(form.get('code_verifier')!).digest('base64url');
  expect(authorization.searchParams.get('code_challenge')).toBe(challenge);
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
});
