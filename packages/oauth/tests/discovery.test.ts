import { createOAuthUrlGuard } from '../src/index.js';
import { fixturePorts } from "./fixtures.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { discoverAuthorizationServer as discoverBoundAuthorizationServer, fetchAuthorizationServerMetadata as fetchBoundAuthorizationServerMetadata, parseResourceMetadataUrl, parseWwwAuthenticateScopes, } from "../src/index.js";
import { assertOAuthRejects, sendJson, startDiscoveryFixture, startLoopbackServer } from "./helpers.js";
/**
 * @file Tests for RFC 9728 (protected-resource metadata) + RFC 8414 (authorization-server metadata)
 * discovery, run against REAL loopback servers.
 *
 * What this file is defending, in order of how much it would hurt to get wrong:
 *
 * 1. **Every URL that arrives in a remote document goes through `assertSafeProviderEndpoint`.**
 *    Discovery inverts the trust story of the rest of `src/platform/oauth/`: an operator typed the other
 *    endpoints, but these ones are chosen by whatever answered the well-known path. A discovered
 *    `token_endpoint` pointing at `http://169.254.169.254/...` is a credential-exfiltration primitive,
 *    not a configuration typo.
 * 2. **One dead authorization server must not take out the whole flow.** Measured in the wild: a
 *    resource advertising two authorization servers where the second answers `{"detail":"Not Found"}`
 *    at its RFC 8414 well-known path. A client that fails on the first miss connects to nothing.
 * 3. Nothing here names a provider. The fixture is a loopback server; the production code path is
 *    the same one any authorization server would take.
 */
// ---------------------------------------------------------------------------
// Parsing the 401 challenge
// ---------------------------------------------------------------------------
/** Shaped exactly like a `WWW-Authenticate` measured from a hosted resource server. */
const CHALLENGE = 'Bearer resource_metadata="https://resource.example.com/.well-known/oauth-protected-resource/resource", scope="openid email offline_access"';
test("parseResourceMetadataUrl reads the RFC 9728 resource_metadata parameter out of a real challenge", () => {
    assert.equal(parseResourceMetadataUrl({
        wwwAuthenticate: CHALLENGE
    }), "https://resource.example.com/.well-known/oauth-protected-resource/resource");
});
test("parseResourceMetadataUrl tolerates unquoted values and odd spacing", () => {
    assert.equal(parseResourceMetadataUrl({
        wwwAuthenticate: "Bearer  scope=openid,  resource_metadata=https://as.example.com/.well-known/x"
    }), "https://as.example.com/.well-known/x");
});
test("parseResourceMetadataUrl returns null when the challenge carries no such parameter", () => {
    assert.equal(parseResourceMetadataUrl({
        wwwAuthenticate: 'Bearer realm="resource", error="invalid_token"'
    }), null);
});
test("parseWwwAuthenticateScopes splits the space-delimited scope parameter", () => {
    assert.deepEqual(parseWwwAuthenticateScopes({
        wwwAuthenticate: CHALLENGE
    }), ["openid", "email", "offline_access"]);
});
test("parseWwwAuthenticateScopes returns an empty list when the challenge names no scope", () => {
    assert.deepEqual(parseWwwAuthenticateScopes({
        wwwAuthenticate: 'Bearer realm="resource"'
    }), []);
});
test("discovery retains a device endpoint and refuses an unsafe advertised device endpoint", async () => {
    const origin = "http://127.0.0.1:1";
    for (const deviceEndpoint of [`${origin}/device`, "https://169.254.169.254/device"]) {
        const fetchFn: import('../src/index.js').OAuthFetch = async ({ url }) => new Response(JSON.stringify(String(url).includes("oauth-protected-resource")
            ? { authorization_servers: [origin] }
            : { issuer: origin, token_endpoint: `${origin}/token`, device_authorization_endpoint: deviceEndpoint }));
        if (deviceEndpoint.startsWith(origin)) {
            const discovered = await discoverAuthorizationServer({
                ...fixturePorts,
                fetchFn,
                resourceUrl: `${origin}/resource`
            });
            assert.equal(discovered.server.deviceAuthorizationEndpoint, deviceEndpoint);
        }
        else {
            const error = await assertOAuthRejects(() => discoverAuthorizationServer({
                ...fixturePorts,
                fetchFn,
                resourceUrl: `${origin}/resource`
            }), "OAUTH_UNSAFE_ENDPOINT");
            assert.equal(error.message, "discovered device authorization endpoint: provider endpoint resolves to an internal address, which is not allowed");
        }
    }
});
test("a real hosted resource server's 401 challenge parses to its exact metadata URL and scopes", () => {
    // Verbatim from a live probe of a hosted resource server, kept as a fixture so the parser is
    // pinned against a header a real deployment actually emits rather than a tidied one.
    const measured = 'Bearer resource_metadata="https://resource.example.ai/.well-known/oauth-protected-resource/resource", scope="openid email offline_access"';
    assert.equal(parseResourceMetadataUrl({
        wwwAuthenticate: measured
    }), "https://resource.example.ai/.well-known/oauth-protected-resource/resource");
    // `offline_access` is the member that decides whether the connection can ever refresh.
    assert.deepEqual(parseWwwAuthenticateScopes({
        wwwAuthenticate: measured
    }), ["openid", "email", "offline_access"]);
});
test("the resource URL itself is safety-checked before anything is derived from it", async () => {
    const error = await assertOAuthRejects(() => discoverAuthorizationServer({
        ...fixturePorts,
        resourceUrl: "http://resource.example.com/resource"
    }), "OAUTH_UNSAFE_ENDPOINT");
    assert.equal(error.message, "protected resource URL: provider endpoint must use https (http is permitted only for loopback)");
});
test("oversized metadata cancels an unfinished stream as soon as the byte cap is exceeded", async () => {
    let pulls = 0;
    let cancelled = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
        start(value) { controller = value; },
        pull(value) {
            pulls += 1;
            // Leave the stream open after a bounded supply: buffering until EOF would hang.
            if (pulls <= 66)
                value.enqueue(new Uint8Array(1024).fill(120));
        },
        cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const requests: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const error = await assertOAuthRejects(() => Promise.race([
            fetchAuthorizationServerMetadata({
                ...fixturePorts,
                fetchFn: async ({ url }) => {
                    requests.push(String(url));
                    return new Response(body, { headers: { "content-type": "application/json" } });
                },
                issuer: "http://127.0.0.1:1"
            }),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error("metadata reader waited for EOF beyond the cap")), 2000);
            }),
        ]), "OAUTH_MALFORMED_RESPONSE");
        assert.equal(error.message, "the OAuth metadata document exceeded 65536 bytes");
        assert.equal(cancelled, true, "overflow must cancel the still-open response body");
        assert.equal(pulls, 65, "no more chunks may be consumed after the first byte over the cap");
        assert.deepEqual(requests, ["http://127.0.0.1:1/.well-known/oauth-authorization-server"]);
    }
    finally {
        clearTimeout(timer);
        if (!cancelled)
            controller!.close();
    }
});

/** Loopback HTTP characterization keeps its original URL-policy coverage with explicit opt-out.
 * Default issuer binding is tested separately against HTTPS in retirement-security.test.ts.
 */
function discoverAuthorizationServer(required: Parameters<typeof discoverBoundAuthorizationServer>[0], optional: Parameters<typeof discoverBoundAuthorizationServer>[1] = {}) {
  return discoverBoundAuthorizationServer(required, { ...optional, metadataPolicy: "none" });
}
function fetchAuthorizationServerMetadata(required: Parameters<typeof fetchBoundAuthorizationServerMetadata>[0], optional: Parameters<typeof fetchBoundAuthorizationServerMetadata>[1] = {}) {
  return fetchBoundAuthorizationServerMetadata(required, { ...optional, metadataPolicy: "none" });
}

// REGRESSION: fails if authorizationServerMetadataCandidates restores unconditional root fallbacks.
test('path-scoped discovery exhausts only path candidates unless the host opts in', async () => {
    const issuer = 'https://auth.example.com/tenant';
    const requests: string[] = [];
    const fetchFn = async ({ url }: { url: string | URL | Request }): Promise<Response> => {
        requests.push(String(url));
        if (String(url) === 'https://auth.example.com/.well-known/oauth-authorization-server')
            return Response.json({ issuer, token_endpoint: 'https://auth.example.com/token' });
        return Response.json({ error: 'not_found' }, { status: 404 });
    };
    const guard = createOAuthUrlGuard({ assertAllowed: () => undefined });
    await assertOAuthRejects(() => fetchBoundAuthorizationServerMetadata({ issuer, fetchFn, guard }), 'OAUTH_INVALID_REQUEST');
    assert.deepEqual(requests, [
        'https://auth.example.com/.well-known/oauth-authorization-server/tenant',
        'https://auth.example.com/.well-known/openid-configuration/tenant',
        'https://auth.example.com/tenant/.well-known/openid-configuration',
    ]);
    requests.length = 0;
    assert.equal((await fetchBoundAuthorizationServerMetadata({ issuer, fetchFn, guard }, { allowOriginFallback: true })).issuer, issuer);
    assert.equal(requests.length, 4);
});
