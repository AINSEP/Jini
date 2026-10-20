import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { registerOAuthClientDynamically, type DynamicClientRegistrationInput } from '../../src/registration.js';
import type { OAuthOptionalArgs } from '../../src/args.js';
import type { OAuthClientAuthMethod, OAuthFetch } from '../../src/ports.js';
import { defaultOAuthMessages } from '../../src/messages.js';
import { fixturePorts } from '../fixtures.js';
import { assertOAuthRejects, createFetchDouble } from '../helpers.js';

const ENDPOINT = 'https://auth.example.com/register';
const OPTIONS = { clientDisplayName: 'Test app', softwareId: 'test.app', redirectUris: ['https://app.example.com/callback'] };
const REQUIRED = { ...fixturePorts, options: OPTIONS, registrationEndpoint: ENDPOINT, scopes: [] };

afterEach(() => vi.restoreAllMocks());

test('registration sends public-client defaults and a 15-second deadline in one guarded POST', async () => {
    const requests: Request[] = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchFn: OAuthFetch = async ({ url }, init) => {
        requests.push(new Request(url, init));
        assert.equal(init?.redirect, 'error');
        return new Response('{"client_id":" minted "}');
    };
    const result = await registerOAuthClientDynamically({ ...REQUIRED, fetchFn });
    assert.equal(requests.length, 1);
    const request = requests[0]!;
    assert.equal(request.url, ENDPOINT);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('accept'), 'application/json');
    assert.equal(request.headers.get('content-type'), 'application/json');
    assert.equal(request.headers.get('authorization'), null);
    assert.equal(timeout.mock.calls[0]?.[0], 15_000);
    assert.deepEqual(await request.json(), {
        client_name: 'Test app', software_id: 'test.app', redirect_uris: OPTIONS.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        token_endpoint_auth_method: 'none', application_type: 'web',
    });
    assert.deepEqual(result, { clientId: 'minted', clientSecret: null, tokenEndpointAuthMethod: 'none',
        registrationClientUri: null, clientIdIssuedAt: null, clientSecretExpiresAt: null });
});

test('registration forwards explicit metadata, scopes, initial access token and timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const requests: Request[] = [];
    const fetchFn: OAuthFetch = async ({ url }, init) => {
        requests.push(new Request(url, init));
        return new Response('{"client_id":"minted"}');
    };
    await registerOAuthClientDynamically({ ...REQUIRED, fetchFn, scopes: ['read', 'write'] }, {
        grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'], responseTypes: [],
        tokenEndpointAuthMethod: 'client_secret_post', initialAccessToken: 'initial-token', timeoutMs: 1234,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.headers.get('authorization'), 'Bearer initial-token');
    assert.equal(timeout.mock.calls[0]?.[0], 1234);
    assert.deepEqual(await requests[0]!.json(), {
        client_name: 'Test app', software_id: 'test.app', redirect_uris: OPTIONS.redirectUris,
        grant_types: ['urn:ietf:params:oauth:grant-type:device_code'], response_types: [],
        token_endpoint_auth_method: 'client_secret_post', application_type: 'web', scope: 'read write',
    });
});

const AUTH_CASES: readonly {
    name: string; document: Record<string, unknown>; options?: OAuthOptionalArgs<DynamicClientRegistrationInput>;
    expected: OAuthClientAuthMethod;
}[] = [
    { name: 'absent method and secret', document: {}, expected: 'none' },
    { name: 'blank secret', document: { client_secret_expires_at: 0, client_secret: '  ' }, expected: 'none' },
    { name: 'unknown echo without secret', document: { token_endpoint_auth_method: 'private_key_jwt' }, expected: 'none' },
    { name: 'echoed none wins over secret', document: { client_secret_expires_at: 0, client_secret: 'secret', token_endpoint_auth_method: 'none' }, expected: 'none' },
    { name: 'echoed Basic wins without secret', document: { token_endpoint_auth_method: 'client_secret_basic' }, expected: 'client_secret_basic' },
    { name: 'trimmed echoed POST wins', document: { token_endpoint_auth_method: ' client_secret_post ' }, expected: 'client_secret_post' },
    { name: 'explicit request wins over volunteered secret', document: { client_secret_expires_at: 0, client_secret: 'secret' }, options: { tokenEndpointAuthMethod: 'client_secret_post' }, expected: 'client_secret_post' },
    { name: 'absent advertisements default to Basic', document: { client_secret_expires_at: 0, client_secret: 'secret' }, expected: 'client_secret_basic' },
    { name: 'empty advertisements default to Basic', document: { client_secret_expires_at: 0, client_secret: 'secret' }, options: { authMethodsSupported: [] }, expected: 'client_secret_basic' },
    { name: 'Basic wins over POST', document: { client_secret_expires_at: 0, client_secret: 'secret' }, options: { authMethodsSupported: ['client_secret_post', 'client_secret_basic'] }, expected: 'client_secret_basic' },
    { name: 'POST when Basic absent', document: { client_secret_expires_at: 0, client_secret: 'secret' }, options: { authMethodsSupported: ['client_secret_post'] }, expected: 'client_secret_post' },
    { name: 'unsupported secret methods retain none', document: { client_secret_expires_at: 0, client_secret: 'secret' }, options: { authMethodsSupported: ['private_key_jwt', 'none'] }, expected: 'none' },
];
for (const scenario of AUTH_CASES) {
    test(`registration auth resolution: ${scenario.name}`, async () => {
        const http = createFetchDouble([{ json: { client_id: 'minted', ...scenario.document } }]);
        const client = await registerOAuthClientDynamically({ ...REQUIRED, fetchFn: http.fetchFn }, scenario.options);
        assert.equal(client.tokenEndpointAuthMethod, scenario.expected);
        assert.equal(http.callCount(), 1);
    });
}

test('registration retains nullish auth defaults for runtime JSON options', async () => {
    const options: OAuthOptionalArgs<DynamicClientRegistrationInput> = JSON.parse('{"tokenEndpointAuthMethod":null,"authMethodsSupported":null}');
    const http = createFetchDouble([{ json: { client_secret_expires_at: 0, client_id: 'id', client_secret: 'secret' } }]);
    const client = await registerOAuthClientDynamically({ ...REQUIRED, fetchFn: http.fetchFn }, options);
    assert.equal(client.tokenEndpointAuthMethod, 'client_secret_basic');
});

test('registration normalizes non-finite JSON numeric timestamps to null', async () => {
    const http = createFetchDouble([{ text: '{"client_id":"id","client_id_issued_at":1e400,"client_secret_expires_at":-1e400}' }]);
    const client = await registerOAuthClientDynamically({ ...REQUIRED, fetchFn: http.fetchFn });
    assert.equal(client.clientIdIssuedAt, null);
    assert.equal(client.clientSecretExpiresAt, null);
});

for (const [status, document, suffix, providerErrorCode] of [
    [200, { error: 'invalid_client', client_id: 'id' }, ', invalid_client', 'invalid_client'],
    [400, {}, '', undefined],
    [400, { error: 123 }, '', undefined],
    [200, { error: '' }, '', undefined],
] as const) {
    test(`registration rejects HTTP ${status} with error ${JSON.stringify(document)}`, async () => {
        const http = createFetchDouble([{ status, json: document }]);
        const error = await assertOAuthRejects(() => registerOAuthClientDynamically({ ...REQUIRED, fetchFn: http.fetchFn }), 'OAUTH_PROVIDER_REJECTED');
        assert.equal(error.message, `the authorization server refused the client registration (HTTP ${status}${suffix})`);
        assert.equal(error.providerErrorCode, providerErrorCode);
        assert.equal(error.operatorAction, defaultOAuthMessages.registrationRejectedAction);
        assert.equal(error.retryable, false);
        assert.equal(http.callCount(), 1);
    });
}

test('registration uses host rejection copy and omits provider descriptions', async () => {
    const http = createFetchDouble([{ status: 403, json: { error: 'denied', error_description: 'private detail' } }]);
    const error = await assertOAuthRejects(() => registerOAuthClientDynamically({ ...REQUIRED, fetchFn: http.fetchFn }, {
        messages: { ...defaultOAuthMessages, registrationRejectedAction: 'Host action' },
    }), 'OAUTH_PROVIDER_REJECTED');
    assert.equal(error.operatorAction, 'Host action');
    assert.equal(error.message, 'the authorization server refused the client registration (HTTP 403, denied)');
});

test('registration reflects arbitrary provider error-code text (reported, not fixed)', async () => {
    const http = createFetchDouble([{ status: 400, json: { error: '<script>provider-text</script>' } }]);
    const error = await assertOAuthRejects(() => registerOAuthClientDynamically({ ...REQUIRED, fetchFn: http.fetchFn }), 'OAUTH_PROVIDER_REJECTED');
    assert.equal(error.message, 'the authorization server refused the client registration (HTTP 400, <script>provider-text</script>)');
    assert.equal(error.providerErrorCode, '<script>provider-text</script>');
});

for (const clientId of [undefined, null, '', '  ', 12]) {
    test(`registration rejects missing or invalid client id ${JSON.stringify(clientId)}`, async () => {
        const http = createFetchDouble([{ json: { client_id: clientId } }]);
        const error = await assertOAuthRejects(() => registerOAuthClientDynamically({ ...REQUIRED, fetchFn: http.fetchFn }), 'OAUTH_MALFORMED_RESPONSE');
        assert.equal(error.message, 'the client registration response contained no client id');
    });
}

test('registration wraps a transport failure with its cause without retrying', async () => {
    const cause = new Error('offline');
    const http = createFetchDouble([{ throws: cause }]);
    const error = await assertOAuthRejects(() => registerOAuthClientDynamically({ ...REQUIRED, fetchFn: http.fetchFn }), 'OAUTH_PROVIDER_UNREACHABLE');
    assert.equal(error.cause, cause);
    assert.equal(error.message, 'could not reach the client registration endpoint at auth.example.com');
    assert.equal(http.callCount(), 1);
});

test('registration preserves option validation and endpoint rejection before fetch', async () => {
    const http = createFetchDouble([{ json: { client_id: 'id' } }]);
    await assertOAuthRejects(() => registerOAuthClientDynamically({ ...REQUIRED, fetchFn: http.fetchFn,
        options: { ...OPTIONS, softwareId: '' } }), 'OAUTH_INVALID_REQUEST');
    await assertOAuthRejects(() => registerOAuthClientDynamically({ ...REQUIRED, fetchFn: http.fetchFn,
        registrationEndpoint: 'https://10.0.0.1/register' }), 'OAUTH_UNSAFE_ENDPOINT');
    assert.equal(http.callCount(), 0);
});

test('registration keeps bounded JSON failures outside transport error wrapping', async () => {
    for (const text of ['[]', 'invalid JSON', JSON.stringify({ client_id: 'x'.repeat(65_536) })]) {
        const http = createFetchDouble([{ text }]);
        await assertOAuthRejects(() => registerOAuthClientDynamically({ ...REQUIRED, fetchFn: http.fetchFn }), 'OAUTH_MALFORMED_RESPONSE');
        assert.equal(http.callCount(), 1);
    }
});
