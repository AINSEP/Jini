import { expect, test } from 'vitest';
import { beginDeviceAuthorization, registerOAuthClientDynamically } from '../src/index.js';
import { toCallbackError } from '../src/authorization-code.js';
import { fixturePorts } from './fixtures.js';
import { assertOAuthRejects, createFetchDouble, TEST_CLIENT, TEST_PROVIDER } from './helpers.js';

// Concatenated so scanners cannot mistake this synthetic provider response for a real secret.
const providerSecret = 'sk_' + 'live_' + 'canary';
for (const status of [200, 400, 503]) {
  test(`registration HTTP ${status}: an unrecognized provider error never reaches public failures`, async () => {
    const http = createFetchDouble([{ status, json: { error: providerSecret } }]);
    const error = await assertOAuthRejects(() => registerOAuthClientDynamically({
      ...fixturePorts, fetchFn: http.fetchFn,
      options: { ...fixturePorts.options, redirectUris: ['https://app.example.com/callback'] },
      registrationEndpoint: 'https://auth.example.com/register', scopes: [],
    }), 'OAUTH_PROVIDER_REJECTED');
    expect(error.message).toBe(`the authorization server refused the client registration (HTTP ${status})`);
    expect(error.message + error.operatorAction + JSON.stringify(error)).not.toContain(providerSecret);
    expect(error.cause).toBeUndefined();
    expect(http.callCount()).toBe(1);
  });
}
for (const code of ['invalid_request', 'invalid_client', 'invalid_redirect_uri', 'invalid_client_metadata',
  'invalid_software_statement', 'unapproved_software_statement']) {
  test(`registration protocol code ${code} retains its exact text`, async () => {
    const http = createFetchDouble([{ status: 400, json: { error: code } }]);
    const error = await assertOAuthRejects(() => registerOAuthClientDynamically({
      ...fixturePorts, fetchFn: http.fetchFn,
      options: { ...fixturePorts.options, redirectUris: ['https://app.example.com/callback'] },
      registrationEndpoint: 'https://auth.example.com/register', scopes: [],
    }), 'OAUTH_PROVIDER_REJECTED');
    expect(error.message).toBe(`the authorization server refused the client registration (HTTP 400, ${code})`);
    expect(error.providerErrorCode).toBe(code);
  });
}
test('device error metadata cannot carry an unrecognized provider value', async () => {
  const http = createFetchDouble([{ status: 400, json: { error: providerSecret } }]);
  const error = await assertOAuthRejects(() => beginDeviceAuthorization({
    ...fixturePorts, fetchFn: http.fetchFn, provider: TEST_PROVIDER, client: TEST_CLIENT,
  }), 'OAUTH_PROVIDER_REJECTED');
  expect(JSON.stringify(error)).not.toContain(providerSecret);
});
test('callback error metadata cannot carry an unrecognized provider value', () => {
  expect(JSON.stringify(toCallbackError(providerSecret))).not.toContain(providerSecret);
  expect(toCallbackError('access_denied').message).toBe('authorization was declined');
  expect(toCallbackError('access_denied').providerErrorCode).toBe('access_denied');
});
