import { defaultOAuthMessages } from '../src/index.js';
import { fixtureEntropy } from "./fixtures.js";
import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { beginAuthorizationCode, completeAuthorizationCode, beginDeviceAuthorization, pollDeviceAuthorizationOnce, refreshAccessToken, createOAuthUrlGuard, createOAuthProviderRegistry, registerOAuthClientDynamically, createOAuthClientRegistrar, discoverAuthorizationServer, fetchAuthorizationServerMetadata, } from '../src/index.js';
import { createPendingAuthorizationStore, createMemoryClientRegistrationCache, createMemoryTokenStore, } from '../src/testing/index.js';
import { createFetchDouble, createTestClock, TEST_CLIENT, TEST_PROVIDER } from './helpers.js';
const options = {
    clientDisplayName: 'Example Client',
    redirectUris: ['https://app.example.com/callback'], softwareId: 'example.client',
};
const guard = createOAuthUrlGuard({
    assertAllowed() { }
});
const resource = ['https://api.example.com/a', 'https://api.example.com/b'];
test('resource indicators are repeated on authorization and replayed from the pending store on exchange', async () => {
    const clock = createTestClock();
    const pending = createPendingAuthorizationStore({
        clock, randomBytesFn: fixtureEntropy
    });
    const started = await beginAuthorizationCode({
        provider: TEST_PROVIDER, pending, randomBytesFn: fixtureEntropy, guard, options, ownerKey: 'tenant:connection', client: TEST_CLIENT, redirectUri: options.redirectUris[0]!
    }, {
        resource
    });
    expect(new URL(started.authorizationUrl).searchParams.getAll('resource')).toEqual(resource);
    const http = createFetchDouble([{ json: { access_token: 'issued' } }]);
    await completeAuthorizationCode({
        provider: TEST_PROVIDER, pending, clock, guard, fetchFn: http.fetchFn, ownerKey: 'tenant:connection', client: TEST_CLIENT, params: { state: started.state, code: 'code' }
    });
    expect(http.requests[0]!.body.getAll('resource')).toEqual(resource);
    expect(http.requests[0]!.redirect).toBe('error');
});
test('resource is reserved and malformed indicators fail before creating pending state', async () => {
    const clock = createTestClock();
    const pending = createPendingAuthorizationStore({
        clock, randomBytesFn: fixtureEntropy
    });
    const deps = { provider: TEST_PROVIDER, pending, randomBytesFn: fixtureEntropy, guard, options };
    for (const invalid of ['relative', 'https://api.example.com/#fragment', '']) {
        await expect(beginAuthorizationCode({
            ...deps, ownerKey: 'key', client: TEST_CLIENT, redirectUri: options.redirectUris[0]!
        }, {
            resource: invalid
        })).rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST' });
    }
    await expect(beginAuthorizationCode({
        ...deps, ownerKey: 'key', client: TEST_CLIENT, redirectUri: options.redirectUris[0]!
    }, {
        extraAuthorizationParams: { resource: resource[0]! }
    })).rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST', message: "'resource' is set by the OAuth client and cannot be overridden for this provider" });
    expect(await pending.size({})).toBe(0);
});
test('all application identity fields are required before authorization or registration effects', async () => {
    const clock = createTestClock();
    const pending = createPendingAuthorizationStore({
        clock, randomBytesFn: fixtureEntropy
    });
    const http = createFetchDouble([{ json: { client_id: 'id' } }]);
    for (const key of ['clientDisplayName', 'redirectUris', 'softwareId'] as const) {
        const invalid = { ...options, [key]: undefined } as unknown as typeof options;
        await expect(beginAuthorizationCode({
            provider: TEST_PROVIDER, pending, randomBytesFn: fixtureEntropy, guard, options: invalid, ownerKey: 'key', client: TEST_CLIENT, redirectUri: options.redirectUris[0]!
        })).rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST' });
        await expect(registerOAuthClientDynamically({
            guard, fetchFn: http.fetchFn, options: invalid, registrationEndpoint: 'https://auth.example.com/register', scopes: []
        })).rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST' });
    }
    expect(await pending.size({})).toBe(0);
    expect(http.requests).toHaveLength(0);
});
test('registration sends required identity and every redirect URI without substituting branding', async () => {
    let metadata: unknown;
    await registerOAuthClientDynamically({
        guard, options, fetchFn: async ({ url: _url }, init) => {
            metadata = JSON.parse(String(init!.body));
            return new Response('{"client_id":"registered"}', { status: 201 });
        }, registrationEndpoint: 'https://auth.example.com/register', scopes: ['read']
    });
    expect(metadata).toEqual({
        client_name: 'Example Client', software_id: 'example.client', redirect_uris: options.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        token_endpoint_auth_method: 'none', application_type: 'web', scope: 'read',
    });
});
test('the injected URL policy blocks token-bearing requests before fetch and maps its failure', async () => {
    const http = createFetchDouble([{ json: { access_token: 'should-not-arrive' } }]);
    const refusal = new Error('application denied outbound request');
    const guarded = createOAuthUrlGuard({
        assertAllowed({ url, label }) {
            expect(url.href).toBe(TEST_PROVIDER.tokenEndpoint);
            expect(label).toBe('token endpoint');
            throw refusal;
        }
    });
    await expect(refreshAccessToken({
        clock: createTestClock(), fetchFn: http.fetchFn, guard: guarded, tokenEndpoint: TEST_PROVIDER.tokenEndpoint, client: TEST_CLIENT, refreshToken: 'secret'
    })).rejects.toMatchObject({ code: 'OAUTH_UNSAFE_ENDPOINT', cause: refusal });
    expect(http.requests).toHaveLength(0);
});
test('loopback HTTP requires the explicit test option and still invokes the supplied policy', () => {
    const seen: string[] = [];
    const localGuard = createOAuthUrlGuard({
        assertAllowed: ({ url }) => { seen.push(url.href); }
    }, {
        allowLoopbackHttp: true
    });
    expect(() => guard.assertSafeUrl({
        raw: 'http://127.0.0.1/token',
        label: 'token'
    })).toThrow();
    expect(localGuard.assertSafeUrl({
        raw: 'http://127.0.0.1/token',
        label: 'token'
    }).href).toBe('http://127.0.0.1/token');
    expect(() => localGuard.assertSafeUrl({
        raw: 'http://api.example.com/token',
        label: 'token'
    })).toThrow();
    expect(seen).toEqual(['http://127.0.0.1/token']);
});
test('provider registries are empty independent instances and own their descriptor snapshots', () => {
    const first = createOAuthProviderRegistry({ guard });
    const second = createOAuthProviderRegistry({ guard });
    expect(first.list({})).toEqual([]);
    first.register({
        descriptor: TEST_PROVIDER
    });
    expect(first.get({
        providerId: TEST_PROVIDER.providerId
    })).toEqual(TEST_PROVIDER);
    expect(second.list({})).toEqual([]);
    expect(() => second.get({
        providerId: TEST_PROVIDER.providerId
    })).toThrow();
    const leaked = first.get({
        providerId: TEST_PROVIDER.providerId
    }) as {
        defaultScopes: string[];
    };
    leaked.defaultScopes.push('unauthorized-scope');
    expect(first.get({
        providerId: TEST_PROVIDER.providerId
    }).defaultScopes).toEqual(['images:generate']);
});
test('device authorization, one-shot polling and refresh all carry resource indicators', async () => {
    const clock = createTestClock();
    const http = createFetchDouble([
        { json: { device_code: 'private', user_code: 'PUBLIC', verification_uri: 'https://auth.example.com/activate', expires_in: 600 } },
        { json: { access_token: 'device-at', refresh_token: 'rt' } },
        { json: { access_token: 'refreshed-at' } },
    ]);
    const deps = { provider: TEST_PROVIDER, clock, guard, fetchFn: http.fetchFn };
    const device = await beginDeviceAuthorization({
        ...deps, client: TEST_CLIENT
    }, {
        resource
    });
    await pollDeviceAuthorizationOnce({
        ...deps, client: TEST_CLIENT, deviceCode: device.deviceCode, expiresAt: device.expiresAt
    }, {
        resource
    });
    const refreshed = await refreshAccessToken({
        ...deps, tokenEndpoint: TEST_PROVIDER.tokenEndpoint, client: TEST_CLIENT, refreshToken: 'rt'
    }, {
        scopes: ['read'], resource
    });
    expect(http.requests.map(r => r.body.getAll('resource'))).toEqual([resource, resource, resource]);
    expect(http.requests[2]!.body.get('grant_type')).toBe('refresh_token');
    expect(http.requests[2]!.body.get('scope')).toBe('read');
    expect(refreshed.refreshToken).toBe('rt');
});
test('malformed resource indicators keep their typed input error on device and refresh grants before HTTP', async () => {
    const http = createFetchDouble([{ json: { access_token: 'unwanted' } }]);
    const deps = { provider: TEST_PROVIDER, clock: createTestClock(), guard, fetchFn: http.fetchFn };
    await expect(beginDeviceAuthorization({
        ...deps, client: TEST_CLIENT
    }, {
        resource: '/relative'
    }))
        .rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST' });
    await expect(refreshAccessToken({
        ...deps, tokenEndpoint: TEST_PROVIDER.tokenEndpoint, client: TEST_CLIENT, refreshToken: 'rt'
    }, {
        resource: '/relative'
    })).rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST' });
    expect(http.requests).toHaveLength(0);
});
test('a registrar reuses its injected cache, coalesces concurrent calls and separates redirect identities', async () => {
    const cache = createMemoryClientRegistrationCache({});
    const http = createFetchDouble([{ json: { client_id: 'registered' } }]);
    const deps = { cache, clock: createTestClock(), guard, fetchFn: http.fetchFn, options };
    const registrar = createOAuthClientRegistrar(deps);
    const input = { issuer: 'https://auth.example.com', registrationEndpoint: 'https://auth.example.com/register', scopes: ['read'] };
    const [a, b] = await Promise.all([registrar.getOrRegister(input), registrar.getOrRegister(input)]);
    expect(a.clientId).toBe('registered');
    expect(b).toEqual(a);
    const freshInstance = createOAuthClientRegistrar(deps);
    expect(await freshInstance.getOrRegister(input)).toEqual(a);
    expect(http.requests).toHaveLength(1);
    await createOAuthClientRegistrar({ ...deps, options: { ...options, redirectUris: ['https://app.example.com/other'] } }).getOrRegister(input);
    expect(http.requests).toHaveLength(2);
});
test('failed registration is never cached and an expired secret is registered again', async () => {
    const clock = createTestClock('2026-08-25T12:00:00.000Z');
    const http = createFetchDouble([
        { status: 400, json: { error: 'invalid_client_metadata' } },
        { json: { client_id: 'first', client_secret: 'secret', client_secret_expires_at: clock.nowMs() / 1000 + 1 } },
        { json: { client_id: 'second' } },
    ]);
    const registrar = createOAuthClientRegistrar({ cache: createMemoryClientRegistrationCache({}), clock, guard, fetchFn: http.fetchFn, options });
    const input = { issuer: 'https://auth.example.com', registrationEndpoint: 'https://auth.example.com/register', scopes: [] };
    await expect(registrar.getOrRegister(input)).rejects.toMatchObject({ code: 'OAUTH_PROVIDER_REJECTED' });
    expect((await registrar.getOrRegister(input)).clientId).toBe('first');
    clock.advance(1000);
    expect((await registrar.getOrRegister(input)).clientId).toBe('second');
    expect(http.requests).toHaveLength(3);
});
test('the app can invalidate a refused cached client without changing other registration identities', async () => {
    const http = createFetchDouble([{ json: { client_id: 'initial' } }, { json: { client_id: 'other-scope' } }, { json: { client_id: 'replacement' } }]);
    const registrar = createOAuthClientRegistrar({
        cache: createMemoryClientRegistrationCache({}), clock: createTestClock(), guard, fetchFn: http.fetchFn, options,
    });
    const input = { issuer: 'https://auth.example.com', registrationEndpoint: 'https://auth.example.com/register', scopes: [] };
    const other = { ...input, scopes: ['other'] };
    expect((await registrar.getOrRegister(input)).clientId).toBe('initial');
    expect((await registrar.getOrRegister(input)).clientId).toBe('initial');
    expect((await registrar.getOrRegister(other)).clientId).toBe('other-scope');
    await registrar.invalidate(input);
    expect((await registrar.getOrRegister(input)).clientId).toBe('replacement');
    expect((await registrar.getOrRegister(other)).clientId).toBe('other-scope');
    expect(http.requests).toHaveLength(3);
});
test('the memory token store owns snapshots and compare-and-set leases per key', async () => {
    const store = createMemoryTokenStore({});
    const tokens = { accessToken: 'at', refreshToken: 'rt', tokenType: 'Bearer', scopes: ['read'], expiresAt: null };
    await store.persist({
        key: 'one',
        tokens: tokens
    });
    tokens.scopes.push('write');
    expect((await store.load({
        key: 'one'
    }))!.scopes).toEqual(['read']);
    expect(await store.load({
        key: 'two'
    })).toBeNull();
    expect(await store.tryAcquireRefreshLease!({ key: 'one' })).toBe(true);
    expect(await store.tryAcquireRefreshLease!({ key: 'one' })).toBe(false);
    await store.releaseRefreshLease!({ key: 'one' });
    expect(await store.tryAcquireRefreshLease!({ key: 'one' })).toBe(true);
    await store.markNeedsReauth({
        key: 'one',
        reason: 'revoked'
    });
    expect(await store.load({
        key: 'one'
    })).toBeNull();
});
test('discovery follows an exact challenge, skips dead issuers and prefers challenge scopes', async () => {
    const http = createFetchDouble([
        { json: { resource: resource[0], authorization_servers: ['https://dead.example.com', 'https://auth.example.com'], scopes_supported: ['fallback'] } },
        { status: 404 }, { status: 404 },
        { json: { issuer: 'https://auth.example.com', token_endpoint: TEST_PROVIDER.tokenEndpoint, authorization_endpoint: TEST_PROVIDER.authorizationEndpoint } },
    ]);
    const result = await discoverAuthorizationServer({
        guard, fetchFn: http.fetchFn, resourceUrl: resource[0]!
    }, {
        wwwAuthenticate: 'Bearer resource_metadata="https://api.example.com/custom", scope="read offline_access"'
    });
    expect(http.requests.map(r => r.url)).toEqual([
        'https://api.example.com/custom', 'https://dead.example.com/.well-known/oauth-authorization-server',
        'https://dead.example.com/.well-known/openid-configuration', 'https://auth.example.com/.well-known/oauth-authorization-server',
    ]);
    expect(result.resourceScopes).toEqual(['read', 'offline_access']);
    expect(result.server.tokenEndpoint).toBe(TEST_PROVIDER.tokenEndpoint);
});
test('path-bearing issuers explicitly opt into bare metadata fallback after inserted and appended candidates', async () => {
    const http = createFetchDouble([{ status: 404 }, { status: 404 }, { status: 404 },
        { json: { issuer: 'https://auth.example.com/tenant', token_endpoint: TEST_PROVIDER.tokenEndpoint } }]);
    const result = await fetchAuthorizationServerMetadata({
        guard, fetchFn: http.fetchFn, issuer: 'https://auth.example.com/tenant'
    }, { allowOriginFallback: true });
    expect(result.issuer).toBe('https://auth.example.com/tenant');
    expect(http.requests[3]!.url).toBe('https://auth.example.com/.well-known/oauth-authorization-server');
});

// REGRESSION: fails if reserved-parameter copy still interpolates productName instead of host messages.
test('hosts replace prose while required registration identity stays wire data', async () => {
    const pending = createPendingAuthorizationStore({ clock: createTestClock(), randomBytesFn: fixtureEntropy });
    const messages = { ...defaultOAuthMessages,
        reservedAuthorizationParameter: ({ parameter }: { parameter: string }) => `Host reserves ${parameter}`,
        registrationRejectedAction: 'Host registration recovery',
    };
    await expect(beginAuthorizationCode({ provider: TEST_PROVIDER, pending, randomBytesFn: fixtureEntropy,
        guard, options, ownerKey: 'owner', client: TEST_CLIENT, redirectUri: options.redirectUris[0]! },
        { extraAuthorizationParams: { state: 'override' }, messages }))
        .rejects.toMatchObject({ message: 'Host reserves state' });
    const http = createFetchDouble([{ status: 400, json: { error: 'invalid_client_metadata' } }]);
    await expect(registerOAuthClientDynamically({ guard, options, fetchFn: http.fetchFn,
        registrationEndpoint: 'https://auth.example.com/register', scopes: [] }, { messages }))
        .rejects.toMatchObject({ operatorAction: 'Host registration recovery' });
    expect(http.requests).toHaveLength(1);
});
