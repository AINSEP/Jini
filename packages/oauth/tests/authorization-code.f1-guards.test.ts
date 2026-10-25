/**
 * F1 fix wave (Stryker L1 §4 oauth/authorization-code.ts:101,161,184): redirect-URI allowlist with
 * ≥2 registered URIs, callback `state` empty / MAX / MAX+1, and empty `code`. Each refusal asserts
 * the specific OAuthError code and message, and that no token request was sent.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { beginAuthorizationCode, completeAuthorizationCode } from "../src/index.js";
import { MAX_AUTHORIZATION_STATE_LENGTH } from "../src/sealed-state.js";
import { createPendingAuthorizationStore } from "../src/testing/index.js";
import { fixturePorts, fixtureEntropy } from "./fixtures.js";
import { assertOAuthRejects, createFetchDouble, createTestClock, TEST_CLIENT, TEST_PROVIDER } from "./helpers.js";

const A = "https://a.example.com/cb";
const B = "https://b.example.com/cb";
const C = "https://c.example.com/cb";

function flow() {
    const clock = createTestClock();
    const pending = createPendingAuthorizationStore({ randomBytesFn: fixtureEntropy, clock });
    return { clock, pending, provider: { ...TEST_PROVIDER } };
}
function begin(redirectUris: string[], redirectUri: string, f = flow()) {
    return beginAuthorizationCode({ ...fixturePorts, options: { ...fixturePorts.options, redirectUris }, provider: f.provider, pending: f.pending, ownerKey: "ws:1", client: TEST_CLIENT, redirectUri });
}

for (const [label, uris, target] of [
    ["first of three", [A, B, C], A],
    ["middle of three", [A, B, C], B],
    ["last of three", [A, B, C], C],
] as const) {
    test(`F1: a redirect URI registered as the ${label} is accepted (some, not every)`, async () => {
        const started = await begin([...uris], target);
        assert.equal(new URL(started.authorizationUrl).searchParams.get("redirect_uri"), target);
    });
}

for (const [label, candidate] of [
    ["unregistered host", "https://evil.example.com/cb"],
    ["registered host, different path", "https://a.example.com/cb2"],
    ["registered URI plus a query", "https://a.example.com/cb?x=1"],
    ["registered host as a subdomain prefix", "https://a.example.com.evil.com/cb"],
] as const) {
    test(`F1: ${label} is refused even with several URIs registered`, async () => {
        const error = await assertOAuthRejects(() => begin([A, B, C], candidate), "OAUTH_INVALID_REQUEST");
        assert.equal(error.message, "redirect URI is not in the configured client identity");
    });
}

test("F1: an empty redirect allow-list refuses everything", async () => {
    const error = await assertOAuthRejects(() => begin([], A), "OAUTH_INVALID_REQUEST");
    assert.equal(error.message, "redirect URI is not in the configured client identity");
});

async function complete(params: { state: string; code?: string; error?: string }) {
    const f = flow();
    await begin([A], A, f);
    const http = createFetchDouble([{ json: { token_type: "Bearer", access_token: "at" } }]);
    const run = () => completeAuthorizationCode({ ...fixturePorts, provider: f.provider, pending: f.pending, clock: f.clock, fetchFn: http.fetchFn, ownerKey: "ws:1", client: TEST_CLIENT, params });
    return { run, http };
}

for (const [label, state] of [
    ["empty", ""],
    ["exactly MAX length (well-formed size, but unknown)", "s".repeat(MAX_AUTHORIZATION_STATE_LENGTH)],
    ["MAX+1 length", "s".repeat(MAX_AUTHORIZATION_STATE_LENGTH + 1)],
] as const) {
    test(`F1: callback state ${label} → OAUTH_INVALID_STATE, no token request`, async () => {
        const { run, http } = await complete({ state, code: "c" });
        const error = await assertOAuthRejects(run, "OAUTH_INVALID_STATE");
        assert.equal(error.message, "the authorization request could not be matched — it may have expired or already been used");
        assert.equal(http.callCount(), 0);
    });
}

test("F1: a MAX+1 state is refused by the shape check BEFORE the pending store is consulted", async () => {
    const f = flow();
    let takes = 0;
    const pending = { ...f.pending, take: async (args: Parameters<typeof f.pending.take>[0]) => { takes++; return f.pending.take(args); } };
    await assertOAuthRejects(() => completeAuthorizationCode({ ...fixturePorts, provider: f.provider, pending, clock: f.clock, ownerKey: "ws:1", client: TEST_CLIENT, params: { state: "s".repeat(MAX_AUTHORIZATION_STATE_LENGTH + 1), code: "c" } }), "OAUTH_INVALID_STATE");
    await assertOAuthRejects(() => completeAuthorizationCode({ ...fixturePorts, provider: f.provider, pending, clock: f.clock, ownerKey: "ws:1", client: TEST_CLIENT, params: { state: "", code: "c" } }), "OAUTH_INVALID_STATE");
    assert.equal(takes, 0);
    // MAX itself passes the shape check and reaches the store (which then refuses an unknown state).
    await assertOAuthRejects(() => completeAuthorizationCode({ ...fixturePorts, provider: f.provider, pending, clock: f.clock, ownerKey: "ws:1", client: TEST_CLIENT, params: { state: "s".repeat(MAX_AUTHORIZATION_STATE_LENGTH), code: "c" } }), "OAUTH_INVALID_STATE");
    assert.equal(takes, 1);
});

for (const [label, code] of [["missing", undefined], ["empty", ""]] as const) {
    test(`F1: a callback with a valid state but ${label} code (and no error) → OAUTH_INVALID_REQUEST, no token request`, async () => {
        const f = flow();
        const started = await begin([A], A, f);
        const http = createFetchDouble([{ json: { token_type: "Bearer", access_token: "at" } }]);
        const error = await assertOAuthRejects(() => completeAuthorizationCode({ ...fixturePorts, provider: f.provider, pending: f.pending, clock: f.clock, fetchFn: http.fetchFn, ownerKey: "ws:1", client: TEST_CLIENT, params: code === undefined ? { state: started.state } : { state: started.state, code } }), "OAUTH_INVALID_REQUEST");
        assert.equal(error.message, "the authorization server returned neither a code nor an error");
        assert.equal(http.callCount(), 0);
    });
}

// F1 re-score kills (authorization-code.ts:19 regex anchors, :185 MAX_CODE_LENGTH boundary).
import { toCallbackError, MAX_CODE_LENGTH } from "../src/authorization-code.js";
for (const [raw, code, kept] of [
    ["access_denied", "OAUTH_ACCESS_DENIED", "access_denied"],
    ["invalid_scope", "OAUTH_PROVIDER_REJECTED", "invalid_scope"],
    ["EVIL access_denied", "OAUTH_PROVIDER_REJECTED", undefined],
    ["access_denied\n<script>", "OAUTH_PROVIDER_REJECTED", undefined],
    ["access_denied!", "OAUTH_PROVIDER_REJECTED", undefined],
    ["a".repeat(64), "OAUTH_PROVIDER_REJECTED", "a".repeat(64)],
    ["a".repeat(65), "OAUTH_PROVIDER_REJECTED", undefined],
] as const) {
    test(`F1: callback error ${JSON.stringify(raw).slice(0, 30)} → ${code}, providerErrorCode kept=${kept !== undefined}`, () => {
        const error = toCallbackError(raw);
        assert.equal(error.code, code);
        assert.equal(error.providerErrorCode, kept);
    });
}

for (const [label, length, refused] of [["exactly MAX", MAX_CODE_LENGTH, false], ["MAX+1", MAX_CODE_LENGTH + 1, true]] as const) {
    test(`F1: an authorization code of ${label} characters is ${refused ? "refused before exchange" : "exchanged"}`, async () => {
        const f = flow();
        const started = await begin([A], A, f);
        const http = createFetchDouble([{ json: { token_type: "Bearer", access_token: "at" } }]);
        const run = () => completeAuthorizationCode({ ...fixturePorts, provider: f.provider, pending: f.pending, clock: f.clock, fetchFn: http.fetchFn, ownerKey: "ws:1", client: TEST_CLIENT, params: { state: started.state, code: "c".repeat(length) } });
        if (refused) {
            const error = await assertOAuthRejects(run, "OAUTH_INVALID_REQUEST");
            assert.equal(error.message, `the authorization code exceeded ${MAX_CODE_LENGTH} characters`);
            assert.equal(http.callCount(), 0);
        } else {
            assert.equal((await run()).accessToken, "at");
            assert.equal(http.requests[0]!.body.get("code"), "c".repeat(length));
        }
    });
}
