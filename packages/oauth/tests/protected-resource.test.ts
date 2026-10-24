import assert from 'node:assert/strict';
import { test } from 'vitest';
import { beginAuthorizationCode, completeAuthorizationCode, discoverAuthorizationServer, discoverProtectedResourceMetadata } from '../src/index.js';
import { createPendingAuthorizationStore } from '../src/testing/index.js';
import { fixturePorts } from './fixtures.js';
import { assertOAuthRejects, createFetchDouble, TEST_CLIENT, TEST_PROVIDER } from './helpers.js';

const ORIGIN = 'https://resource.example.com';

test('root metadata after a path 404 supplies the audience for authorization and code exchange', async () => {
    const requests: string[] = [];
    const discovered = await discoverAuthorizationServer({ ...fixturePorts, resourceUrl: `${ORIGIN}/mcp`,
        fetchFn: async ({ url }) => {
            requests.push(String(url));
            // Hosted resources may publish only root metadata; the path's HTML is not malformed metadata.
            if (String(url) === `${ORIGIN}/.well-known/oauth-protected-resource/mcp`)
                return new Response('<html>Not found</html>', { status: 404, headers: { 'content-type': 'text/html' } });
            if (String(url) === `${ORIGIN}/.well-known/oauth-protected-resource`)
                return Response.json({ resource: ORIGIN, authorization_servers: ['https://auth.example.com'], scopes_supported: ['email'] });
            return Response.json({ issuer: 'https://auth.example.com',
                authorization_endpoint: TEST_PROVIDER.authorizationEndpoint, token_endpoint: TEST_PROVIDER.tokenEndpoint });
        },
    });
    assert.deepEqual(requests, [
        `${ORIGIN}/.well-known/oauth-protected-resource/mcp`, `${ORIGIN}/.well-known/oauth-protected-resource`,
        'https://auth.example.com/.well-known/oauth-authorization-server',
    ]);
    assert.equal(discovered.resource, ORIGIN);
    assert.deepEqual(discovered.resourceScopes, ['email']);
    assert.ok(discovered.resource);
    const redirectUri = 'https://client.example.com/callback';
    const pending = createPendingAuthorizationStore(fixturePorts);
    const provider = { ...TEST_PROVIDER, authorizationEndpoint: discovered.server.authorizationEndpoint!, tokenEndpoint: discovered.server.tokenEndpoint };
    const started = await beginAuthorizationCode({ ...fixturePorts, provider, pending,
        options: { ...fixturePorts.options, redirectUris: [redirectUri] },
        ownerKey: 'owner', client: TEST_CLIENT, redirectUri,
    }, { resource: discovered.resource, scopes: discovered.resourceScopes });
    assert.deepEqual(new URL(started.authorizationUrl).searchParams.getAll('resource'), [ORIGIN]);
    const token = createFetchDouble([{ json: { token_type: 'Bearer', access_token: 'fixture-access' } }]);
    await completeAuthorizationCode({ ...fixturePorts, provider, pending, fetchFn: token.fetchFn,
        ownerKey: 'owner', client: TEST_CLIENT, params: { state: started.state, code: 'fixture-code' } });
    assert.deepEqual(token.requests[0]?.body.getAll('resource'), [ORIGIN]);
});

for (const resource of [`${ORIGIN}/api/mcp`, `${ORIGIN}/api`, `${ORIGIN}/api/`]) {
    test(`protected resource discovery accepts the exact or parent identifier ${resource}`, async () => {
        const http = createFetchDouble([{ json: { resource, authorization_servers: ['https://auth.example.com'] } }]);
        assert.deepEqual(await discoverProtectedResourceMetadata({ ...fixturePorts, fetchFn: http.fetchFn, resourceUrl: `${ORIGIN}/api/mcp` }), {
            resource, authorizationServers: ['https://auth.example.com'], scopesSupported: [],
        });
        assert.equal(http.callCount(), 1);
    });
}

for (const resource of ['https://other.example.com/api', `${ORIGIN}:8443/api`, `${ORIGIN}/other`, `${ORIGIN}/api/mcp-extra`, `${ORIGIN}/api/mcp/`]) {
    test(`protected resource discovery refuses an unrelated origin or path ${resource}`, async () => {
        const http = createFetchDouble([{ json: { resource } }]);
        const error = await assertOAuthRejects(() => discoverAuthorizationServer({ ...fixturePorts, fetchFn: http.fetchFn,
            resourceUrl: `${ORIGIN}/api/mcp`,
        }), 'OAUTH_RESOURCE_MISMATCH');
        assert.equal(error.message, 'the protected resource metadata names a different server or path');
        assert.equal(error.retryable, false);
        assert.equal(error.cause, undefined);
        // A bad binding is terminal: no root fallback or authorization-server request can hide it.
        assert.equal(http.callCount(), 1);
    });
}

test('a resource identifier that is only a character prefix is refused', async () => {
    const http = createFetchDouble([{ json: { resource: `${ORIGIN}/api` } }]);
    await assertOAuthRejects(() => discoverProtectedResourceMetadata({ ...fixturePorts, fetchFn: http.fetchFn,
        resourceUrl: `${ORIGIN}/api-other/mcp`,
    }), 'OAUTH_RESOURCE_MISMATCH');
    assert.equal(http.callCount(), 1);
});

test('an invalid advertised resource URL remains a terminal malformed response', async () => {
    const http = createFetchDouble([{ json: { resource: 'not an absolute URL' } }]);
    const error = await assertOAuthRejects(() => discoverProtectedResourceMetadata({ ...fixturePorts, fetchFn: http.fetchFn,
        resourceUrl: `${ORIGIN}/mcp`,
    }), 'OAUTH_MALFORMED_RESPONSE');
    assert.equal(error.message, 'the protected resource metadata contains an invalid resource URL');
    assert.equal(http.callCount(), 1);
});
