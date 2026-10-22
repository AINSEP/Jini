import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createSealedAuthorizationState, MAX_AUTHORIZATION_STATE_LENGTH, type AuthorizationStateCodec } from '../../src/sealed-state.js';
import { DEFAULT_TTL_MS, type PendingAuthorization } from '../../src/pending-authorizations.js';
import { assertOAuthRejects, createTestClock } from '../helpers.js';

const CONTEXT = { workspaceId: 'workspace', serverId: 'server' };
const ENTRY = { ownerKey: 'owner', providerId: 'provider', codeVerifier: 'a'.repeat(43),
    redirectUri: 'https://app.example.com/callback', scopes: ['read'] };
const CREATED_AT = '2026-08-25T12:00:00.000Z';
const EXP = Date.parse('2026-08-25T12:10:00.000Z');
const PAYLOAD = { ...ENTRY, ...CONTEXT, createdAt: CREATED_AT, exp: EXP };
const CALLBACK = { state: 'sealed-state', ownerKey: ENTRY.ownerKey, providerId: ENTRY.providerId, redirectUri: ENTRY.redirectUri };

function fixture({ plaintext = JSON.stringify(PAYLOAD), sealed = 'sealed-state', failure }: {
    plaintext?: string; sealed?: string; failure?: Error;
}, optionalArgs: { principalId?: string } = {}) {
    const clock = createTestClock(CREATED_AT);
    const seals: string[] = [];
    const opens: string[] = [];
    const codec: AuthorizationStateCodec = {
        async seal({ plaintext }) {
            seals.push(plaintext);
            if (failure) throw failure;
            return sealed;
        },
        async open({ state }) {
            opens.push(state);
            if (failure) throw failure;
            return plaintext;
        },
    };
    return { clock, seals, opens, state: createSealedAuthorizationState({ clock, codec, ...CONTEXT }, optionalArgs) };
}

test('sealed state issues the complete envelope and fixed ten-minute timestamps', async () => {
    const h = fixture({});
    const result = await h.state.seal({ entry: ENTRY });
    assert.deepEqual(JSON.parse(h.seals[0]!), PAYLOAD);
    assert.deepEqual(result, { ...ENTRY, state: 'sealed-state', createdAt: CREATED_AT, expiresAt: '2026-08-25T12:10:00.000Z' });
    assert.equal(EXP - Date.parse(CREATED_AT), DEFAULT_TTL_MS);
});

test('sealed state carries optional principal binding in both directions', async () => {
    const h = fixture({ plaintext: JSON.stringify({ ...PAYLOAD, principalId: 'principal' }) }, { principalId: 'principal' });
    await h.state.seal({ entry: ENTRY });
    assert.equal(JSON.parse(h.seals[0]!).principalId, 'principal');
    assert.equal((await h.state.open(CALLBACK)).ownerKey, ENTRY.ownerKey);
    const unbound = fixture({ plaintext: JSON.stringify({ ...PAYLOAD, principalId: 'principal' }) });
    await assertOAuthRejects(() => unbound.state.open(CALLBACK), 'OAUTH_INVALID_STATE');
    const missing = fixture({}, { principalId: 'principal' });
    await assertOAuthRejects(() => missing.state.open(CALLBACK), 'OAUTH_INVALID_STATE');
});

for (const resource of [undefined, '', 'https://api.example.com', [], ['one', 'two']] as const) {
    test(`sealed state preserves resource ${JSON.stringify(resource)} and drops unknown envelope fields`, async () => {
        const document = { ...PAYLOAD, resource, ignored: 'extra' };
        const h = fixture({ plaintext: JSON.stringify(document) });
        const result = await h.state.open(CALLBACK);
        const expected: PendingAuthorization = { ...ENTRY, state: CALLBACK.state,
            createdAt: CREATED_AT, expiresAt: '2026-08-25T12:10:00.000Z',
            ...(resource === undefined ? {} : { resource }) };
        assert.deepEqual(result, expected);
        assert.equal(Object.hasOwn(result, 'resource'), resource !== undefined);
        assert.deepEqual(h.opens, [CALLBACK.state]);
    });
}

const INVALID_DOCUMENTS: readonly { name: string; value: unknown }[] = [
    { name: 'null envelope', value: null },
    { name: 'false envelope', value: false },
    { name: 'string envelope', value: 'payload' },
    { name: 'array envelope', value: [] },
    { name: 'wrong workspace', value: { ...PAYLOAD, workspaceId: 'other' } },
    { name: 'wrong server', value: { ...PAYLOAD, serverId: 'other' } },
    { name: 'unexpected principal', value: { ...PAYLOAD, principalId: 'other' } },
    { name: 'non-string owner', value: { ...PAYLOAD, ownerKey: 12 } },
    { name: 'different owner of equal byte length', value: { ...PAYLOAD, ownerKey: 'other' } },
    { name: 'different owner of unequal byte length', value: { ...PAYLOAD, ownerKey: 'long-owner' } },
    { name: 'wrong provider', value: { ...PAYLOAD, providerId: 'other' } },
    { name: 'different callback path', value: { ...PAYLOAD, redirectUri: `${ENTRY.redirectUri}/` } },
    { name: 'missing expiry', value: { ...PAYLOAD, exp: undefined } },
    { name: 'string expiry', value: { ...PAYLOAD, exp: String(EXP) } },
    { name: 'fractional expiry', value: { ...PAYLOAD, exp: EXP + 0.5 } },
    { name: 'unsafe integer expiry', value: { ...PAYLOAD, exp: Number.MAX_SAFE_INTEGER + 1 } },
    { name: 'exact expiry deadline', value: { ...PAYLOAD, exp: Date.parse(CREATED_AT) } },
    { name: 'past expiry', value: { ...PAYLOAD, exp: Date.parse(CREATED_AT) - 1 } },
    { name: 'non-string verifier', value: { ...PAYLOAD, codeVerifier: null } },
    { name: 'non-string creation time', value: { ...PAYLOAD, createdAt: 12 } },
    { name: 'unparseable creation time', value: { ...PAYLOAD, createdAt: 'invalid' } },
    { name: 'non-array scopes', value: { ...PAYLOAD, scopes: 'read' } },
    { name: 'non-string scope', value: { ...PAYLOAD, scopes: ['read', 12] } },
    { name: 'null resource', value: { ...PAYLOAD, resource: null } },
    { name: 'object resource', value: { ...PAYLOAD, resource: {} } },
    { name: 'non-string resource item', value: { ...PAYLOAD, resource: ['one', 12] } },
];
for (const scenario of INVALID_DOCUMENTS) {
    test(`sealed state rejects ${scenario.name} with the same public error`, async () => {
        const h = fixture({ plaintext: JSON.stringify(scenario.value) });
        const error = await assertOAuthRejects(() => h.state.open(CALLBACK), 'OAUTH_INVALID_STATE');
        assert.equal(error.message, 'the authorization request could not be matched — it may have expired or already been used');
        assert.equal(error.operatorAction, 'Start the connection again from the connection settings.');
        assert.equal(error.cause, undefined);
        assert.deepEqual(h.opens, [CALLBACK.state]);
    });
}

test('sealed state accepts the last millisecond before expiry', async () => {
    const h = fixture({});
    h.clock.advance(DEFAULT_TTL_MS - 1);
    assert.equal((await h.state.open(CALLBACK)).expiresAt, '2026-08-25T12:10:00.000Z');
});

test('sealed state maps invalid JSON and codec authentication failures to invalid state', async () => {
    const malformed = fixture({ plaintext: '{' });
    await assertOAuthRejects(() => malformed.state.open(CALLBACK), 'OAUTH_INVALID_STATE');
    const failure = new Error('authentication failed');
    const h = fixture({ failure });
    const error = await assertOAuthRejects(() => h.state.open(CALLBACK), 'OAUTH_INVALID_STATE');
    assert.equal(error.cause, undefined);
    await assert.rejects(() => h.state.seal({ entry: ENTRY }), (actual: unknown) => actual === failure);
});

for (const length of [0, MAX_AUTHORIZATION_STATE_LENGTH + 1]) {
    test(`sealed state rejects length ${length} before codec open and after codec seal`, async () => {
        const h = fixture({ sealed: 'x'.repeat(length) });
        await assertOAuthRejects(() => h.state.open({ ...CALLBACK, state: 'x'.repeat(length) }), 'OAUTH_INVALID_STATE');
        assert.deepEqual(h.opens, []);
        await assertOAuthRejects(() => h.state.seal({ entry: ENTRY }), 'OAUTH_INVALID_STATE');
        assert.equal(h.seals.length, 1);
    });
}

for (const length of [1, MAX_AUTHORIZATION_STATE_LENGTH]) {
    test(`sealed state permits length ${length} on open and seal`, async () => {
        const state = 'x'.repeat(length);
        const h = fixture({ sealed: state });
        assert.equal((await h.state.seal({ entry: ENTRY })).state, state);
        assert.equal((await h.state.open({ ...CALLBACK, state })).state, state);
    });
}

test('sealed state preserves parseable non-ISO creation time, empty fields and repeat opens', async () => {
    const h = fixture({ plaintext: JSON.stringify({ ...PAYLOAD, createdAt: '2026-08-25', codeVerifier: '', scopes: [] }) });
    const result = await h.state.open(CALLBACK);
    assert.equal(result.createdAt, '2026-08-25');
    assert.equal(result.codeVerifier, '');
    assert.deepEqual(result.scopes, []);
    assert.deepEqual(await h.state.open(CALLBACK), result);
    assert.equal(h.opens.length, 2);
});

test('sealed state rejects a safe integer expiry outside the Date range', async () => {
    const h = fixture({ plaintext: JSON.stringify({ ...PAYLOAD, exp: Number.MAX_SAFE_INTEGER }) });
    await assertOAuthRejects(() => h.state.open(CALLBACK), 'OAUTH_INVALID_STATE');
});
