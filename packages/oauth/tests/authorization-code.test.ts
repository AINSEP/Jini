import { describe, expect, it } from 'vitest';
import { buildOAuthAuthorizationUrl } from '../src/index.js';
import { fixturePorts, fixtureEntropy } from "./fixtures.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, vi } from "vitest";
import { beginAuthorizationCode, completeAuthorizationCode } from "../src/index.js";
import { createPendingAuthorizationStore } from "../src/testing/index.js";
import type { OAuthProviderDescriptor } from "../src/ports.js";
import { assertOAuthRejects, createFetchDouble, createTestClock, TEST_CLIENT, TEST_PROVIDER, } from "./helpers.js";
/**
 * @file The authorization-code + PKCE grant.
 *
 * Four properties are load-bearing and each has a test that fails if it regresses:
 * PKCE actually reaches the token endpoint; `state` is validated before anything else happens; a
 * provider that is slow or unreachable fails fast and is NOT retried; and a callback carrying an
 * `error` is treated as terminal rather than as a blip.
 */
const REDIRECT_URI = "https://example.example.com/api/resource-servers/oauth/callback/higgs";
function makeFlow(providerOverrides: Partial<OAuthProviderDescriptor> = {}) {
    const clock = createTestClock();
    const pending = createPendingAuthorizationStore({
        randomBytesFn: fixtureEntropy,
        clock
    });
    const provider = { ...TEST_PROVIDER, ...providerOverrides };
    return { clock, pending, provider };
}
test("begin builds an authorization URL carrying response_type, client_id, redirect_uri, scope, state and the S256 challenge", async () => {
    const { pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const url = new URL(started.authorizationUrl);
    assert.equal(url.origin + url.pathname, "https://auth.example.com/authorize");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), "example-client");
    assert.equal(url.searchParams.get("redirect_uri"), REDIRECT_URI);
    assert.equal(url.searchParams.get("scope"), "images:generate");
    assert.equal(url.searchParams.get("state"), started.state);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("code_challenge"));
    // The URL is handed to a browser: it must not carry the verifier.
    assert.equal(url.searchParams.get("code_verifier"), null);
});
test("begin contacts no third party — a dead provider cannot make starting a connection hang", async () => {
    const { pending, provider } = makeFlow();
    const http = createFetchDouble([{ throws: new Error("network down") }]);
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => http.fetchFn({ url }, init));
    try {
        await beginAuthorizationCode({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                redirectUris: [REDIRECT_URI]
            },
            provider, pending, fetchFn: http.fetchFn,
            ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
        });
        assert.equal(http.callCount(), 0);
    }
    finally {
        spy.mockRestore();
    }
});
test("complete sends the matching code_verifier, the stored redirect_uri, and no client secret for a public client", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const challengeSent = new URL(started.authorizationUrl).searchParams.get("code_challenge");
    const http = createFetchDouble([{ json: { access_token: "at-1", refresh_token: "rt-1", token_type: "Bearer", expires_in: 3600, scope: "images:generate" } }]);
    const tokens = await completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state, code: "auth-code-1" }
    });
    const request = http.requests[0];
    assert.ok(request);
    assert.equal(request.method, "POST");
    assert.equal(request.url, "https://auth.example.com/token");
    assert.equal(request.redirect, "error");
    assert.equal(request.body.get("grant_type"), "authorization_code");
    assert.equal(request.body.get("code"), "auth-code-1");
    assert.equal(request.body.get("redirect_uri"), REDIRECT_URI);
    assert.equal(request.body.get("client_id"), TEST_CLIENT.clientId);
    assert.equal(request.body.get("client_secret"), null);
    // The verifier that was sent must be the pre-image of the challenge the browser carried.
    const verifierSent = request.body.get("code_verifier") ?? "";
    assert.equal(createHash("sha256").update(verifierSent, "ascii").digest("base64url"), challengeSent);
    assert.deepEqual(tokens, {
        accessToken: "at-1",
        refreshToken: "rt-1",
        tokenType: "Bearer",
        scopes: ["images:generate"],
        expiresAt: "2026-08-25T13:00:00.000Z",
    });
});
test("expires_in becomes an absolute expiresAt computed from the injected clock", async () => {
    const { clock, pending, provider } = makeFlow();
    clock.setIso("2030-01-01T00:00:00.000Z");
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const http = createFetchDouble([{ json: { access_token: "at", expires_in: 60 } }]);
    const tokens = await completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state, code: "c" }
    });
    assert.equal(tokens.expiresAt, "2030-01-01T00:01:00.000Z");
});
test("a provider that omits expires_in yields a null expiry rather than a fabricated one", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const http = createFetchDouble([{ json: { access_token: "at" } }]);
    const tokens = await completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state, code: "c" }
    });
    assert.equal(tokens.expiresAt, null);
    assert.equal(tokens.refreshToken, null);
});
test("a replayed callback is refused and never reaches the token endpoint a second time", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const http = createFetchDouble([{ json: { access_token: "at" } }]);
    const deps = { provider, pending, clock, fetchFn: http.fetchFn };
    const params = { state: started.state, code: "c" };
    await completeAuthorizationCode({
        ...fixturePorts,
        ...deps,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params
    });
    await assertOAuthRejects(() => completeAuthorizationCode({
        ...fixturePorts,
        ...deps,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params
    }), "OAUTH_INVALID_STATE");
    assert.equal(http.callCount(), 1);
});
test("a state belonging to another connection is refused before any exchange", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const http = createFetchDouble([{ json: { access_token: "at" } }]);
    await assertOAuthRejects(() => completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:some-other-server", client: TEST_CLIENT, params: { state: started.state, code: "c" }
    }), "OAUTH_INVALID_STATE");
    assert.equal(http.callCount(), 0);
});
test("a missing state is refused without contacting the provider", async () => {
    const { clock, pending, provider } = makeFlow();
    const http = createFetchDouble([{ json: { access_token: "at" } }]);
    await assertOAuthRejects(() => completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: "", code: "c" }
    }), "OAUTH_INVALID_STATE");
    assert.equal(http.callCount(), 0);
});
test("an oversized authorization code is refused before it is put in a form body", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const http = createFetchDouble([{ json: { access_token: "at" } }]);
    const error = await assertOAuthRejects(() => completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state, code: "x".repeat(2049) }
    }), "OAUTH_INVALID_REQUEST");
    assert.equal(error.message, "the authorization code exceeded 2048 characters");
    assert.equal(http.callCount(), 0);
});
test("a callback carrying error=access_denied is terminal, not retryable", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const http = createFetchDouble([{ json: { access_token: "at" } }]);
    const error = await assertOAuthRejects(() => completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state, error: "access_denied" }
    }), "OAUTH_ACCESS_DENIED");
    assert.equal(error.retryable, false);
    assert.equal(error.message, "authorization was declined");
    assert.equal(http.callCount(), 0);
});
test("an unreachable token endpoint fails fast and is NOT retried", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const http = createFetchDouble([{ throws: Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }) }]);
    const error = await assertOAuthRejects(() => completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state, code: "c" }
    }), "OAUTH_PROVIDER_UNREACHABLE");
    assert.equal(error.retryable, false);
    assert.equal(error.message, "could not reach the authorization server at auth.example.com");
    assert.equal(error.operatorAction, "Check network access to this provider, then try connecting again. Nothing was retried automatically.");
    // The whole point: exactly one attempt.
    assert.equal(http.callCount(), 1);
});
test("a stalled exchange is aborted by the configured deadline without retrying", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    let attempts = 0;
    let signal: AbortSignal | undefined;
    // AbortSignal.timeout uses an unref'ed timer; keep the process alive until the assertion settles.
    const keepAlive = setTimeout(() => { }, 2000);
    try {
        const error = await assertOAuthRejects(() => completeAuthorizationCode({
            ...fixturePorts,
            provider, pending, clock, fetchFn: async ({ url: _url }, init) => {
                attempts += 1;
                assert.ok(init?.signal instanceof AbortSignal);
                signal = init.signal;
                return new Promise<Response>((_resolve, reject) => {
                    signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
                });
            },
            ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state, code: "c" }
        }, {
            timeoutMs: 20
        }), "OAUTH_PROVIDER_UNREACHABLE");
        assert.equal(signal?.aborted, true);
        assert.equal((error.cause as Error).name, "TimeoutError");
        assert.equal(attempts, 1);
    }
    finally {
        clearTimeout(keepAlive);
    }
});
test("a provider error body never leaks its description into the message", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const http = createFetchDouble([
        { status: 400, json: { error: "invalid_client", error_description: "client 8f3a for tenant acme-internal is not authorized" } },
    ]);
    const error = await assertOAuthRejects(() => completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state, code: "c" }
    }), "OAUTH_PROVIDER_REJECTED");
    assert.equal(error.message, "the authorization server refused the request (HTTP 400, invalid_client)");
    assert.equal(error.providerErrorCode, "invalid_client");
    assert.ok(!error.message.includes("acme-internal"));
});
test("a token endpoint that answers with something other than JSON is a malformed response, not a token", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const http = createFetchDouble([{ text: "<html>login</html>" }]);
    const error = await assertOAuthRejects(() => completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state, code: "c" }
    }), "OAUTH_MALFORMED_RESPONSE");
    assert.equal(error.message, "the authorization server did not return a JSON object");
});
test("an oversized token response is refused rather than buffered", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const http = createFetchDouble([{ text: `{"access_token":"${"a".repeat(70000)}"}` }]);
    const error = await assertOAuthRejects(() => completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state, code: "c" }
    }), "OAUTH_MALFORMED_RESPONSE");
    assert.equal(error.message, "the authorization server's response exceeded 65536 bytes");
});
test("an http:// redirect URI is refused at begin, so a plaintext code leg can never be started", async () => {
    const { pending, provider } = makeFlow();
    const error = await assertOAuthRejects(() => beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: ["http://example.example.com/cb"]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: "http://example.example.com/cb"
    }), "OAUTH_UNSAFE_ENDPOINT");
    assert.equal(error.message, "redirect URI: provider endpoint must use https (http is permitted only for loopback)");
});
test("a redirect URI pointing at internal address space is refused", async () => {
    const { pending, provider } = makeFlow();
    await assertOAuthRejects(() => beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: ["https://169.254.169.254/cb"]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: "https://169.254.169.254/cb"
    }), "OAUTH_UNSAFE_ENDPOINT");
});
test("a provider that does not declare the authorization-code grant refuses to start one", async () => {
    const { pending, provider } = makeFlow({ supportedGrants: ["device_code"] });
    const error = await assertOAuthRejects(() => beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    }), "OAUTH_UNSUPPORTED_GRANT");
    assert.equal(error.message, "provider 'test-provider' does not support the authorization_code grant");
});
for (const parameter of ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method"]) {
    test(`an extra authorization parameter cannot overwrite ${parameter}`, async () => {
        const { pending, provider } = makeFlow();
        const error = await assertOAuthRejects(() => beginAuthorizationCode({
            ...fixturePorts,
            options: {
                ...fixturePorts.options,
                redirectUris: [REDIRECT_URI]
            },
            provider, pending,
            ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
        }, {
            extraAuthorizationParams: { [parameter]: "attacker-chosen" }
        }), "OAUTH_INVALID_REQUEST");
        assert.equal(error.message, `'${parameter}' is set by the OAuth client and cannot be overridden for this provider`);
    });
}
test("a state minted for a different provider is refused before any exchange", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const http = createFetchDouble([{ json: { access_token: "at" } }]);
    await assertOAuthRejects(() => completeAuthorizationCode({
        ...fixturePorts,
        provider: { ...provider, providerId: "other-provider" }, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state, code: "c" }
    }), "OAUTH_INVALID_STATE");
    assert.equal(http.callCount(), 0);
});
test("PKCE-disabled providers omit challenge and verifier and honor a scope override", async () => {
    const { clock, pending, provider } = makeFlow({ usesPkce: false });
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    }, {
        scopes: ["custom:read", "custom:write"]
    });
    const url = new URL(started.authorizationUrl);
    assert.equal(url.searchParams.get("code_challenge"), null);
    assert.equal(url.searchParams.get("code_challenge_method"), null);
    assert.equal(url.searchParams.get("scope"), "custom:read custom:write");
    const http = createFetchDouble([{ json: { access_token: "at" } }]);
    await completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state, code: "c" }
    });
    assert.equal(http.requests[0].body.get("code_verifier"), null);
});
test("a callback with neither code nor error is refused without an exchange", async () => {
    const { clock, pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    });
    const http = createFetchDouble([{ json: { access_token: "at" } }]);
    await assertOAuthRejects(() => completeAuthorizationCode({
        ...fixturePorts,
        provider, pending, clock, fetchFn: http.fetchFn,
        ownerKey: "ws:higgs", client: TEST_CLIENT, params: { state: started.state }
    }), "OAUTH_INVALID_REQUEST");
    assert.equal(http.callCount(), 0);
});
test("an extra authorization parameter the provider genuinely needs is carried through", async () => {
    const { pending, provider } = makeFlow();
    const started = await beginAuthorizationCode({
        ...fixturePorts,
        options: {
            ...fixturePorts.options,
            redirectUris: [REDIRECT_URI]
        },
        provider, pending,
        ownerKey: "ws:higgs", client: TEST_CLIENT, redirectUri: REDIRECT_URI
    }, {
        extraAuthorizationParams: { audience: "https://api.example.com" }
    });
    assert.equal(new URL(started.authorizationUrl).searchParams.get("audience"), "https://api.example.com");
});

describe('buildOAuthAuthorizationUrl', () => {
  const authServer = {
    issuer: 'https://auth.example.com',
    authorization_endpoint: 'https://auth.example.com/authorize',
    token_endpoint: 'https://auth.example.com/token',
  };

  // PARITY
  it('builds a url with the required PKCE params', () => {
    const url = buildOAuthAuthorizationUrl({ authorizationEndpoint: authServer.authorization_endpoint, clientId: 'client-1', redirectUri: 'http://127.0.0.1:5555/callback', state: 'state-1', codeChallenge: 'challenge-1' });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://auth.example.com/authorize');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('client-1');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5555/callback');
    expect(parsed.searchParams.get('state')).toBe('state-1');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.has('scope')).toBe(false);
    expect(parsed.searchParams.has('resource')).toBe(false);
  });

  // PARITY
  it('includes scope and resource when supplied', () => {
    const url = buildOAuthAuthorizationUrl({ authorizationEndpoint: authServer.authorization_endpoint, clientId: 'client-1', redirectUri: 'http://127.0.0.1:5555/callback', state: 'state-1', codeChallenge: 'challenge-1' }, { scope: 'a b', resource: 'https://api.example.com' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('scope')).toBe('a b');
    expect(parsed.searchParams.get('resource')).toBe('https://api.example.com');
  });
});

