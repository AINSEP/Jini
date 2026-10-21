import { fixtureGuard } from './fixtures.js';
import { describe, expect, it, vi } from 'vitest';
import { exchangeOAuthAuthorizationCode, refreshAccessToken } from '../src/index.js';
import { fixturePorts } from "./fixtures.js";
import assert from "node:assert/strict";
import { randomBytes } from 'node:crypto';
import { test } from "vitest";
import { requestOAuthToken } from "../src/index.js";
import { assertOAuthRejects, createFetchDouble, createTestClock, TEST_CLIENT } from "./helpers.js";
/** Token facade, transport, authentication and grant contracts; wire validation belongs upstream. */
const TOKEN_ENDPOINT = "https://auth.example.com/token";
for (const authMethod of ["none", "client_secret_post", "client_secret_basic"] as const) {
    test(`token requests authenticate using ${authMethod}`, async () => {
        const http = createFetchDouble([{ json: { token_type: 'Bearer', access_token: "at" } }]);
        const client = { clientId: "id: /+", clientSecret: "secret: /+", authMethod };
        await requestOAuthToken({
            ...fixturePorts,
            clock: createTestClock(), fetchFn: http.fetchFn,
            tokenEndpoint: TOKEN_ENDPOINT, client, params: { grant_type: "authorization_code", code: "c" }
        });
        const request = http.requests[0];
        assert.equal(request.body.get("client_id"), authMethod === "client_secret_basic" ? null : client.clientId);
        assert.equal(request.body.get("client_secret"), authMethod === "client_secret_post" ? client.clientSecret : null);
        // RFC 6749 uses form encoding (including '+' for spaces) before the pair is base64 encoded.
        assert.equal(request.headers.authorization, authMethod === "client_secret_basic"
            ? `Basic ${Buffer.from("id%3A+%2F%2B:secret%3A+%2F%2B").toString("base64")}` : undefined);
    });
}
test("an unsupported token_type is refused by the upstream token processor", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ json: { access_token: "at", token_type: "mac" } }]);
    const error = await assertOAuthRejects(() => requestOAuthToken({
        ...fixturePorts,
        clock, fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: "authorization_code" }
    }), 'OAUTH_MALFORMED_RESPONSE');
    assert.equal(error.message, "the authorization server's response did not contain a supported OAuth token set");
    assert.equal(error.cause, undefined, 'upstream errors may retain token response secrets');
    assert.equal(http.callCount(), 1);
});
test("a non-empty refresh_token passes through unchanged", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ json: { token_type: 'Bearer', access_token: "at", refresh_token: "rt-1" } }]);
    const tokens = await requestOAuthToken({
        ...fixturePorts,
        clock, fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: "authorization_code" }
    });
    assert.equal(tokens.refreshToken, "rt-1");
});
test("HTTP 200 with authorization_pending remains a retryable provider error", async () => {
    const http = createFetchDouble([{ status: 200, json: { token_type: 'Bearer', error: "authorization_pending", access_token: "must-not-win" } }]);
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
for (const status of [200, 400, 503]) {
    test(`HTTP ${status} provider error fields cannot disclose a token-shaped value`, async () => {
        const providerError = `sk-${randomBytes(24).toString('base64url')}`;
        const http = createFetchDouble([{ status, json: { error: providerError, error_description: providerError } }]);
        const error = await assertOAuthRejects(() => requestOAuthToken({
            ...fixturePorts, clock: createTestClock(), fetchFn: http.fetchFn,
            tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: 'authorization_code' },
        }), 'OAUTH_PROVIDER_REJECTED');
        assert.equal(error.message, `the authorization server refused the request (HTTP ${status}, invalid_provider_error)`);
        assert.equal(error.providerErrorCode, 'invalid_provider_error');
        assert.equal(error.cause, undefined);
        assert.equal(JSON.stringify(error).includes(providerError), false);
        assert.equal(http.callCount(), 1);
    });
}
test("scope accepts comma and whitespace separators without empty scopes", async () => {
    const http = createFetchDouble([{ json: { token_type: 'Bearer', access_token: "at", scope: "  read,write  profile,  email " } }]);
    const tokens = await requestOAuthToken({
        ...fixturePorts,
        clock: createTestClock(), fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: "authorization_code" }
    });
    assert.deepEqual(tokens.scopes, ["read", "write", "profile", "email"]);
});
for (const idToken of [undefined, null, '', 42, false]) {
    test(`an unusable ID token (${String(idToken)}) preserves the OAuth-only result shape`, async () => {
        const http = createFetchDouble([{ json: { token_type: 'Bearer', access_token: 'fixture-access', id_token: idToken } }]);
        const result = await requestOAuthToken({
            ...fixturePorts, clock: createTestClock(), fetchFn: http.fetchFn,
            tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: 'authorization_code' },
        });
        assert.deepEqual(result, {
            accessToken: 'fixture-access', refreshToken: null, tokenType: 'Bearer', scopes: [], expiresAt: null,
        });
        assert.equal(http.callCount(), 1);
    });
}

for (const grantType of ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code']) {
    test(`the ${grantType} processor retains an unvalidated ID token without identity I/O`, async () => {
        const http = createFetchDouble([{ json: { token_type: 'Bearer',
            access_token: 'fixture-access', id_token: 'fixture-unvalidated-id-token',
        } }]);
        const result = await requestOAuthToken({
            ...fixturePorts, clock: createTestClock(), fetchFn: http.fetchFn,
            tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT,
            params: { grant_type: grantType, refresh_token: 'fixture-refresh', device_code: 'fixture-device' },
        });
        assert.deepEqual(result, {
            accessToken: 'fixture-access', refreshToken: null, tokenType: 'Bearer', scopes: [], expiresAt: null,
            idToken: 'fixture-unvalidated-id-token',
        });
        assert.equal(http.callCount(), 1);
    });
}

for (const status of [200, 400, 503]) {
    test(`HTTP ${status} provider errors retain codes, retry intervals and safe copy`, async () => {
        const privateDescription = 'fixture-description-must-not-escape';
        const http = createFetchDouble([{ status, json: {
            error: 'slow_down', error_description: privateDescription, interval: 17,
        } }]);
        const error = await assertOAuthRejects(() => requestOAuthToken({
            ...fixturePorts, clock: createTestClock(), fetchFn: http.fetchFn,
            tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT,
            params: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
        }), 'OAUTH_SLOW_DOWN');
        assert.equal(error.message, `the authorization server refused the request (HTTP ${status}, slow_down)`);
        assert.equal(error.providerErrorCode, 'slow_down');
        assert.equal(error.retryAfterSeconds, 17);
        assert.equal(error.retryable, true);
        assert.equal(error.cause, undefined);
        assert.equal(JSON.stringify(error).includes(privateDescription), false);
        assert.equal(http.callCount(), 1);
    });
}

test('supported token types preserve provider casing after upstream validation', async () => {
    const http = createFetchDouble([{ json: { access_token: 'fixture-access', token_type: 'bEaReR' } }]);
    const result = await requestOAuthToken({
        ...fixturePorts, clock: createTestClock(), fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: 'authorization_code' },
    });
    assert.equal(result.tokenType, 'bEaReR');
});

test('upstream grant requests retain repeated resources and a string-only guarded transport body', async () => {
    const http = createFetchDouble([{ json: { token_type: 'Bearer', access_token: 'fixture-access' } }]);
    const resources = ['https://api.example.com/one', 'https://api.example.com/two'];
    await requestOAuthToken({
        ...fixturePorts, clock: createTestClock(), fetchFn: async (args, init) => {
            assert.equal(typeof init?.body, 'string');
            assert.equal(init?.redirect, 'error');
            assert.ok(init?.signal instanceof AbortSignal);
            assert.equal(init.signal.aborted, false);
            return http.fetchFn(args, init);
        },
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT,
        params: { grant_type: 'authorization_code', code: 'fixture-code' },
    }, { resource: resources });
    assert.deepEqual(http.requests[0]?.body.getAll('resource'), resources);
    assert.equal(http.requests[0]?.body.get('code'), 'fixture-code');
    assert.equal(http.callCount(), 1);
});

test('guard refusal prevents the upstream request from reaching the host transport', async () => {
    const http = createFetchDouble([{ json: { token_type: 'Bearer', access_token: 'fixture-access' } }]);
    await assertOAuthRejects(() => requestOAuthToken({
        ...fixturePorts, clock: createTestClock(), fetchFn: http.fetchFn,
        tokenEndpoint: 'https://192.168.1.9/token', client: TEST_CLIENT, params: { grant_type: 'authorization_code' },
    }), 'OAUTH_UNSAFE_ENDPOINT');
    assert.equal(http.callCount(), 0);
});

test('a redirect returned by an injected fetch is refused and its body cancelled', async () => {
    let cancelled = false;
    const fetchFn = vi.fn(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
        status: 302, headers: { location: 'https://other.example.com/token' },
    }));
    const error = await assertOAuthRejects(() => requestOAuthToken({
        ...fixturePorts, clock: createTestClock(), fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: 'authorization_code' },
    }), 'OAUTH_UNSAFE_ENDPOINT');
    assert.equal(error.message, 'refusing to follow an OAuth endpoint redirect');
    assert.equal(cancelled, true);
    assert.equal(fetchFn.mock.calls.length, 1);
});

test('oversized responses retain the facade byte-cap error before upstream JSON processing', async () => {
    const http = createFetchDouble([{ text: JSON.stringify({ token_type: 'Bearer', access_token: 'x'.repeat(64 * 1024) }) }]);
    const error = await assertOAuthRejects(() => requestOAuthToken({
        ...fixturePorts, clock: createTestClock(), fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: 'authorization_code' },
    }), 'OAUTH_MALFORMED_RESPONSE');
    assert.equal(error.message, "the authorization server's response exceeded 65536 bytes");
    assert.equal(http.callCount(), 1);
});

test('network failures retain the facade error and are never retried by the library', async () => {
    const cause = new Error('fixture-network-failure');
    const http = createFetchDouble([{ throws: cause }]);
    const error = await assertOAuthRejects(() => requestOAuthToken({
        ...fixturePorts, clock: createTestClock(), fetchFn: http.fetchFn,
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: 'authorization_code' },
    }), 'OAUTH_PROVIDER_UNREACHABLE');
    assert.equal(error.message, 'could not reach the authorization server at auth.example.com');
    assert.equal(error.cause, cause);
    assert.equal(http.callCount(), 1);
});

test('the caller deadline reaches the guarded transport without the upstream default timeout', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    let notifyStarted: () => void = () => { throw new Error('fixture not initialized'); };
    const started = new Promise<void>(resolve => { notifyStarted = resolve; });
    const fetchFn = vi.fn(async (_args: { readonly url: string | URL | Request }, init?: RequestInit): Promise<Response> => {
        const signal = init?.signal;
        assert.ok(signal instanceof AbortSignal);
        return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            notifyStarted();
        });
    });
    try {
        const rejected = assertOAuthRejects(() => requestOAuthToken({
            ...fixturePorts, clock: createTestClock(), fetchFn,
            tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: 'authorization_code' },
        }, { timeoutMs: 23 }), 'OAUTH_PROVIDER_UNREACHABLE');
        await started;
        assert.deepEqual(timeout.mock.calls, [[23]], 'only the guarded adapter configures a deadline');
        deadline.abort(new DOMException('fixture-deadline', 'TimeoutError'));
        const error = await rejected;
        assert.equal(error.message, 'could not reach the authorization server at auth.example.com');
        assert.equal(fetchFn.mock.calls.length, 1);
    } finally {
        timeout.mockRestore();
    }
});

test('upstream refuses a successful-looking token with HTTP 201', async () => {
    let calls = 0;
    const error = await assertOAuthRejects(() => requestOAuthToken({
        ...fixturePorts, clock: createTestClock(), fetchFn: async () => {
            calls += 1;
            return Response.json({ token_type: 'Bearer', access_token: 'fixture-access' }, { status: 201 });
        },
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: 'authorization_code' },
    }), 'OAUTH_MALFORMED_RESPONSE');
    assert.equal(error.cause, undefined);
    assert.equal(error.message, "the authorization server's response did not contain a supported OAuth token set");
    assert.equal(calls, 1);
});

test('a valid JSON token object retains compatibility with a non-JSON media type', async () => {
    let calls = 0;
    // The pinned engine checks media type only when JSON parsing fails. A valid object with
    // text/plain remains accepted, matching the existing facade's content-type-independent parser.
    const result = await requestOAuthToken({
        ...fixturePorts, clock: createTestClock(), fetchFn: async () => {
            calls += 1;
            return new Response(JSON.stringify({ token_type: 'Bearer', access_token: 'fixture-access', scope: 'read,write', expires_in: '60' }), {
                headers: { 'content-type': 'text/plain' },
            });
        },
        tokenEndpoint: TOKEN_ENDPOINT, client: TEST_CLIENT, params: { grant_type: 'authorization_code' },
    });
    assert.deepEqual(result, { accessToken: 'fixture-access', refreshToken: null, tokenType: 'Bearer',
        scopes: ['read', 'write'], expiresAt: '2026-08-25T12:01:00.000Z' });
    assert.equal(calls, 1);
});

for (const authMethod of ['client_secret_basic', 'client_secret_post'] as const) {
    test(`upstream refuses missing ${authMethod} credentials before sending`, async () => {
        const http = createFetchDouble([{ json: { token_type: 'Bearer', access_token: 'fixture-access' } }]);
        const error = await assertOAuthRejects(() => requestOAuthToken({
            ...fixturePorts, clock: createTestClock(), fetchFn: http.fetchFn,
            tokenEndpoint: TOKEN_ENDPOINT, client: { clientId: 'fixture-client', authMethod },
            params: { grant_type: 'authorization_code' },
        }), 'OAUTH_INVALID_REQUEST');
        assert.equal(error.cause, undefined);
        assert.equal(http.callCount(), 0);
    });
}

const invalidGrantInputs: readonly {
    readonly label: string;
    readonly client: typeof TEST_CLIENT;
    readonly params: Readonly<Record<string, string>>;
}[] = [
    { label: 'empty client id', client: { ...TEST_CLIENT, clientId: '' }, params: { grant_type: 'authorization_code' } },
    { label: 'missing grant type', client: TEST_CLIENT, params: {} },
    { label: 'empty refresh token', client: TEST_CLIENT, params: { grant_type: 'refresh_token', refresh_token: '' } },
];
for (const input of invalidGrantInputs) {
    test(`upstream refuses ${input.label} before sending`, async () => {
        const http = createFetchDouble([{ json: { token_type: 'Bearer', access_token: 'fixture-access' } }]);
        const error = await assertOAuthRejects(() => requestOAuthToken({
            ...fixturePorts, clock: createTestClock(), fetchFn: http.fetchFn,
            tokenEndpoint: TOKEN_ENDPOINT, client: input.client, params: input.params,
        }), 'OAUTH_INVALID_REQUEST');
        assert.equal(error.message, 'the OAuth grant or client configuration is invalid');
        assert.equal(error.cause, undefined);
        assert.equal(http.callCount(), 0);
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
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ token_type: 'Bearer', access_token: 'at-2' }));
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
    // openid-client form-encodes both credentials before Basic authentication.
    expect(init.headers['authorization']).toBe(`Basic ${Buffer.from('client%2D1:secret%2D1').toString('base64')}`);
  });

  // PARITY: the vector survives the shared parser; typed errors replace the unsafe echoed-body error.
  it('refreshes an access token via grant_type=refresh_token, including optional scope/resource', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ token_type: 'Bearer', access_token: 'at-3' }));
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
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ token_type: 'Bearer', access_token: 'at-4' }));
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
