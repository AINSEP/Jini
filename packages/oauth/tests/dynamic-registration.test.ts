import { fixturePorts } from "./fixtures.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { registerOAuthClientDynamically } from "../src/index.js";
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
        const http = createFetchDouble([{ json: { client_id: "issued-id", client_secret: "issued-secret" } }]);
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
