import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { test } from 'vitest';
import {
    createOAuthUrlGuard, OAuthError, requestOAuthToken, revokeOAuthToken, validateOidcIdToken,
    type OAuthFetch, type OAuthTokenSet,
} from '../src/index.js';
import { fixtureFetch, fixtureGuard } from './fixtures.js';
import {
    assertOAuthRejects, createFetchDouble, createTestClock, sendJson, startLoopbackServer, TEST_CLIENT,
} from './helpers.js';

// Keys and compact JWTs are generated per fixture; no credential material lives in source.
function createSigner() {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
        privateKey: pair.privateKey,
        jwk: { ...pair.publicKey.export({ format: 'jwk' }), kid: 'fixture-key', alg: 'RS256', use: 'sig' },
    };
}

function signedIdToken({ privateKey, claims, header = {} }: {
    readonly privateKey: KeyObject;
    readonly claims: Readonly<Record<string, unknown>>;
    readonly header?: Readonly<Record<string, unknown>>;
}): string {
    const encoded = [
        { alg: 'RS256', kid: 'fixture-key', ...header }, claims,
    ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    return `${encoded}.${sign('RSA-SHA256', Buffer.from(encoded), privateKey).toString('base64url')}`;
}

const clock = createTestClock();
const epoch = Math.floor(clock.nowMs() / 1000);
const baseTokens: OAuthTokenSet = {
    accessToken: 'fixture-access', refreshToken: null, tokenType: 'Bearer', scopes: [], expiresAt: null,
};

async function oidcFixture(options: {
    readonly claims?: Readonly<Record<string, unknown>>;
    readonly wrongSignature?: boolean;
    readonly header?: Readonly<Record<string, unknown>>;
    readonly jwksStatus?: number;
    readonly jwksText?: string;
} = {}) {
    const signer = createSigner();
    let token = '';
    const server = await startLoopbackServer((req, res) => {
        if (req.url === '/token') {
            sendJson(res, 200, { access_token: baseTokens.accessToken, token_type: 'Bearer', id_token: token });
        } else if (req.url === '/jwks') {
            if (options.jwksStatus === 302) {
                res.writeHead(302, { location: '/unexpected' });
                res.end();
            } else if (options.jwksText !== undefined) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(options.jwksText);
            } else sendJson(res, 200, { keys: [signer.jwk] });
        } else sendJson(res, 404, {});
    });
    const issuer = `${server.origin}/trusted-issuer`;
    token = signedIdToken({
        privateKey: options.wrongSignature ? createSigner().privateKey : signer.privateKey,
        claims: { iss: issuer, sub: 'fixture-subject', aud: TEST_CLIENT.clientId, iat: epoch,
            exp: epoch + 300, nonce: 'fixture-nonce', ...options.claims },
        header: options.header ?? {},
    });
    return { ...server, token, input: {
        fetchFn: fixtureFetch, guard: fixtureGuard, clock,
        issuer, jwksUri: `${server.origin}/jwks`, clientId: TEST_CLIENT.clientId,
        expectedNonce: 'fixture-nonce', tokens: { ...baseTokens, idToken: token },
    } };
}

test('a token response retains the ID token; identity requires explicit trusted metadata and a JWKS signature', async () => {
    const server = await oidcFixture();
    try {
        const tokens = await requestOAuthToken({
            fetchFn: fixtureFetch, guard: fixtureGuard, clock, client: TEST_CLIENT,
            tokenEndpoint: `${server.origin}/token`, params: { grant_type: 'authorization_code', code: 'fixture-code' },
        });
        assert.deepEqual(tokens, { ...baseTokens, idToken: server.token });
        assert.deepEqual(server.requests.map(request => request.url), ['/token']);
        const calls: { url: string; init: RequestInit | undefined }[] = [];
        const fetchFn: OAuthFetch = ({ url }, init) => {
            calls.push({ url: String(url), init });
            return fixtureFetch({ url }, init);
        };
        const claims = await validateOidcIdToken({ ...server.input, tokens, fetchFn });
        assert.equal(claims.iss, server.input.issuer);
        assert.equal(claims.sub, 'fixture-subject');
        assert.equal(claims.aud, TEST_CLIENT.clientId);
        assert.deepEqual(server.requests.map(request => request.url), ['/token', '/jwks']);
        assert.equal(calls[0]?.init?.redirect, 'error');
        assert.ok(calls[0]?.init?.signal instanceof AbortSignal);
    } finally { await server.close(); }
});

for (const [name, claims] of [
    ['issuer', { iss: 'https://different.example/issuer' }],
    ['audience', { aud: 'different-client' }],
    ['nonce', { nonce: 'different-nonce' }],
    ['missing nonce', { nonce: undefined }],
    ['expiry', { exp: epoch - 1 }],
    ['not before', { nbf: epoch + 300 }],
    ['missing subject', { sub: undefined }],
    ['authorized party', { aud: [TEST_CLIENT.clientId, 'other-client'], azp: 'other-client' }],
] as const) {
    test(`OIDC refuses a wrong ${name} without exposing token claims or upstream causes`, async () => {
        const server = await oidcFixture({ claims });
        try {
            const error = await assertOAuthRejects(() => validateOidcIdToken(server.input), 'OAUTH_MALFORMED_RESPONSE');
            assert.equal(error.message, 'the OpenID Connect ID token could not be validated');
            assert.equal(error.cause, undefined);
            assert.equal(JSON.stringify(error).includes(server.token), false);
            assert.deepEqual(server.requests, [], 'claim failures precede JWKS I/O');
        } finally { await server.close(); }
    });
}

test('OIDC checks the signature even when all claims match', async () => {
    const server = await oidcFixture({ wrongSignature: true });
    try {
        await assertOAuthRejects(() => validateOidcIdToken(server.input), 'OAUTH_MALFORMED_RESPONSE');
        assert.deepEqual(server.requests.map(request => request.url), ['/jwks']);
    } finally { await server.close(); }
});

test('OIDC pins RS256 by default instead of trusting a token-selected algorithm', async () => {
    const server = await oidcFixture({ header: { alg: 'PS256' } });
    try {
        await assertOAuthRejects(() => validateOidcIdToken(server.input), 'OAUTH_MALFORMED_RESPONSE');
        assert.deepEqual(server.requests, []);
    } finally { await server.close(); }
});

test('OIDC delegates max_age and clock leeway to the claim processor', async () => {
    const server = await oidcFixture({ claims: { exp: epoch - 1, auth_time: epoch - 120 } });
    try {
        assert.equal((await validateOidcIdToken(server.input, { clockToleranceSeconds: 2 })).sub, 'fixture-subject');
        await assertOAuthRejects(() => validateOidcIdToken(server.input,
            { clockToleranceSeconds: 2, maxAgeSeconds: 60 }), 'OAUTH_MALFORMED_RESPONSE');
        assert.equal(server.requests.length, 1, 'the max_age failure must precede another JWKS request');
    } finally { await server.close(); }
});

test('OIDC refuses an omitted nonce expectation instead of silently skipping nonce checks', async () => {
    const server = await oidcFixture();
    try {
        const { expectedNonce: _nonce, ...missingExpectation } = server.input;
        // Model an untyped caller; the public TypeScript contract also rejects this omission.
        // @ts-expect-error expectedNonce must be supplied, including explicit null for no nonce.
        await assertOAuthRejects(() => validateOidcIdToken(missingExpectation), 'OAUTH_INVALID_REQUEST');
        assert.deepEqual(server.requests, []);
    } finally { await server.close(); }
});

test('OIDC fetches only the configured JWKS, ignoring a token-provided jku', async () => {
    const server = await oidcFixture({ header: { jku: 'http://169.254.169.254/keys' } });
    try {
        assert.equal((await validateOidcIdToken(server.input)).sub, 'fixture-subject');
        assert.deepEqual(server.requests.map(request => request.url), ['/jwks']);
    } finally { await server.close(); }
});

test('nonce absence must be explicit and refuses a token containing a nonce', async () => {
    const server = await oidcFixture({ claims: { nonce: undefined } });
    try {
        const input = { ...server.input, expectedNonce: null };
        assert.equal((await validateOidcIdToken(input)).sub, 'fixture-subject');
        await assertOAuthRejects(() => validateOidcIdToken({ ...input, tokens: baseTokens }), 'OAUTH_MALFORMED_RESPONSE');
        const withNonce = signedIdToken({ privateKey: createSigner().privateKey, claims: {
            iss: input.issuer, sub: 'fixture-subject', aud: TEST_CLIENT.clientId,
            iat: epoch, exp: epoch + 300, nonce: 'unexpected-nonce',
        } });
        await assertOAuthRejects(() => validateOidcIdToken({ ...input,
            tokens: { ...baseTokens, idToken: withNonce } }), 'OAUTH_MALFORMED_RESPONSE');
        assert.equal(server.requests.length, 1);
    } finally { await server.close(); }
});

for (const options of [{ jwksStatus: 302 }, { jwksText: 'x'.repeat(65_537) }]) {
    test(`JWKS ${options.jwksStatus === 302 ? 'redirects' : 'oversized bodies'} fail through guarded transport`, async () => {
        const server = await oidcFixture(options);
        try {
            await assertOAuthRejects(() => validateOidcIdToken(server.input),
                options.jwksStatus === 302 ? 'OAUTH_PROVIDER_UNREACHABLE' : 'OAUTH_MALFORMED_RESPONSE');
            assert.deepEqual(server.requests.map(request => request.url), ['/jwks']);
        } finally { await server.close(); }
    });
}

test('an unsafe JWKS URI is refused before transport', async () => {
    const http = createFetchDouble([]);
    await assertOAuthRejects(() => validateOidcIdToken({
        ...baseOidcInput(http.fetchFn), jwksUri: 'http://169.254.169.254/keys',
    }), 'OAUTH_UNSAFE_ENDPOINT');
    assert.equal(http.callCount(), 0);
});

test('JWKS retrieval rechecks endpoint policy in customFetch and retains a denial', async () => {
    const server = await oidcFixture();
    try {
        let checks = 0;
        const refusal = new OAuthError({ code: 'OAUTH_UNSAFE_ENDPOINT', message: 'fixture-egress-refusal', operatorAction: 'Stop.' });
        const guard = createOAuthUrlGuard({ assertAllowed({ label }) {
            if (label === 'JWKS endpoint' && ++checks === 2) throw refusal;
        } }, { allowLoopbackHttp: true });
        await assert.rejects(() => validateOidcIdToken({ ...server.input, guard }), error => error === refusal);
        assert.equal(checks, 2);
        assert.deepEqual(server.requests, []);
    } finally { await server.close(); }
});

function baseOidcInput(fetchFn: OAuthFetch) {
    return { fetchFn, guard: fixtureGuard, clock, issuer: 'https://issuer.example',
        jwksUri: 'https://issuer.example/keys', clientId: TEST_CLIENT.clientId,
        expectedNonce: 'fixture-nonce', tokens: { ...baseTokens, idToken: 'fixture-invalid-jwt' } };
}

for (const authMethod of ['none', 'client_secret_post', 'client_secret_basic'] as const) {
    test(`RFC 7009 uses guarded transport with ${authMethod} and accepts an empty HTTP 200`, async () => {
        const server = await startLoopbackServer((_req, res) => { res.writeHead(200); res.end(); });
        try {
            const client = { clientId: 'fixture client:/+', clientSecret: 'fixture secret:/+', authMethod };
            const calls: (RequestInit | undefined)[] = [];
            const fetchFn: OAuthFetch = (args, init) => { calls.push(init); return fixtureFetch(args, init); };
            await revokeOAuthToken({ fetchFn, guard: fixtureGuard,
                revocationEndpoint: `${server.origin}/revoke`, client, token: 'fixture-refresh',
            }, { tokenTypeHint: 'refresh_token' });
            assert.equal(server.requests.length, 1);
            const request = server.requests[0]!;
            const body = new URLSearchParams(request.body);
            assert.equal(request.method, 'POST');
            assert.equal(request.url, '/revoke');
            assert.equal(body.get('token'), 'fixture-refresh');
            assert.equal(body.get('token_type_hint'), 'refresh_token');
            assert.equal(body.get('client_secret'), authMethod === 'client_secret_post' ? client.clientSecret : null);
            assert.equal(body.get('client_id'), authMethod === 'client_secret_basic' ? null : client.clientId);
            assert.equal(request.headers.authorization, authMethod === 'client_secret_basic'
                ? `Basic ${Buffer.from('fixture+client%3A%2F%2B:fixture+secret%3A%2F%2B').toString('base64')}` : undefined);
            assert.equal(calls[0]?.redirect, 'error');
            assert.ok(calls[0]?.signal instanceof AbortSignal);
        } finally { await server.close(); }
    });
}

test('revocation success ignores the response body, including unknown-token responses', async () => {
    const http = createFetchDouble([{ text: 'provider-specific-success-body' }]);
    await revokeOAuthToken({ fetchFn: http.fetchFn, guard: fixtureGuard,
        revocationEndpoint: 'https://issuer.example/revoke', client: TEST_CLIENT, token: 'fixture-unknown',
    });
    assert.equal(http.callCount(), 1);
    assert.equal(http.requests[0]?.body.has('token_type_hint'), false);
});

for (const status of [204, 400, 503]) {
    test(`revocation HTTP ${status} is not confirmation and never exposes provider text`, async () => {
        const server = await startLoopbackServer((_req, res) => {
            if (status === 204) { res.writeHead(status); res.end(); }
            else sendJson(res, status, { error: 'unsupported_token_type', error_description: 'fixture-private-detail' });
        });
        try {
            const error = await assertOAuthRejects(() => revokeOAuthToken({ fetchFn: fixtureFetch, guard: fixtureGuard,
                revocationEndpoint: `${server.origin}/revoke`, client: TEST_CLIENT, token: 'fixture-refresh',
            }), 'OAUTH_PROVIDER_REJECTED');
            assert.equal(error.cause, undefined);
            assert.equal(JSON.stringify(error).includes('fixture-private-detail'), false);
            assert.equal(server.requests.length, 1, 'the host owns revocation retries');
        } finally { await server.close(); }
    });
}

test('revocation refuses redirects without following them', async () => {
    const server = await startLoopbackServer((_req, res) => {
        res.writeHead(302, { location: '/unexpected' }); res.end();
    });
    try {
        await assertOAuthRejects(() => revokeOAuthToken({ fetchFn: fixtureFetch, guard: fixtureGuard,
            revocationEndpoint: `${server.origin}/revoke`, client: TEST_CLIENT, token: 'fixture-refresh',
        }), 'OAUTH_PROVIDER_UNREACHABLE');
        assert.equal(server.requests.length, 1);
    } finally { await server.close(); }
});

test('revocation bounds successful bodies before the library ignores them', async () => {
    const http = createFetchDouble([{ text: 'x'.repeat(65_537) }]);
    await assertOAuthRejects(() => revokeOAuthToken({ fetchFn: http.fetchFn, guard: fixtureGuard,
        revocationEndpoint: 'https://issuer.example/revoke', client: TEST_CLIENT, token: 'fixture-refresh',
    }), 'OAUTH_MALFORMED_RESPONSE');
    assert.equal(http.callCount(), 1);
});

test('a policy denial prevents revocation and retains the facade error', async () => {
    const refusal = new OAuthError({ code: 'OAUTH_UNSAFE_ENDPOINT', message: 'fixture-policy-refusal', operatorAction: 'Stop.' });
    const guard = createOAuthUrlGuard({ assertAllowed() { throw refusal; } });
    const http = createFetchDouble([]);
    await assert.rejects(() => revokeOAuthToken({ fetchFn: http.fetchFn, guard,
        revocationEndpoint: 'https://issuer.example/revoke', client: TEST_CLIENT, token: 'fixture-refresh',
    }), error => error === refusal);
    assert.equal(http.callCount(), 0);
});

test('revocation rechecks policy in customFetch and preserves an adapter refusal', async () => {
    const http = createFetchDouble([]);
    let checks = 0;
    const refusal = new OAuthError({ code: 'OAUTH_UNSAFE_ENDPOINT', message: 'fixture-egress-refusal', operatorAction: 'Stop.' });
    const guard = createOAuthUrlGuard({ assertAllowed() { if (++checks === 2) throw refusal; } });
    await assert.rejects(() => revokeOAuthToken({ fetchFn: http.fetchFn, guard,
        revocationEndpoint: 'https://issuer.example/revoke', client: TEST_CLIENT, token: 'fixture-refresh',
    }), error => error === refusal);
    assert.equal(checks, 2);
    assert.equal(http.callCount(), 0);
});

/** A port which stalls until the adapter's deadline aborts, then releases its only listener. */
const waitForDeadline: OAuthFetch = async (_args, init) => {
    const signal = init?.signal;
    assert.ok(signal);
    signal.throwIfAborted();
    return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
};

test('revocation applies the adapter deadline without retrying or returning confirmation', async () => {
    await assertOAuthRejects(() => revokeOAuthToken({ fetchFn: waitForDeadline, guard: fixtureGuard,
        revocationEndpoint: 'https://issuer.example/revoke', client: TEST_CLIENT, token: 'fixture-refresh',
    }, { timeoutMs: 5 }), 'OAUTH_PROVIDER_UNREACHABLE');
});

test('JWKS retrieval applies the adapter deadline before exposing identity claims', async () => {
    const server = await oidcFixture();
    try {
        await assertOAuthRejects(() => validateOidcIdToken({ ...server.input, fetchFn: waitForDeadline },
            { timeoutMs: 5 }), 'OAUTH_PROVIDER_UNREACHABLE');
        assert.deepEqual(server.requests, []);
    } finally { await server.close(); }
});

test('an empty token is refused as an invalid request before anything is sent', async () => {
    const http = createFetchDouble([]);
    const error = await assertOAuthRejects(() => revokeOAuthToken({ fetchFn: http.fetchFn, guard: fixtureGuard,
        revocationEndpoint: 'https://issuer.example/revoke', client: TEST_CLIENT, token: '',
    }), 'OAUTH_INVALID_REQUEST');
    assert.equal(error.message, 'the OAuth revocation or client configuration is invalid');
    assert.equal(error.operatorAction, 'Check the client identity, authentication method and token.');
    assert.equal(error.cause, undefined);
    assert.equal(http.callCount(), 0);
});
