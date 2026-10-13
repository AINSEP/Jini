import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { AesGcmSecretSealer, formatAad } from '@jini-ai/platform/secrets';
import { InMemoryKeyring } from '@jini-ai/platform/secrets/testing';
import { beginAuthorizationCode, completeAuthorizationCode, createSealedAuthorizationState,
    MAX_AUTHORIZATION_STATE_LENGTH, type AuthorizationStateCodec } from '../src/index.js';
import { fixturePorts } from './fixtures.js';
import { assertOAuthRejects, createFetchDouble, createTestClock, TEST_CLIENT, TEST_PROVIDER } from './helpers.js';

const REDIRECT_URI = 'https://example.example.com/callback/server';
const CONTEXT = { workspaceId: 'workspace', serverId: 'server' };
const ENTRY = { ownerKey: 'workspace:server', providerId: TEST_PROVIDER.providerId,
    codeVerifier: 'a'.repeat(43), redirectUri: REDIRECT_URI, scopes: ['read'] };

function harness() {
    const clock = createTestClock();
    const keyring = new InMemoryKeyring({ hkdfSalt: 'oauth-sealed-state-test' });
    const sealer = new AesGcmSecretSealer({ keyring });
    const aad = formatAad({ kind: 'oauth-redirect-state', version: 'v1', parts: [JSON.stringify(Object.values(CONTEXT))] });
    const codec: AuthorizationStateCodec = {
        async seal({ plaintext }) {
            return Buffer.from(JSON.stringify(await sealer.seal({ plaintext, key: await keyring.activeKey({}), aad }))).toString('base64url');
        },
        async open({ state }) {
            return sealer.open({ sealed: JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) }, { aad });
        },
    };
    const stateless = createSealedAuthorizationState({ clock, codec, ...CONTEXT });
    const http = createFetchDouble([{ json: { access_token: 'at', token_type: 'Bearer' } }]);
    return { clock, codec, stateless, http };
}

async function begin(h: ReturnType<typeof harness>) {
    return beginAuthorizationCode({ ...fixturePorts, provider: TEST_PROVIDER, stateless: h.stateless,
        options: { ...fixturePorts.options, redirectUris: [REDIRECT_URI] },
        ownerKey: ENTRY.ownerKey, client: TEST_CLIENT, redirectUri: REDIRECT_URI }, { scopes: ['read'], resource: 'https://api.example.com' });
}
function complete(h: ReturnType<typeof harness>, state: string) {
    return completeAuthorizationCode({ ...fixturePorts, clock: h.clock, fetchFn: h.http.fetchFn,
        provider: TEST_PROVIDER, stateless: h.stateless, redirectUri: REDIRECT_URI,
        ownerKey: ENTRY.ownerKey, client: TEST_CLIENT, params: { state, code: 'single-use-code' } });
}

test('stateless mode round trips through real GCM after recreating the state owner', async () => {
    const h = harness();
    const started = await begin(h);
    assert.ok(started.state.length > 256 && started.state.length <= MAX_AUTHORIZATION_STATE_LENGTH);
    assert.equal(started.expiresAt, '2026-08-25T12:10:00.000Z');
    const payload = JSON.parse(await h.codec.open({ state: started.state }));
    assert.equal(payload.workspaceId, CONTEXT.workspaceId);
    assert.equal(payload.serverId, CONTEXT.serverId);
    assert.equal(payload.providerId, TEST_PROVIDER.providerId);
    assert.equal(payload.redirectUri, REDIRECT_URI);
    assert.equal(payload.exp, h.clock.nowMs() + 600_000);
    assert.equal(payload.principalId, undefined);
    assert.ok(!started.authorizationUrl.includes(payload.codeVerifier));
    h.stateless = createSealedAuthorizationState({ clock: h.clock, codec: h.codec, ...CONTEXT });
    assert.equal((await complete(h, started.state)).accessToken, 'at');
    const request = h.http.requests[0]!;
    assert.equal(request.body.get('redirect_uri'), REDIRECT_URI);
    assert.equal(request.body.get('resource'), 'https://api.example.com');
    assert.equal(createHash('sha256').update(request.body.get('code_verifier')!).digest('base64url'),
        new URL(started.authorizationUrl).searchParams.get('code_challenge'));
});

test('expiry rejects the exact ten-minute deadline before the token endpoint', async () => {
    const h = harness();
    const started = await begin(h);
    h.clock.advance(600_000);
    await assertOAuthRejects(() => complete(h, started.state), 'OAUTH_INVALID_STATE');
    assert.equal(h.http.callCount(), 0);
});

test('workspace, server, provider, owner and exact callback URI must all match', async () => {
    const h = harness();
    const { state } = await h.stateless.seal({ entry: ENTRY });
    const expected = { state, ownerKey: ENTRY.ownerKey, providerId: ENTRY.providerId, redirectUri: REDIRECT_URI };
    for (const context of [{ ...CONTEXT, workspaceId: 'other' }, { ...CONTEXT, serverId: 'other' }]) {
        const other = createSealedAuthorizationState({ clock: h.clock, codec: h.codec, ...context });
        await assertOAuthRejects(() => other.open(expected), 'OAUTH_INVALID_STATE');
    }
    for (const mismatch of [{ ownerKey: 'other:server' }, { providerId: 'other-provider' }, { redirectUri: `${REDIRECT_URI}/` }]) {
        await assertOAuthRejects(() => h.stateless.open({ ...expected, ...mismatch }), 'OAUTH_INVALID_STATE');
    }
    assert.equal((await h.stateless.open(expected)).codeVerifier, ENTRY.codeVerifier);
});

test('optional existing principal binding is preserved without inventing one for other hosts', async () => {
    const h = harness();
    const bound = createSealedAuthorizationState({ clock: h.clock, codec: h.codec, ...CONTEXT }, { principalId: 'principal' });
    const { state } = await bound.seal({ entry: ENTRY });
    const expected = { state, ownerKey: ENTRY.ownerKey, providerId: ENTRY.providerId, redirectUri: REDIRECT_URI };
    await assertOAuthRejects(() => h.stateless.open(expected), 'OAUTH_INVALID_STATE');
    assert.equal((await bound.open(expected)).ownerKey, ENTRY.ownerKey);
});

test('tampered ciphertext and malformed envelopes cannot reach exchange', async () => {
    const h = harness();
    const started = await begin(h);
    const envelope = JSON.parse(Buffer.from(started.state, 'base64url').toString('utf8'));
    const bytes = Buffer.from(envelope.ciphertext, 'base64');
    bytes[0] = bytes[0]! ^ 1;
    envelope.ciphertext = bytes.toString('base64');
    const tampered = Buffer.from(JSON.stringify(envelope)).toString('base64url');
    for (const state of [tampered, 'malformed', Buffer.from('{}').toString('base64url')]) {
        await assertOAuthRejects(() => complete(h, state), 'OAUTH_INVALID_STATE');
    }
    assert.equal(h.http.callCount(), 0);
});

test('oversize callback state is rejected before opening; oversize sealed output cannot be issued', async () => {
    const h = harness();
    let opens = 0;
    h.stateless = createSealedAuthorizationState({ clock: h.clock, ...CONTEXT, codec: {
        seal: async () => 'x'.repeat(MAX_AUTHORIZATION_STATE_LENGTH + 1),
        open: async () => { opens++; throw new Error('must not open'); },
    } });
    await assertOAuthRejects(() => complete(h, 'x'.repeat(MAX_AUTHORIZATION_STATE_LENGTH + 1)), 'OAUTH_INVALID_STATE');
    await assertOAuthRejects(() => begin(h), 'OAUTH_INVALID_STATE');
    assert.equal(opens, 0);
    assert.equal(h.http.callCount(), 0);
});

test('stateless replay reaches the provider which refuses an already-used code without retries', async () => {
    const h = harness();
    const started = await begin(h);
    const usedCodes = new Set<string>();
    let exchanges = 0;
    h.http = { ...h.http, fetchFn: async (_input, init) => {
        exchanges++;
        const code = new URLSearchParams(String(init?.body)).get('code')!;
        const replay = usedCodes.has(code);
        usedCodes.add(code);
        return new Response(JSON.stringify(replay ? { error: 'invalid_grant' } : { access_token: 'at' }), { status: replay ? 400 : 200 });
    } };
    assert.equal((await complete(h, started.state)).accessToken, 'at');
    await assertOAuthRejects(() => complete(h, started.state), 'OAUTH_INVALID_GRANT');
    assert.equal(exchanges, 2);
});
