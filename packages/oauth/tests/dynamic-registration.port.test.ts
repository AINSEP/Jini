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
test("registration POSTs an RFC 7591 client-metadata document as JSON", async () => {
    const fixture = await startDiscoveryFixture();
    try {
        await registerOAuthClientDynamically({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                clientDisplayName: "example",
                redirectUris: [REDIRECT_URI]
            },
            registrationEndpoint: `${fixture.origin}/oauth2/register`,
            scopes: ["openid", "email", "offline_access"]
        });
        const request = fixture.requests.at(-1);
        assert.ok(request, "expected the registration endpoint to have been called");
        assert.equal(request.method, "POST");
        assert.equal(request.headers["content-type"], "application/json");
        const body = parseBody(request.body);
        assert.deepEqual(body.redirect_uris, [REDIRECT_URI]);
        assert.equal(body.client_name, "example");
        assert.equal(body.token_endpoint_auth_method, "none");
        assert.deepEqual(body.grant_types, ["authorization_code", "refresh_token"]);
        assert.deepEqual(body.response_types, ["code"]);
        assert.equal(body.scope, "openid email offline_access");
        assert.equal(body.application_type, "web");
        assert.equal(fixture.requests.filter((request) => request.url === "/oauth2/register").length, 1, "registration must make exactly one attempt");
    }
    finally {
        await fixture.close();
    }
});
test("a public client is the default — no client secret is requested and none is required back", async () => {
    const fixture = await startDiscoveryFixture({ registration: { json: { client_id: "minted-abc" } } });
    try {
        const registered = await registerOAuthClientDynamically({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                clientDisplayName: "example",
                redirectUris: [REDIRECT_URI]
            },
            registrationEndpoint: `${fixture.origin}/oauth2/register`, scopes: []
        });
        assert.equal(registered.clientId, "minted-abc");
        assert.equal(registered.clientSecret, null);
        assert.equal(registered.tokenEndpointAuthMethod, "none");
        assert.equal(fixture.requests.filter((request) => request.url === "/oauth2/register").length, 1, "registration must make exactly one attempt");
    }
    finally {
        await fixture.close();
    }
});
test("a server that volunteers a client secret anyway has it carried back, with the auth method it echoed", async () => {
    const fixture = await startDiscoveryFixture({
        registration: {
            json: {
                client_id: "minted-abc",
                client_secret: "server-chose-a-secret",
                token_endpoint_auth_method: "client_secret_post",
                client_id_issued_at: 1756000000,
                client_secret_expires_at: 0,
            },
        },
    });
    try {
        const registered = await registerOAuthClientDynamically({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                clientDisplayName: "example",
                redirectUris: [REDIRECT_URI]
            },
            registrationEndpoint: `${fixture.origin}/oauth2/register`, scopes: []
        });
        assert.equal(registered.clientSecret, "server-chose-a-secret");
        // The server's own choice wins: authenticating with `none` at a server that issued a secret is
        // how a working registration turns into an `invalid_client` at the token endpoint.
        assert.equal(registered.tokenEndpointAuthMethod, "client_secret_post");
        assert.equal(registered.clientIdIssuedAt, 1756000000);
        assert.equal(registered.clientSecretExpiresAt, 0);
        assert.equal(fixture.requests.filter((request) => request.url === "/oauth2/register").length, 1, "registration must make exactly one attempt");
    }
    finally {
        await fixture.close();
    }
});
test("an echoed token_endpoint_auth_method outside the supported vocabulary falls back to the requested one", async () => {
    const fixture = await startDiscoveryFixture({
        registration: { json: { client_id: "minted-abc", token_endpoint_auth_method: "private_key_jwt" } },
    });
    try {
        const registered = await registerOAuthClientDynamically({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                clientDisplayName: "example",
                redirectUris: [REDIRECT_URI]
            },
            registrationEndpoint: `${fixture.origin}/oauth2/register`, scopes: []
        });
        assert.equal(registered.tokenEndpointAuthMethod, "none");
        assert.equal(fixture.requests.filter((request) => request.url === "/oauth2/register").length, 1, "registration must make exactly one attempt");
    }
    finally {
        await fixture.close();
    }
});
test("a response with no client id is a malformed response, not a silently broken connection", async () => {
    const fixture = await startDiscoveryFixture({ registration: { json: { client_secret: "orphan" } } });
    try {
        const error = await assertOAuthRejects(() => registerOAuthClientDynamically({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                clientDisplayName: "example",
                redirectUris: [REDIRECT_URI]
            },
            registrationEndpoint: `${fixture.origin}/oauth2/register`, scopes: []
        }), "OAUTH_MALFORMED_RESPONSE");
        assert.equal(error.message, "the client registration response contained no client id");
        assert.equal(error.operatorAction, "This server's dynamic client registration endpoint is not behaving like an RFC 7591 endpoint.");
        assert.equal(fixture.requests.filter((request) => request.url === "/oauth2/register").length, 1, "registration must make exactly one attempt");
    }
    finally {
        await fixture.close();
    }
});
test("a refusal is reported with its RFC 7591 error code and WITHOUT the server's free text", async () => {
    const fixture = await startDiscoveryFixture({
        registration: {
            status: 400,
            json: { error: "invalid_redirect_uri", error_description: "<script>alert(document.cookie)</script>" },
        },
    });
    try {
        const error = await assertOAuthRejects(() => registerOAuthClientDynamically({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                clientDisplayName: "example",
                redirectUris: [REDIRECT_URI]
            },
            registrationEndpoint: `${fixture.origin}/oauth2/register`, scopes: []
        }), "OAUTH_PROVIDER_REJECTED");
        assert.equal(error.message, "the authorization server refused the client registration (HTTP 400, invalid_redirect_uri)");
        assert.equal(error.providerErrorCode, "invalid_redirect_uri");
        assert.ok(!error.message.includes("script"), "the provider's free text must never reach the message");
        // Registration is never retried, whatever the server calls its error.
        assert.equal(error.retryable, false);
        assert.equal(fixture.requests.filter((request) => request.url === "/oauth2/register").length, 1, "registration must make exactly one attempt");
    }
    finally {
        await fixture.close();
    }
});
test("a refusal a hostile server labels slow_down is still terminal — registration never loops", async () => {
    const fixture = await startDiscoveryFixture({ registration: { status: 429, json: { error: "slow_down" } } });
    try {
        const error = await assertOAuthRejects(() => registerOAuthClientDynamically({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                clientDisplayName: "example",
                redirectUris: [REDIRECT_URI]
            },
            registrationEndpoint: `${fixture.origin}/oauth2/register`, scopes: []
        }), "OAUTH_PROVIDER_REJECTED");
        assert.equal(error.retryable, false);
        assert.equal(fixture.requests.filter((request) => request.url === "/oauth2/register").length, 1, "registration must make exactly one attempt");
    }
    finally {
        await fixture.close();
    }
});
test("an unreachable registration endpoint reports unreachable, names the host, and is not retried", async () => {
    const server = await startLoopbackServer((_req, res) => sendJson(res, 200, {}));
    const origin = server.origin;
    await server.close();
    const error = await assertOAuthRejects(() => registerOAuthClientDynamically({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            clientDisplayName: "example",
            redirectUris: [REDIRECT_URI]
        },
        registrationEndpoint: `${origin}/oauth2/register`, scopes: []
    }), "OAUTH_PROVIDER_UNREACHABLE");
    assert.equal(error.message, `could not reach the client registration endpoint at ${new URL(origin).host}`);
});
test("a registration endpoint that redirects is refused rather than followed", async () => {
    const server = await startLoopbackServer((_req, res) => {
        res.writeHead(307, { location: "https://elsewhere.example.com/register" });
        res.end();
    });
    try {
        await assertOAuthRejects(() => registerOAuthClientDynamically({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                clientDisplayName: "example",
                redirectUris: [REDIRECT_URI]
            },
            registrationEndpoint: `${server.origin}/oauth2/register`, scopes: []
        }), "OAUTH_PROVIDER_UNREACHABLE");
        assert.equal(server.requests.length, 1, "registration must make exactly one attempt");
    }
    finally {
        await server.close();
    }
});
test("an oversized registration response is capped rather than buffered", async () => {
    const server = await startLoopbackServer((_req, res) => {
        res.writeHead(201, { "content-type": "application/json" });
        for (let i = 0; i < 200; i += 1)
            res.write("x".repeat(1024));
        res.end();
    });
    try {
        const error = await assertOAuthRejects(() => registerOAuthClientDynamically({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                clientDisplayName: "example",
                redirectUris: [REDIRECT_URI]
            },
            registrationEndpoint: `${server.origin}/oauth2/register`, scopes: []
        }), "OAUTH_MALFORMED_RESPONSE");
        assert.equal(error.message, "the client registration response exceeded 65536 bytes");
        assert.equal(server.requests.length, 1, "registration must make exactly one attempt");
    }
    finally {
        await server.close();
    }
});
test("requested grant types and auth method are honoured when the caller names them", async () => {
    const fixture = await startDiscoveryFixture();
    try {
        await registerOAuthClientDynamically({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                clientDisplayName: "example",
                redirectUris: [REDIRECT_URI]
            },
            registrationEndpoint: `${fixture.origin}/oauth2/register`,
            scopes: []
        }, {
            grantTypes: ["urn:ietf:params:oauth:grant-type:device_code"],
            responseTypes: [],
            tokenEndpointAuthMethod: "client_secret_post"
        });
        const body = parseBody(fixture.requests.at(-1)?.body ?? "{}");
        assert.deepEqual(body.grant_types, ["urn:ietf:params:oauth:grant-type:device_code"]);
        assert.equal(body.token_endpoint_auth_method, "client_secret_post");
        assert.deepEqual(body.response_types, []);
        assert.equal(fixture.requests.filter((request) => request.url === "/oauth2/register").length, 1, "registration must make exactly one attempt");
    }
    finally {
        await fixture.close();
    }
});
