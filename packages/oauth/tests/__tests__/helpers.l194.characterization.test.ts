import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
    createFetchDouble, startDiscoveryFixture, type DiscoveryFixtureOptions,
} from '../helpers.js';

test('fetch double defaults an empty script and records omitted request options', async () => {
    const double = createFetchDouble([]);
    const response = await double.fetchFn({ url: new URL('https://example.com/token') });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(await response.json(), {});
    assert.deepEqual(double.requests, [{ url: 'https://example.com/token', method: 'GET', headers: {}, body: new URLSearchParams(), redirect: undefined }]);
    assert.equal(double.callCount(), 1);
});

test('fetch double records explicit options, gives raw text priority, and repeats the last response', async () => {
    const double = createFetchDouble([{ text: '', json: { ignored: true }, status: 202 }, { json: false, status: 203 }]);
    const init: RequestInit = { method: 'POST', headers: { authorization: 'Bearer test' }, body: 'scope=read&scope=write', redirect: 'error' };
    const response = await double.fetchFn({ url: 'https://example.com/token' }, init);
    assert.equal(response.status, 202);
    assert.equal(await response.text(), '');
    assert.deepEqual(double.requests[0], { url: 'https://example.com/token', method: 'POST', headers: { authorization: 'Bearer test' }, body: new URLSearchParams('scope=read&scope=write'), redirect: 'error' });
    for (let count = 0; count < 2; count += 1) {
        const repeated = await double.fetchFn({ url: 'https://example.com/token' }, { body: new URLSearchParams('ignored=yes') });
        assert.equal(repeated.status, 203);
        assert.equal(await repeated.json(), false);
        assert.equal(double.requests[count + 1]!.body.toString(), '');
    }
    assert.equal(double.callCount(), 3);
});

for (const json of [undefined, null, 0, ''] as const) {
    test(`fetch double preserves its JSON fallback for ${String(json)}`, async () => {
        const double = createFetchDouble([{ json }]);
        assert.deepEqual(await (await double.fetchFn({ url: 'https://example.com' })).json(), json ?? {});
    });
}

test('fetch double records a failed request before throwing the scripted error and repeats it', async () => {
    const failure = new Error('transport failed');
    const double = createFetchDouble([{ throws: failure, text: 'must not answer' }]);
    for (let count = 1; count <= 2; count += 1) {
        await assert.rejects(double.fetchFn({ url: 'https://example.com' }), (error: unknown) => error === failure);
        assert.equal(double.callCount(), count);
        assert.equal(double.requests.length, count);
    }
});

test('discovery fixture serves default metadata, both resource paths, challenge and missing routes', async () => {
    const fixture = await startDiscoveryFixture();
    try {
        assert.equal(fixture.resourceUrl, `${fixture.origin}/resource`);
        assert.equal(fixture.wwwAuthenticate, `Bearer resource_metadata="${fixture.origin}/.well-known/oauth-protected-resource/resource", scope="openid email offline_access"`);
        for (const path of ['/.well-known/oauth-protected-resource/resource?probe=1', '/.well-known/oauth-protected-resource']) {
            const response = await fetch(`${fixture.origin}${path}`);
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), { resource: fixture.resourceUrl, authorization_servers: [fixture.origin], scopes_supported: ['openid', 'email', 'offline_access'] });
        }
        const metadata = await fetch(`${fixture.origin}/.well-known/oauth-authorization-server`);
        assert.equal(metadata.status, 200);
        assert.deepEqual(await metadata.json(), {
            issuer: fixture.origin, authorization_endpoint: `${fixture.origin}/oauth2/authorize`,
            token_endpoint: `${fixture.origin}/oauth2/token`, registration_endpoint: `${fixture.origin}/oauth2/register`,
            grant_types_supported: ['authorization_code', 'refresh_token'], response_types_supported: ['code'],
            code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'none', 'client_secret_post'],
            scopes_supported: ['openid', 'email', 'offline_access'],
        });
        const resource = await fetch(fixture.resourceUrl);
        assert.equal(resource.status, 401);
        assert.equal(resource.headers.get('www-authenticate'), fixture.wwwAuthenticate);
        assert.deepEqual(await resource.json(), { error: 'unauthorized' });
        for (const path of ['/oauth2/token', '/missing']) {
            const missing = await fetch(`${fixture.origin}${path}`);
            assert.equal(missing.status, 404);
            assert.deepEqual(await missing.json(), { detail: 'Not Found' });
        }
    } finally { await fixture.close(); }
});

test('discovery fixture retains custom paths, empty scopes, dead issuers, metadata overrides and token replies', async () => {
    const fixture = await startDiscoveryFixture({ resourcePath: '/custom', resourceScopes: [], deadAuthorizationServers: ['https://dead.example'], metadata: { token_endpoint: null, extra: 'retained' }, token: { status: 202, json: { token_type: 'Bearer', access_token: 'issued' } } });
    try {
        const resource = await fetch(`${fixture.origin}/.well-known/oauth-protected-resource/custom`);
        assert.deepEqual(await resource.json(), { resource: fixture.resourceUrl, authorization_servers: ['https://dead.example', fixture.origin], scopes_supported: [] });
        const metadata: Record<string, unknown> = await (await fetch(`${fixture.origin}/.well-known/oauth-authorization-server`)).json();
        assert.equal(Object.hasOwn(metadata, 'token_endpoint'), false);
        assert.equal(metadata.extra, 'retained');
        assert.deepEqual(metadata.scopes_supported, []);
        const token = await fetch(`${fixture.origin}/oauth2/token?query=ignored`);
        assert.equal(token.status, 202);
        assert.deepEqual(await token.json(), { token_type: 'Bearer', access_token: 'issued' });
        const challenge = await fetch(fixture.resourceUrl);
        assert.equal(challenge.headers.get('www-authenticate'), fixture.wwwAuthenticate);
        assert.equal(fixture.wwwAuthenticate, `Bearer resource_metadata="${fixture.origin}/.well-known/oauth-protected-resource/custom", scope=""`);
    } finally { await fixture.close(); }
});

test('discovery fixture can suppress both protected metadata routes while retaining default token status', async () => {
    const fixture = await startDiscoveryFixture({ withoutProtectedResourceMetadata: true, token: { json: false } });
    try {
        for (const path of ['/.well-known/oauth-protected-resource/resource', '/.well-known/oauth-protected-resource']) {
            const response = await fetch(`${fixture.origin}${path}`);
            assert.equal(response.status, 404);
            assert.deepEqual(await response.json(), { detail: 'Not Found' });
        }
        const token = await fetch(`${fixture.origin}/oauth2/token`);
        assert.equal(token.status, 200);
        assert.equal(await token.json(), false);
    } finally { await fixture.close(); }
});

const registrationCases: readonly { name: string; options: DiscoveryFixtureOptions; status: number; expected: readonly unknown[] }[] = [
    { name: 'default registration', options: {}, status: 201, expected: [{ client_id: 'minted-client-id' }] },
    { name: 'configured registration', options: { registration: { status: 202, json: { client_id: 'configured' } } }, status: 202, expected: [{ client_id: 'configured' }] },
    { name: 'empty sequence falls back', options: { registrations: [], registration: { json: false } }, status: 201, expected: [false] },
    { name: 'null registration falls back', options: { registration: { json: null } }, status: 201, expected: [{ client_id: 'minted-client-id' }] },
    { name: 'sequence priority and null fallback', options: { registrations: [{ client_id: 'first' }, null, 0], registration: { json: { client_id: 'fallback' } } }, status: 201, expected: [{ client_id: 'first' }, { client_id: 'fallback' }, 0, 0] },
];
for (const { name, options, status, expected } of registrationCases) {
    test(`discovery fixture preserves ${name} and rejects invalid content types without consuming responses`, async () => {
        const fixture = await startDiscoveryFixture(options);
        try {
            const invalidHeaders: readonly Record<string, string>[] = [{}, { 'content-type': 'text/plain' }, { 'content-type': 'Application/JSON' }];
            for (const headers of invalidHeaders) {
                const rejected = await fetch(`${fixture.origin}/oauth2/register`, { method: 'POST', headers });
                assert.equal(rejected.status, 415);
                assert.deepEqual(await rejected.json(), { error: 'invalid_client_metadata' });
            }
            for (const json of expected) {
                const response = await fetch(`${fixture.origin}/oauth2/register`, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{}' });
                assert.equal(response.status, status);
                assert.deepEqual(await response.json(), json);
            }
            assert.equal(fixture.requests.length, 3 + expected.length);
        } finally { await fixture.close(); }
    });
}
