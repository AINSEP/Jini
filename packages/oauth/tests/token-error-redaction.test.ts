import { expect, test } from 'vitest';
import { requestOAuthToken } from '../src/index.js';
import { fixturePorts } from './fixtures.js';
import { assertOAuthRejects, createFetchDouble, createTestClock, TEST_CLIENT } from './helpers.js';

// Concatenated so this synthetic provider value cannot be mistaken for a real key by scanners.
const providerSecret = 'sk_' + 'live_' + 'CANARY';
const action = "Check this provider's client id, secret, scopes and redirect URI, then try connecting again.";

for (const status of [200, 400, 503]) {
  test(`HTTP ${status}: an alphanumeric provider error cannot become model-facing text`, async () => {
    const http = createFetchDouble([{ status, json: { error: providerSecret } }]);
    const error = await assertOAuthRejects(() => requestOAuthToken({
      ...fixturePorts, clock: createTestClock(), fetchFn: http.fetchFn,
      tokenEndpoint: 'https://auth.example.com/token', client: TEST_CLIENT,
      params: { grant_type: 'authorization_code' },
    }), 'OAUTH_PROVIDER_REJECTED');
    expect(error.message).toBe(`the authorization server returned an unrecognized error (HTTP ${status})`);
    expect(error.operatorAction).toBe(action);
    expect(error.message + error.operatorAction).not.toContain(providerSecret);
    expect(JSON.stringify(error)).not.toContain(providerSecret);
    expect(error.cause).toBeUndefined();
    expect(http.callCount()).toBe(1);
  });
}

for (const code of ['invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client',
  'unsupported_grant_type', 'invalid_scope', 'invalid_target', 'access_denied', 'server_error',
  'temporarily_unavailable', 'authorization_pending', 'slow_down', 'expired_token']) {
  test(`recognized protocol error ${code} retains its exact message and recovery action`, async () => {
    const http = createFetchDouble([{ status: 400, json: { error: code } }]);
    const error = await requestOAuthToken({
      ...fixturePorts, clock: createTestClock(), fetchFn: http.fetchFn,
      tokenEndpoint: 'https://auth.example.com/token', client: TEST_CLIENT,
      params: { grant_type: 'authorization_code' },
    }).catch((value: unknown) => value as Error & { operatorAction: string });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`the authorization server refused the request (HTTP 400, ${code})`);
    expect((error as { operatorAction: string }).operatorAction).toBe(code === 'invalid_grant'
      ? "This connection's authorization is no longer valid — reconnect it in the connection settings." : action);
  });
}
