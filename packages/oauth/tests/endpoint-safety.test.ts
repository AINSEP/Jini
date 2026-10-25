import { createOAuthUrlGuard } from '../src/index.js';
import { fixtureGuard } from "./fixtures.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { assertSafeUserFacingUrl } from "../src/index.js";
test("safe URLs return normalized URLs and permit plaintext only on loopback", () => {
    assert.equal(fixtureGuard.assertSafeUrl({
        raw: "  https://AUTH.example.com/token?q=7  ",
        label: "token endpoint"
    }).href, "https://auth.example.com/token?q=7");
    for (const raw of ["http://localhost:8080/token", "http://127.0.0.1:8080/token", "http://[::1]:8080/token"]) {
        assert.equal(fixtureGuard.assertSafeUrl({
            raw: raw,
            label: "token endpoint"
        }).href, raw);
        assert.equal(assertSafeUserFacingUrl({
            raw: raw,
            guard: fixtureGuard
        }).href, raw);
    }
    assert.equal(assertSafeUserFacingUrl({
        raw: "https://auth.example.com/activate?code=ABC",
        guard: fixtureGuard
    }).href, "https://auth.example.com/activate?code=ABC");
});
// F4.4: HTTPS internal-address fixtures cannot fail the scheme guard instead.
for (const [raw, reason, action] of [
    ["/relative/token", "is not a valid absolute URL", "Check the OAuth endpoints configured for this provider."],
    ["http://auth.example.com/token", "must use https (http is permitted only for loopback)", "Use an https:// URL for this provider."],
    ["javascript:alert(1)", "must use https (http is permitted only for loopback)", "Use an https:// URL for this provider."],
    ["https://10.1.2.3/token", "resolves to an internal address, which is not allowed", "Point this provider at a publicly reachable authorization server."],
    ["https://169.254.169.254/token", "resolves to an internal address, which is not allowed", "Point this provider at a publicly reachable authorization server."],
    ["https://[fd00::1]/token", "resolves to an internal address, which is not allowed", "Point this provider at a publicly reachable authorization server."],
] as const) {
    test(`endpoint and displayed link refuse ${raw} with the correct subject and action`, () => {
        assert.throws(() => fixtureGuard.assertSafeUrl({
            raw: raw,
            label: "token endpoint"
        }), {
            name: "OAuthError", code: "OAUTH_UNSAFE_ENDPOINT", message: `token endpoint: provider endpoint ${reason}`,
            operatorAction: action,
        });
        assert.throws(() => assertSafeUserFacingUrl({
            raw: raw,
            guard: fixtureGuard
        }), {
            name: "OAuthError", code: "OAUTH_UNSAFE_ENDPOINT", message: `provider-supplied link ${reason}`,
            operatorAction: action,
        });
    });
}
for (const raw of ["https://user@auth.example.com/activate", "https://:password@auth.example.com/activate"]) {
    test(`userinfo is accepted for operator endpoints but refused in displayed links: ${raw}`, () => {
        assert.equal(fixtureGuard.assertSafeUrl({
            raw: raw,
            label: "token endpoint"
        }).href, raw);
        assert.throws(() => assertSafeUserFacingUrl({
            raw: raw,
            guard: fixtureGuard
        }), {
            name: "OAuthError", code: "OAUTH_UNSAFE_ENDPOINT", message: "provider-supplied link embeds credentials in the URL",
            operatorAction: "This provider's device-authorization response is malformed — do not open the link.",
        });
    });
}

// REGRESSION: fails if createOAuthUrlGuard restores the three-host loopback whitelist.
test('explicit loopback HTTP allows the full IPv4 range and IPv4-mapped IPv6', () => {
    const guard = createOAuthUrlGuard({ assertAllowed: () => undefined }, { allowLoopbackHttp: true });
    for (const raw of ['http://127.0.0.2/token', 'http://127.255.255.255/token',
        'http://[::ffff:127.0.0.2]/token', 'http://[::ffff:7fff:ffff]/token']) {
        assert.equal(guard.assertSafeUrl({ raw, label: 'token endpoint' }).href, new URL(raw).href);
    }
    for (const raw of ['http://128.0.0.2/token', 'http://[::ffff:8000:2]/token']) {
        assert.throws(() => guard.assertSafeUrl({ raw, label: 'token endpoint' }), { code: 'OAUTH_UNSAFE_ENDPOINT' });
    }
    const secure = createOAuthUrlGuard({ assertAllowed: () => undefined });
    assert.throws(() => secure.assertSafeUrl({ raw: 'http://127.0.0.2/token', label: 'token endpoint' }), { code: 'OAUTH_UNSAFE_ENDPOINT' });
});

// F1 fix wave (Stryker L1 §4 endpoint-safety.ts:14,18 — loopback regex anchors and bracket strip
// survived). Each http:// host below is one character class / anchor away from a loopback form.
test('F1: loopback http exception is anchored — near-loopback hosts are refused with the https message', () => {
    const guard = createOAuthUrlGuard({ assertAllowed: () => undefined }, { allowLoopbackHttp: true });
    for (const raw of [
        'http://127.0.0.1.evil.com/token', // trailing junk after a dotted 127/8 address
        'http://[1::ffff:7f00:1]/token', // leading junk before the mapped prefix
        'http://[::ffff:7f00:1:2]/token', // trailing junk after the mapped form
        'http://[::1:0]/token', // ::1 prefix with trailing groups
        'http://localhost.evil.com/token',
        'http://evil-localhost/token',
    ]) {
        assert.throws(() => guard.assertSafeUrl({ raw, label: 'token endpoint' }), {
            name: 'OAuthError', code: 'OAUTH_UNSAFE_ENDPOINT',
            message: 'token endpoint: provider endpoint must use https (http is permitted only for loopback)',
        }, raw);
    }
    for (const raw of ['http://localhost/token', 'http://LOCALHOST./token', 'http://[::1]/token', 'http://127.1/token', 'http://[::ffff:127.0.0.1]/token']) {
        assert.equal(guard.assertSafeUrl({ raw, label: 'token endpoint' }).href, new URL(raw).href, raw);
    }
});

test('F1: loopback alone is not enough — a non-http plaintext scheme is still refused', () => {
    const guard = createOAuthUrlGuard({ assertAllowed: () => undefined }, { allowLoopbackHttp: true });
    assert.throws(() => guard.assertSafeUrl({ raw: 'ws://127.0.0.1/token', label: 'token endpoint' }), { code: 'OAUTH_UNSAFE_ENDPOINT', message: 'token endpoint: provider endpoint must use https (http is permitted only for loopback)' });
});
