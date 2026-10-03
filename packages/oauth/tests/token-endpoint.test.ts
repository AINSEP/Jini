import { fixtureGuard } from './fixtures.js';
import { describe, expect, it, vi } from 'vitest';
import { exchangeOAuthAuthorizationCode, refreshAccessToken } from '../src/index.js';
import { fixturePorts } from "./fixtures.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { requestOAuthToken } from "../src/index.js";
import { assertOAuthRejects, createFetchDouble, createTestClock, TEST_CLIENT } from "./helpers.js";
/**
 * @file Direct characterization tests for {@link requestOAuthToken}'s field-normalization branches.
 *
 * The higher-level grant tests (`authorization-code.test.ts`, `device-code.test.ts`) exercise this
 * function's error paths thoroughly but never happen to send a `token_type`-less or empty-string
 * response, nor an empty-string `refresh_token`. Pinned here before an internal-only refactor
 * (extraction only, no field-handling behavior changed).
 */
const TOKEN_ENDPOINT = "https://auth.example.com/token";
for (const authMethod of ["none", "client_secret_post", "client_secret_basic"] as const) {
    test(`token requests authenticate using ${authMethod}`, async () => {
        const http = createFetchDouble([{ json: { access_token: "at" } }]);
        const client = { clientId: "id: /+", clientSecret: "secret: /+", authMethod };
        await requestOAuthToken({
            ...fixturePorts,
            clock: createTestClock(), fetchFn: http.fetchFn,
            tokenEndpoint: TOKEN_ENDPOINT, client, params: { grant_type: "authorization_code", code: "c" }
        });
        const request = http.requests[0];
        assert.equal(request.body.get("client_id"), authMethod === "client_secret_basic" ? null : client.clientId);
        assert.equal(request.body.get("client_secret"), authMethod === "client_secret_post" ? client.clientSecret : null);
        // Literal fixture pins URL encoding before the id/secret pair is base64 encoded.
        assert.equal(request.headers.authorization, authMethod === "client_secret_basic"
            ? `Basic ${Buffer.from("id%3A%20%2F%2B:secret%3A%20%2F%2B").toString("base64")}` : undefined);
    });
}
test("a missing token_type defaults to Bearer", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ json: { access_token: "at" } }]);
    const tokens = await requestOAuthToken({
        ...fixturePorts,
        clock, fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: "authorization_code" }
    });
    assert.equal(tokens.tokenType, "Bearer");
});
test("an empty-string token_type defaults to Bearer rather than being passed through", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ json: { access_token: "at", token_type: "" } }]);
    const tokens = await requestOAuthToken({
        ...fixturePorts,
        clock, fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: "authorization_code" }
    });
    assert.equal(tokens.tokenType, "Bearer");
});
test("a non-default token_type passes through unchanged", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ json: { access_token: "at", token_type: "mac" } }]);
    const tokens = await requestOAuthToken({
        ...fixturePorts,
        clock, fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: "authorization_code" }
    });
    assert.equal(tokens.tokenType, "mac");
});
test("an empty-string refresh_token normalizes to null, same as an absent one", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ json: { access_token: "at", refresh_token: "" } }]);
    const tokens = await requestOAuthToken({
        ...fixturePorts,
        clock, fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: "authorization_code" }
    });
    assert.equal(tokens.refreshToken, null);
});
test("a non-empty refresh_token passes through unchanged", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ json: { access_token: "at", refresh_token: "rt-1" } }]);
    const tokens = await requestOAuthToken({
        ...fixturePorts,
        clock, fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: "authorization_code" }
    });
    assert.equal(tokens.refreshToken, "rt-1");
});
test("HTTP 200 with authorization_pending remains a retryable provider error", async () => {
    const http = createFetchDouble([{ status: 200, json: { error: "authorization_pending", access_token: "must-not-win" } }]);
    const error = await assertOAuthRejects(() => requestOAuthToken({
        ...fixturePorts,
        clock: createTestClock(), fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: "urn:ietf:params:oauth:grant-type:device_code" }
    }), "OAUTH_AUTHORIZATION_PENDING");
    assert.equal(error.providerErrorCode, "authorization_pending");
    assert.equal(error.retryable, true);
    assert.equal(http.requests.length, 1);
});
test("HTTP 200 without an access_token is a malformed response", async () => {
    const http = createFetchDouble([{ json: { token_type: "Bearer" } }]);
    await assertOAuthRejects(() => requestOAuthToken({
        ...fixturePorts,
        clock: createTestClock(), fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: "authorization_code" }
    }), "OAUTH_MALFORMED_RESPONSE");
});
test("scope accepts comma and whitespace separators without empty scopes", async () => {
    const http = createFetchDouble([{ json: { access_token: "at", scope: "  read,write  profile,  email " } }]);
    const tokens = await requestOAuthToken({
        ...fixturePorts,
        clock: createTestClock(), fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: "authorization_code" }
    });
    assert.deepEqual(tokens.scopes, ["read", "write", "profile", "email"]);
});
for (const expiresIn of [0, -1, "abc"]) {
    test(`expires_in ${JSON.stringify(expiresIn)} yields unknown expiry`, async () => {
        const http = createFetchDouble([{ json: { access_token: "at", expires_in: expiresIn } }]);
        const tokens = await requestOAuthToken({
            ...fixturePorts,
            clock: createTestClock(), fetchFn: http.fetchFn,
            tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: "authorization_code" }
        });
        assert.equal(tokens.expiresAt, null);
    });
}

describe('exchangeOAuthAuthorizationCode / refreshAccessToken', () => {
  // PARITY: the vector survives the shared parser; typed errors replace the unsafe echoed-body error.
  it('exchanges a code for a token via the correct grant_type and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 'at-1', token_type: 'Bearer', expires_in: 3600 }));
    const result = await exchangeOAuthAuthorizationCode({ fetchFn: ({ url }, init) => fetchMock(url, init), guard: fixtureGuard, clock: createTestClock(),
        tokenEndpoint: 'https://auth.example.com/token',
        client: { clientId: 'client-1', authMethod: 'none' },
        redirectUri: 'http://127.0.0.1:5555/callback',
        code: 'code-1',
        codeVerifier: 'verifier-1',
      }
    );
    expect(result.accessToken).toBe('at-1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://auth.example.com/token');
    const body = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(init.headers['authorization']).toBeUndefined();
  });

  // PARITY: the vector survives the shared parser; typed errors replace the unsafe echoed-body error.
  it('includes a resource indicator and confidential-client basic auth when supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 'at-2' }));
    await exchangeOAuthAuthorizationCode({ fetchFn: ({ url }, init) => fetchMock(url, init), guard: fixtureGuard, clock: createTestClock(),
        tokenEndpoint: 'https://auth.example.com/token',
        client: { clientId: 'client-1', clientSecret: 'secret-1', authMethod: 'client_secret_basic' },
        redirectUri: 'http://127.0.0.1:5555/callback',
        code: 'code-1',
        codeVerifier: 'verifier-1',
      }, { resource: 'https://api.example.com' }
    );
    const [, init] = fetchMock.mock.calls[0]!;
    const body = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
    expect(body.get('resource')).toBe('https://api.example.com');
    expect(init.headers['authorization']).toBe(`Basic ${Buffer.from('client-1:secret-1').toString('base64')}`);
  });

  // PARITY: the vector survives the shared parser; typed errors replace the unsafe echoed-body error.
  it('refreshes an access token via grant_type=refresh_token, including optional scope/resource', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 'at-3' }));
    await refreshAccessToken({ fetchFn: ({ url }, init) => fetchMock(url, init), guard: fixtureGuard, clock: createTestClock(),
        tokenEndpoint: 'https://auth.example.com/token',
        client: { clientId: 'client-1', authMethod: 'none' },
        refreshToken: 'rt-1',
      }, { scopes: ['a', 'b'], resource: 'https://api.example.com' }
    );
    const [, init] = fetchMock.mock.calls[0]!;
    const body = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
    expect(body.get('scope')).toBe('a b');
    expect(body.get('resource')).toBe('https://api.example.com');
  });

  // PARITY: the vector survives the shared parser; typed errors replace the unsafe echoed-body error.
  it('accepts a host adapter for global fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 'at-4' }));
    vi.stubGlobal('fetch', fetchMock);
    await exchangeOAuthAuthorizationCode({ fetchFn: ({ url }, init) => fetch(url, init), guard: fixtureGuard, clock: createTestClock(),
      tokenEndpoint: 'https://auth.example.com/token',
      client: { clientId: 'client-1', authMethod: 'none' },
      redirectUri: 'http://127.0.0.1:5555/callback',
      code: 'code-1',
      codeVerifier: 'verifier-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  // PARITY: the vector survives the shared parser; typed errors replace the unsafe echoed-body error.
  it('throws with the response status/text on a non-ok token response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(
      exchangeOAuthAuthorizationCode({ fetchFn: ({ url }, init) => fetchMock(url, init), guard: fixtureGuard, clock: createTestClock(),
          tokenEndpoint: 'https://auth.example.com/token',
          client: { clientId: 'client-1', authMethod: 'none' },
          redirectUri: 'http://127.0.0.1:5555/callback',
          code: 'bad-code',
          codeVerifier: 'verifier-1',
        }
      ),
    ).rejects.toMatchObject({ code: 'OAUTH_INVALID_GRANT', message: 'the authorization server refused the request (HTTP 400, invalid_grant)' });
  });

  // PARITY: the vector survives the shared parser; typed errors replace the unsafe echoed-body error.
  it('propagates a failed body read without exposing an upstream response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.error(new Error('stream closed')); } }), { status: 500 }));
    await expect(
      exchangeOAuthAuthorizationCode({ fetchFn: ({ url }, init) => fetchMock(url, init), guard: fixtureGuard, clock: createTestClock(),
          tokenEndpoint: 'https://auth.example.com/token',
          client: { clientId: 'client-1', authMethod: 'none' },
          redirectUri: 'http://127.0.0.1:5555/callback',
          code: 'x',
          codeVerifier: 'y',
        }
      ),
    ).rejects.toThrow('stream closed');
  });

  // PARITY: the vector survives the shared parser; typed errors replace the unsafe echoed-body error.
  it('throws when the token endpoint response has no access_token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ token_type: 'Bearer' }));
    await expect(
      exchangeOAuthAuthorizationCode({ fetchFn: ({ url }, init) => fetchMock(url, init), guard: fixtureGuard, clock: createTestClock(),
          tokenEndpoint: 'https://auth.example.com/token',
          client: { clientId: 'client-1', authMethod: 'none' },
          redirectUri: 'http://127.0.0.1:5555/callback',
          code: 'x',
          codeVerifier: 'y',
        }
      ),
    ).rejects.toMatchObject({ code: 'OAUTH_MALFORMED_RESPONSE', message: "the authorization server's response contained no access token" });
  });
});

