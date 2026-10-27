import { fixturePorts } from "./fixtures.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { randomBytes } from 'node:crypto';
import { createOAuthClientRegistrar, registerOAuthClientDynamically, type RegisteredOAuthClient } from "../src/index.js";
import { createMemoryClientRegistrationCache } from '../src/testing/index.js';
import { assertOAuthRejects, createFetchDouble, sendJson, startDiscoveryFixture, startLoopbackServer } from "./helpers.js";
/**
 * @file Tests for RFC 7591 dynamic client registration, against real loopback servers.
 *
 * The point of this module is that some authorization servers have NO console where a human could
 * create an app — self-registration is the only way to get a `client_id` at all. So the failure modes
 * that matter are:
 *
 * 1. The request body must be an RFC 7591 client-metadata document a strict server will accept —
 *    `redirect_uris`, `grant_types`, `response_types`, `token_endpoint_auth_method`.
 * 2. A `client_secret` the server volunteers must be carried back to the caller so it can be SEALED,
 *    never dropped and never logged.
 * 3. The registration endpoint is a discovered URL, so it goes through the same outbound-safety gate
 *    as every other discovered endpoint.
 */
const REDIRECT_URI = "https://example.example.com/api/resource-servers/oauth/callback/remote-1";
function parseBody(raw: string): Record<string, unknown> {
    return JSON.parse(raw) as Record<string, unknown>;
}
test("a registration endpoint on an internal address is refused before anything is sent to it", async () => {
    const error = await assertOAuthRejects(() => registerOAuthClientDynamically({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            clientDisplayName: "example",
            redirectUris: [REDIRECT_URI]
        },
        registrationEndpoint: "https://10.0.0.7/oauth2/register", scopes: []
    }), "OAUTH_UNSAFE_ENDPOINT");
    assert.equal(error.message, "registration endpoint: provider endpoint resolves to an internal address, which is not allowed");
});
for (const [supported, expected] of [
    [undefined, "client_secret_basic"],
    [[], "client_secret_basic"],
    [["client_secret_basic"], "client_secret_basic"],
    [["client_secret_post"], "client_secret_post"],
    [["client_secret_post", "client_secret_basic"], "client_secret_basic"],
    [["none", "private_key_jwt"], "none"],
] as const) {
    test(`secret without an echoed method resolves ${JSON.stringify(supported)} to ${expected}`, async () => {
        const http = createFetchDouble([{ status: 201, json: { client_secret_expires_at: 0, client_id: "issued-id", client_secret: "issued-secret" } }]);
        const registered = await registerOAuthClientDynamically({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                clientDisplayName: "example",
                redirectUris: [REDIRECT_URI]
            },
            fetchFn: http.fetchFn,
            registrationEndpoint: "https://auth.example.com/register",
            scopes: []
        }, {
            ...(supported === undefined ? {} : { authMethodsSupported: supported })
        });
        assert.equal(registered.clientId, "issued-id");
        assert.equal(registered.clientSecret, "issued-secret");
        assert.equal(registered.tokenEndpointAuthMethod, expected);
        assert.equal(http.requests.length, 1);
    });
}
test("an unreachable registration is attempted exactly once", async () => {
    let attempts = 0;
    await assertOAuthRejects(() => registerOAuthClientDynamically({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            clientDisplayName: "example",
            redirectUris: [REDIRECT_URI]
        },
        fetchFn: async () => {
            attempts += 1;
            throw new Error("connection refused");
        },
        registrationEndpoint: "https://auth.example.com/register",
        scopes: []
    }), "OAUTH_PROVIDER_UNREACHABLE");
    assert.equal(attempts, 1);
});

test("P10: registration uses public auth without a secret and accepts a secret with omitted expiry", async () => {
    const http = createFetchDouble([
        { status: 201, json: { client_id: "public-client", token_endpoint_auth_method: "client_secret_basic" } },
        { status: 201, json: {
            client_id: "secret-client", client_secret: "fixture-secret",
            token_endpoint_auth_method: "client_secret_basic",
        } },
    ]);
    const input = {
        ...fixturePorts, fetchFn: http.fetchFn,
        registrationEndpoint: "https://auth.example.com/register", scopes: [],
    };

    const publicClient = await registerOAuthClientDynamically(input);
    assert.equal(publicClient.clientSecret, null);
    assert.equal(publicClient.tokenEndpointAuthMethod, "none", "secret-based auth cannot be used without a client secret");

    let secretClient: RegisteredOAuthClient | undefined;
    await assert.doesNotReject(async () => {
        secretClient = await registerOAuthClientDynamically(input);
    }, "an omitted client_secret_expires_at must default to zero");
    assert.equal(secretClient?.clientSecret, "fixture-secret");
    assert.equal(secretClient?.tokenEndpointAuthMethod, "client_secret_basic");
    assert.equal(secretClient?.clientSecretExpiresAt, 0);
    assert.equal(http.callCount(), 2, "each registration makes exactly one request");
});

for (const status of [200, 201, 202]) {
    test(`registration accepts HTTP ${status} and retains facade normalization without extra discovery`, async () => {
        const clientSecret = randomBytes(24).toString('base64url');
        const initialAccessToken = randomBytes(24).toString('base64url');
        let attempts = 0;
        const result = await registerOAuthClientDynamically({
            ...fixturePorts, registrationEndpoint: 'https://auth.example.com/register', scopes: ['read', 'write'],
            fetchFn: async ({ url }, options) => {
                attempts += 1;
                assert.equal(String(url), 'https://auth.example.com/register');
                assert.equal(options?.method, 'POST');
                assert.equal(options?.redirect, 'error');
                const headers = new Headers(options?.headers);
                assert.equal(headers.get('authorization'), `Bearer ${initialAccessToken}`);
                assert.equal(headers.get('content-type'), 'application/json');
                assert.equal(headers.get('accept'), 'application/json');
                assert.deepEqual(JSON.parse(String(options?.body)), {
                    client_name: fixturePorts.options.clientDisplayName, software_id: fixturePorts.options.softwareId,
                    redirect_uris: [], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
                    token_endpoint_auth_method: 'none', application_type: 'web', scope: 'read write',
                });
                return new Response(JSON.stringify({
                    client_id: 'issued-id', client_secret: clientSecret, client_secret_expires_at: 0,
                    registration_client_uri: ' https://auth.example.com/clients/issued-id ',
                    client_id_issued_at: 'not-a-number',
                }), { status });
            },
        }, { initialAccessToken });
        assert.deepEqual(result, {
            clientId: 'issued-id', clientSecret, tokenEndpointAuthMethod: 'client_secret_basic',
            registrationClientUri: 'https://auth.example.com/clients/issued-id',
            clientIdIssuedAt: null, clientSecretExpiresAt: 0,
        });
        assert.equal(attempts, 1);
    });
}

test('finite past secret expiration stays expired instead of becoming a permanent cached secret', async () => {
    const clientSecret = randomBytes(24).toString('base64url');
    const http = createFetchDouble([{ status: 201, json: {
        client_id: 'issued-id', client_secret: clientSecret, client_secret_expires_at: 1, client_id_issued_at: 123,
    } }]);
    const result = await registerOAuthClientDynamically({
        ...fixturePorts, fetchFn: http.fetchFn, registrationEndpoint: 'https://auth.example.com/register', scopes: [],
    });
    assert.equal(result.clientSecretExpiresAt, 1);
    assert.equal(result.clientIdIssuedAt, 123);
    assert.equal(result.clientSecret, clientSecret);
});

test('HTTP 200 OAuth registration errors retain custom operator copy without provider free text', async () => {
    const marker = randomBytes(24).toString('base64url');
    const http = createFetchDouble([{ json: { error: 'invalid_client_metadata', error_description: marker } }]);
    const { defaultOAuthMessages } = await import('../src/index.js');
    const error = await assertOAuthRejects(() => registerOAuthClientDynamically({
        ...fixturePorts, fetchFn: http.fetchFn, registrationEndpoint: 'https://auth.example.com/register', scopes: [],
    }, { messages: { ...defaultOAuthMessages, registrationRejectedAction: 'Contact the workspace operator.' } }), 'OAUTH_PROVIDER_REJECTED');
    assert.equal(error.message, 'the authorization server refused the client registration (HTTP 200, invalid_client_metadata)');
    assert.equal(error.operatorAction, 'Contact the workspace operator.');
    assert.equal(error.providerErrorCode, 'invalid_client_metadata');
    assert.equal(JSON.stringify(error).includes(marker), false);
    assert.equal(http.callCount(), 1);
});

test('registration persists before returning and invalidation waits for an outstanding cache write', async () => {
    const cache = createMemoryClientRegistrationCache({});
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
    let signalWriteStarted!: () => void;
    const writeStarted = new Promise<void>(resolve => { signalWriteStarted = resolve; });
    const http = createFetchDouble([
        { status: 201, json: { client_id: 'first-id' } }, { status: 201, json: { client_id: 'replacement-id' } },
    ]);
    const registrar = createOAuthClientRegistrar({
        ...fixturePorts, fetchFn: http.fetchFn,
        cache: {
            get: args => cache.get(args), delete: args => cache.delete(args),
            async set(args) { signalWriteStarted(); await writeGate; await cache.set(args); },
        },
    });
    const input = { issuer: 'https://auth.example.com', registrationEndpoint: 'https://auth.example.com/register', scopes: [] };
    let returned = false;
    const first = registrar.getOrRegister(input).then(client => { returned = true; return client; });
    const concurrent = registrar.getOrRegister(input);
    await writeStarted;
    const invalidation = registrar.invalidate(input);
    assert.equal(returned, false);
    assert.equal(http.callCount(), 1);
    releaseWrite();
    assert.deepEqual(await first, await concurrent);
    await invalidation;
    const replacement: RegisteredOAuthClient = await registrar.getOrRegister(input);
    assert.equal(replacement.clientId, 'replacement-id');
    assert.equal(http.callCount(), 2);
});

test('registration rejects and cancels a returned redirect without retrying or leaking its body', async () => {
    const marker = randomBytes(24).toString('base64url');
    let cancelled = false;
    let attempts = 0;
    const error = await assertOAuthRejects(() => registerOAuthClientDynamically({
        ...fixturePorts, registrationEndpoint: 'https://auth.example.com/register', scopes: [],
        fetchFn: async () => {
            attempts += 1;
            return new Response(new ReadableStream({
                start(controller) { controller.enqueue(new TextEncoder().encode(marker)); },
                cancel() { cancelled = true; },
            }), { status: 307, headers: { location: 'https://other.example.com/register' } });
        },
    }), 'OAUTH_UNSAFE_ENDPOINT');
    assert.equal(error.message, 'refusing to follow an OAuth endpoint redirect');
    assert.equal(JSON.stringify(error).includes(marker), false);
    assert.equal(attempts, 1);
    assert.equal(cancelled, true);
});

test('an invalid initial-token header fails before dispatch and does not expose its value', async () => {
    const marker = randomBytes(24).toString('base64url');
    const http = createFetchDouble([{ status: 201, json: { client_id: 'issued-id' } }]);
    const error = await assertOAuthRejects(() => registerOAuthClientDynamically({
        ...fixturePorts, fetchFn: http.fetchFn, registrationEndpoint: 'https://auth.example.com/register', scopes: [],
    }, { initialAccessToken: `${marker}\r\ninjected: value` }), 'OAUTH_INVALID_REQUEST');
    assert.equal(error.message, 'the OAuth client registration configuration is invalid');
    assert.equal(JSON.stringify(error).includes(marker), false);
    assert.equal(error.cause, undefined);
    assert.equal(http.callCount(), 0);
});

test('an explicitly empty initial token follows upstream authentication omission', async () => {
    const http = createFetchDouble([{ status: 201, json: { client_id: 'issued-id' } }]);
    await registerOAuthClientDynamically({
        ...fixturePorts, fetchFn: http.fetchFn, registrationEndpoint: 'https://auth.example.com/register', scopes: [],
    }, { initialAccessToken: '' });
    assert.equal(http.requests[0]?.headers.authorization, undefined);
    assert.equal(http.callCount(), 1);
});
