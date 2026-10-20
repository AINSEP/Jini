import { fixturePorts } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { beginDeviceAuthorization, pollDeviceAuthorizationOnce } from "../src/index.js";
import { assertOAuthRejects, createFetchDouble, createTestClock, TEST_CLIENT, TEST_PROVIDER } from "./helpers.js";
/**
 * @file The device authorization grant (RFC 8628) — the path a self-hosted install with no public
 * callback URL has to use.
 *
 * The assertions that matter: the two "keep polling" codes are the ONLY retryable outcomes, every
 * other outcome is terminal, one call means one poll (the module must not hide a loop), and the
 * provider-supplied `verification_uri` — which gets rendered to a human as a link — is validated
 * before it is handed back.
 */
const DEVICE_RESPONSE = {
    device_code: "dev-code-secret",
    user_code: "WDJB-MJHT",
    verification_uri: "https://auth.example.com/activate",
    verification_uri_complete: "https://auth.example.com/activate?user_code=WDJB-MJHT",
    expires_in: 900,
    interval: 5,
};
test("begin returns the user-facing code and URL plus the secret device code", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ json: DEVICE_RESPONSE }]);
    const started = await beginDeviceAuthorization({
        ...fixturePorts,
        provider: TEST_PROVIDER, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT
    });
    assert.deepEqual(started, {
        deviceCode: "dev-code-secret",
        userCode: "WDJB-MJHT",
        verificationUri: "https://auth.example.com/activate",
        verificationUriComplete: "https://auth.example.com/activate?user_code=WDJB-MJHT",
        expiresAt: "2026-08-25T12:15:00.000Z",
        intervalSeconds: 5,
    });
    const startedRequest = http.requests[0];
    assert.ok(startedRequest);
    assert.equal(startedRequest.url, "https://auth.example.com/device");
    assert.equal(startedRequest.body.get("scope"), "images:generate");
});
test("Google's pre-RFC `verification_url` spelling is accepted rather than reported as missing", async () => {
    const clock = createTestClock();
    const { verification_uri: _dropped, ...withoutUri } = DEVICE_RESPONSE;
    const http = createFetchDouble([{ json: { ...withoutUri, verification_url: "https://auth.example.com/activate" } }]);
    const started = await beginDeviceAuthorization({
        ...fixturePorts,
        provider: TEST_PROVIDER, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT
    });
    assert.equal(started.verificationUri, "https://auth.example.com/activate");
});
for (const field of ["device_code", "user_code"] as const) {
    for (const value of [undefined, "", null, 42]) {
        test(`begin refuses ${field}=${String(value)} instead of returning an unusable authorization`, async () => {
            const http = createFetchDouble([{ json: { ...DEVICE_RESPONSE, [field]: value } }]);
            const error = await assertOAuthRejects(() => beginDeviceAuthorization({
                ...fixturePorts,
                provider: TEST_PROVIDER, clock: createTestClock(), fetchFn: http.fetchFn,
                client: TEST_CLIENT
            }), "OAUTH_MALFORMED_RESPONSE");
            assert.equal(error.message, `the device authorization response is missing '${field}'`);
        });
    }
}
for (const [expiresIn, expiresAt] of [
    [999999, "2026-08-25T12:30:00.000Z"],
    [1, "2026-08-25T12:00:30.000Z"],
] as const) {
    test(`begin clamps expires_in=${expiresIn} to a bounded local deadline`, async () => {
        const http = createFetchDouble([{ json: { ...DEVICE_RESPONSE, expires_in: expiresIn } }]);
        const started = await beginDeviceAuthorization({
            ...fixturePorts,
            provider: TEST_PROVIDER, clock: createTestClock(), fetchFn: http.fetchFn,
            client: TEST_CLIENT
        });
        assert.equal(started.expiresAt, expiresAt);
    });
}
for (const completeUri of [
    "javascript:alert(1)",
    "http://auth.example.com/activate?user_code=WDJB-MJHT",
    "https://user:secret@auth.example.com/activate?user_code=WDJB-MJHT",
]) {
    test(`begin refuses an unsafe prefilled verification link: ${completeUri}`, async () => {
        const http = createFetchDouble([{ json: { ...DEVICE_RESPONSE, verification_uri_complete: completeUri } }]);
        await assertOAuthRejects(() => beginDeviceAuthorization({
            ...fixturePorts,
            provider: TEST_PROVIDER, clock: createTestClock(), fetchFn: http.fetchFn,
            client: TEST_CLIENT
        }), "OAUTH_UNSAFE_ENDPOINT");
    });
}
test("a javascript: verification URI is refused — it would be rendered to an operator as a link", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ json: { ...DEVICE_RESPONSE, verification_uri: "javascript:alert(1)", verification_uri_complete: null } }]);
    const error = await assertOAuthRejects(() => beginDeviceAuthorization({
        ...fixturePorts,
        provider: TEST_PROVIDER, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT
    }), "OAUTH_UNSAFE_ENDPOINT");
    assert.equal(error.message, "provider-supplied link must use https (http is permitted only for loopback)");
});
test("a verification URI embedding credentials is refused", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([
        { json: { ...DEVICE_RESPONSE, verification_uri: "https://auth.example.com@evil.example.net/activate", verification_uri_complete: null } },
    ]);
    const error = await assertOAuthRejects(() => beginDeviceAuthorization({
        ...fixturePorts,
        provider: TEST_PROVIDER, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT
    }), "OAUTH_UNSAFE_ENDPOINT");
    assert.equal(error.message, "provider-supplied link embeds credentials in the URL");
});
test("a hostile poll interval is clamped rather than wedging the flow", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ json: { ...DEVICE_RESPONSE, interval: 86400 } }]);
    const started = await beginDeviceAuthorization({
        ...fixturePorts,
        provider: TEST_PROVIDER, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT
    });
    assert.equal(started.intervalSeconds, 60);
});
test("a missing interval falls back to RFC 8628's default of 5 seconds", async () => {
    const clock = createTestClock();
    const { interval: _dropped, ...withoutInterval } = DEVICE_RESPONSE;
    const http = createFetchDouble([{ json: withoutInterval }]);
    const started = await beginDeviceAuthorization({
        ...fixturePorts,
        provider: TEST_PROVIDER, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT
    });
    assert.equal(started.intervalSeconds, 5);
});
test("a provider that declares no device endpoint refuses the grant instead of guessing a URL", async () => {
    const clock = createTestClock();
    const provider = { ...TEST_PROVIDER, supportedGrants: ["authorization_code"] as const, deviceAuthorizationEndpoint: undefined };
    const http = createFetchDouble([{ json: DEVICE_RESPONSE }]);
    const error = await assertOAuthRejects(() => beginDeviceAuthorization({
        ...fixturePorts,
        provider, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT
    }), "OAUTH_UNSUPPORTED_GRANT");
    assert.equal(error.message, "provider 'test-provider' does not support the device grant");
    assert.equal(http.callCount(), 0);
});
test("an HTTP-level rejection with no provider error code still surfaces as OAUTH_PROVIDER_REJECTED", async () => {
    // Pins the `!response.ok || typeof body.error === "string"` branch's non-error-field half
    // before it moves into its own function.
    const clock = createTestClock();
    const http = createFetchDouble([{ status: 400, json: { message: "bad request" } }]);
    const error = await assertOAuthRejects(() => beginDeviceAuthorization({
        ...fixturePorts,
        provider: TEST_PROVIDER, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT
    }), "OAUTH_PROVIDER_REJECTED");
    assert.equal(error.message, "the authorization server refused the device authorization request (HTTP 400)");
    assert.equal(error.providerErrorCode, undefined);
});
test("authorization_pending is the retryable outcome, and one call is one poll", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ status: 400, json: { error: "authorization_pending" } }]);
    const error = await assertOAuthRejects(() => pollDeviceAuthorizationOnce({
        ...fixturePorts,
        provider: TEST_PROVIDER, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT, deviceCode: "dev-code-secret", expiresAt: "2026-08-25T12:15:00.000Z"
    }), "OAUTH_AUTHORIZATION_PENDING");
    assert.equal(error.retryable, true);
    assert.equal(http.callCount(), 1, "pollDeviceAuthorizationOnce must not loop internally");
});
test("slow_down is retryable and carries the interval the server asked for", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ status: 400, json: { error: "slow_down", interval: 10 } }]);
    const error = await assertOAuthRejects(() => pollDeviceAuthorizationOnce({
        ...fixturePorts,
        provider: TEST_PROVIDER, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT, deviceCode: "dev-code-secret", expiresAt: "2026-08-25T12:15:00.000Z"
    }), "OAUTH_SLOW_DOWN");
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterSeconds, 10);
});
test("access_denied ends the flow — the operator said no, retrying would just re-ask", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ status: 400, json: { error: "access_denied" } }]);
    const error = await assertOAuthRejects(() => pollDeviceAuthorizationOnce({
        ...fixturePorts,
        provider: TEST_PROVIDER, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT, deviceCode: "dev-code-secret", expiresAt: "2026-08-25T12:15:00.000Z"
    }), "OAUTH_ACCESS_DENIED");
    assert.equal(error.retryable, false);
});
test("an expired device authorization is detected locally and costs no outbound request", async () => {
    const clock = createTestClock();
    clock.advance(16 * 60 * 1000);
    const http = createFetchDouble([{ json: { access_token: "at" } }]);
    const error = await assertOAuthRejects(() => pollDeviceAuthorizationOnce({
        ...fixturePorts,
        provider: TEST_PROVIDER, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT, deviceCode: "dev-code-secret", expiresAt: "2026-08-25T12:15:00.000Z"
    }), "OAUTH_EXPIRED_TOKEN");
    assert.equal(error.retryable, false);
    assert.equal(error.message, "the device authorization expired before it was approved");
    assert.equal(http.callCount(), 0);
});
test("an approved poll returns the token set with the RFC 8628 grant type on the wire", async () => {
    const clock = createTestClock();
    const http = createFetchDouble([{ json: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 } }]);
    const tokens = await pollDeviceAuthorizationOnce({
        ...fixturePorts,
        provider: TEST_PROVIDER, clock, fetchFn: http.fetchFn,
        client: TEST_CLIENT, deviceCode: "dev-code-secret", expiresAt: "2026-08-25T12:15:00.000Z"
    });
    assert.equal(tokens.accessToken, "at-1");
    assert.equal(tokens.refreshToken, "rt-1");
    const pollRequest = http.requests[0];
    assert.ok(pollRequest);
    assert.equal(pollRequest.body.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
    assert.equal(pollRequest.body.get("device_code"), "dev-code-secret");
});

for (const [expiresIn, interval, expiresAt, intervalSeconds] of [
    [undefined, undefined, '2026-08-25T12:30:00.000Z', 5],
    ['12.1', '2.1', '2026-08-25T12:00:30.000Z', 3],
    [null, null, '2026-08-25T12:00:30.000Z', 1],
    ['invalid', 'invalid', '2026-08-25T12:30:00.000Z', 5],
    [900.1, -4, '2026-08-25T12:15:01.000Z', 1],
] as const) {
    test(`device compatibility retains lifetime/interval coercion for ${String(expiresIn)}/${String(interval)}`, async () => {
        const http = createFetchDouble([{ json: { ...DEVICE_RESPONSE, expires_in: expiresIn, interval,
            verification_uri_complete: null } }]);
        const result = await beginDeviceAuthorization({ ...fixturePorts, provider: TEST_PROVIDER,
            clock: createTestClock(), fetchFn: http.fetchFn, client: TEST_CLIENT });
        assert.equal(result.expiresAt, expiresAt);
        assert.equal(result.intervalSeconds, intervalSeconds);
        assert.equal(result.verificationUriComplete, null);
        assert.equal(http.callCount(), 1);
    });
}

test('device initiation preserves resource repetition, redirect refusal and its host request port', async () => {
    const http = createFetchDouble([{ status: 201, json: DEVICE_RESPONSE }]);
    await beginDeviceAuthorization({ ...fixturePorts, provider: TEST_PROVIDER, clock: createTestClock(),
        fetchFn: http.fetchFn, client: TEST_CLIENT }, { resource: ['https://api.example/a', 'https://api.example/b'] });
    const request = http.requests[0];
    assert.ok(request);
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    // Upstream declares UTF-8 explicitly; body serialization still uses the host's string ABI.
    assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded;charset=UTF-8');
    assert.equal(request.body.get('client_id'), TEST_CLIENT.clientId);
    assert.equal(request.body.has('client_secret'), false);
    assert.deepEqual(request.body.getAll('resource'), ['https://api.example/a', 'https://api.example/b']);
    assert.equal(http.callCount(), 1);
});

test('device compatibility still accepts a JSON object with a non-JSON media type', async () => {
    const result = await beginDeviceAuthorization({ ...fixturePorts, provider: TEST_PROVIDER,
        clock: createTestClock(), client: TEST_CLIENT,
        fetchFn: async () => new Response(JSON.stringify(DEVICE_RESPONSE), { headers: { 'content-type': 'text/plain' } }),
    });
    assert.equal(result.deviceCode, DEVICE_RESPONSE.device_code);
    assert.equal(result.verificationUri, DEVICE_RESPONSE.verification_uri);
});

for (const authMethod of ['none', 'client_secret_post', 'client_secret_basic'] as const) {
    test(`upstream device initiation authenticates ${authMethod} through the supplied transport only`, async () => {
        const http = createFetchDouble([{ json: DEVICE_RESPONSE }]);
        const client = { clientId: 'fixture: /+', clientSecret: 'fixture credential: /+', authMethod };
        const nativeFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected native fetch'));
        try {
            await beginDeviceAuthorization({ ...fixturePorts, provider: TEST_PROVIDER, clock: createTestClock(),
                client, fetchFn: http.fetchFn });
            const request = http.requests[0];
            assert.ok(request);
            assert.equal(request.body.get('client_id'), client.clientId);
            assert.equal(request.body.get('client_secret'), authMethod === 'client_secret_post' ? client.clientSecret : null);
            assert.equal(request.headers.authorization, authMethod === 'client_secret_basic'
                ? `Basic ${Buffer.from('fixture%3A+%2F%2B:fixture+credential%3A+%2F%2B').toString('base64')}` : undefined);
            assert.equal(nativeFetch.mock.calls.length, 0);
            assert.equal(http.callCount(), 1);
        } finally {
            nativeFetch.mockRestore();
        }
    });
}

for (const client of [
    { ...TEST_CLIENT, clientId: '' },
    { clientId: 'fixture', authMethod: 'client_secret_basic' as const },
    { clientId: 'fixture', clientSecret: '', authMethod: 'client_secret_post' as const },
]) {
    test(`device initiation refuses invalid ${client.authMethod} identity/credentials before HTTP`, async () => {
        const http = createFetchDouble([{ json: DEVICE_RESPONSE }]);
        const error = await assertOAuthRejects(() => beginDeviceAuthorization({ ...fixturePorts,
            provider: TEST_PROVIDER, clock: createTestClock(), client, fetchFn: http.fetchFn }), 'OAUTH_INVALID_REQUEST');
        assert.equal(error.message, 'the OAuth grant or client configuration is invalid');
        assert.equal(error.cause, undefined);
        assert.equal(http.callCount(), 0);
    });
}

test('device initiation bounds the original response before projecting known protocol fields', async () => {
    const http = createFetchDouble([{ json: { ...DEVICE_RESPONSE, ignored: 'x'.repeat(16 * 1024) } }]);
    const error = await assertOAuthRejects(() => beginDeviceAuthorization({ ...fixturePorts,
        provider: TEST_PROVIDER, clock: createTestClock(), client: TEST_CLIENT, fetchFn: http.fetchFn }), 'OAUTH_MALFORMED_RESPONSE');
    assert.equal(error.message, 'the device authorization response exceeded 16384 bytes');
    assert.equal(http.callCount(), 1);
});

test('device initiation refuses redirects before returning or following a verification link', async () => {
    let calls = 0;
    const error = await assertOAuthRejects(() => beginDeviceAuthorization({ ...fixturePorts,
        provider: TEST_PROVIDER, clock: createTestClock(), client: TEST_CLIENT,
        fetchFn: async () => {
            calls++;
            return new Response(JSON.stringify(DEVICE_RESPONSE), { status: 302, headers: { location: 'https://other.example/device' } });
        },
    }), 'OAUTH_UNSAFE_ENDPOINT');
    assert.equal(error.cause, undefined);
    assert.equal(calls, 1);
});

test('device initiation keeps the original transport cause and error copy without retrying', async () => {
    const cause = new Error('fixture network failure');
    const http = createFetchDouble([{ throws: cause }]);
    const error = await assertOAuthRejects(() => beginDeviceAuthorization({ ...fixturePorts,
        provider: TEST_PROVIDER, clock: createTestClock(), client: TEST_CLIENT, fetchFn: http.fetchFn }), 'OAUTH_PROVIDER_UNREACHABLE');
    assert.equal(error.message, 'could not reach the device authorization endpoint at auth.example.com');
    assert.equal(error.operatorAction, 'Check network access to this provider, then start the connection again. Nothing was retried automatically.');
    assert.equal(error.cause, cause);
    assert.equal(http.callCount(), 1);
});

for (const status of [200, 400, 503]) {
    test(`device initiation preserves provider errors on HTTP ${status} without exposing response data`, async () => {
        const http = createFetchDouble([{ status, json: { ...DEVICE_RESPONSE,
            error: 'invalid_client', error_description: 'fixture confidential description' } }]);
        const error = await assertOAuthRejects(() => beginDeviceAuthorization({ ...fixturePorts,
            provider: TEST_PROVIDER, clock: createTestClock(), client: TEST_CLIENT, fetchFn: http.fetchFn }), 'OAUTH_PROVIDER_REJECTED');
        assert.equal(error.message, `the authorization server refused the device authorization request (HTTP ${status})`);
        assert.equal(error.providerErrorCode, 'invalid_client');
        assert.equal(error.cause, undefined);
        assert.equal(http.callCount(), 1);
    });
}

test('device initiation keeps its deadline active until the response body has finished', async () => {
    let signal: AbortSignal | undefined;
    let calls = 0;
    const keepAlive = setTimeout(() => {}, 2000);
    try {
        await assert.rejects(() => beginDeviceAuthorization({ ...fixturePorts,
            provider: TEST_PROVIDER, clock: createTestClock(), client: TEST_CLIENT,
            fetchFn: async (_args, options) => {
                calls++;
                const requestSignal = options?.signal;
                assert.ok(requestSignal instanceof AbortSignal);
                signal = requestSignal;
                return new Response(new ReadableStream<Uint8Array>({
                    start(controller) {
                        requestSignal.addEventListener('abort', () => controller.error(requestSignal.reason), { once: true });
                    },
                }), { headers: { 'content-type': 'application/json' } });
            },
        }, { timeoutMs: 20 }), { name: 'TimeoutError' });
        assert.equal(signal?.aborted, true);
        assert.equal(calls, 1);
    } finally {
        clearTimeout(keepAlive);
    }
});
