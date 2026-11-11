import assert from "node:assert/strict";
import { test } from "vitest";
import { requestOAuthToken } from "../src/index.js";
import { fixturePorts } from "./fixtures.js";
import { assertOAuthRejects, createFetchDouble, createTestClock, TEST_CLIENT } from "./helpers.js";

// F1 fix wave (Stryker L1 §4 token-endpoint.ts:100,111,115): expiry boundary and invalid_grant
// operator action, asserted exactly.
const clock = createTestClock("2026-08-25T12:00:00.000Z");
const call = (json: Record<string, unknown>, status = 200) => {
    const http = createFetchDouble([{ json, status }]);
    return requestOAuthToken({ ...fixturePorts, clock, fetchFn: http.fetchFn, tokenEndpoint: "https://auth.example.com/token", client: TEST_CLIENT, params: { grant_type: "client_credentials" } });
};

for (const [expiresIn, expected] of [[1, "2026-08-25T12:00:01.000Z"], [3600, "2026-08-25T13:00:00.000Z"]] as const) {
    test(`F1: expires_in=${expiresIn} → expiresAt ${expected}`, async () => {
        assert.equal((await call({ token_type: "Bearer", access_token: "at", expires_in: expiresIn })).expiresAt, expected);
    });
}

test("F1: expires_in=0 yields a null expiry, never a concrete \"expires now\" timestamp", async () => {
    assert.equal((await call({ token_type: "Bearer", access_token: "at", expires_in: 0 })).expiresAt, null);
});

test("F1: invalid_grant maps to OAUTH_INVALID_GRANT with the reconnect action; another provider error gets the config action", async () => {
    const grant = await assertOAuthRejects(() => call({ error: "invalid_grant" }, 400), "OAUTH_INVALID_GRANT");
    assert.equal(grant.message, "the authorization server refused the request (HTTP 400, invalid_grant)");
    assert.equal(grant.operatorAction, "This connection's authorization is no longer valid — reconnect it in the connection settings.");
    const other = await call({ error: "invalid_client" }, 401).then(() => assert.fail("expected refusal"), (e: { code: string; operatorAction: string; message: string }) => e);
    assert.notEqual(other.code, "OAUTH_INVALID_GRANT");
    assert.equal(other.message, "the authorization server refused the request (HTTP 401, invalid_client)");
    assert.equal(other.operatorAction, "Check this provider's client id, secret, scopes and redirect URI, then try connecting again.");
});

test("F1: scope splitting accepts spaces and commas, drops empties, preserves order", async () => {
    assert.deepEqual((await call({ token_type: "Bearer", access_token: "at", scope: "b a,c  d,,e" })).scopes, ["b", "a", "c", "d", "e"]);
    assert.deepEqual((await call({ token_type: "Bearer", access_token: "at" })).scopes, []);
});
