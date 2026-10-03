import { fixtureSleep } from "./fixtures.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { OAuthError } from "../src/errors.js";
import type { OAuthTokenSet } from "../src/ports.js";
import { createTokenRefresher, isTokenDueForRefresh, type TokenRefreshPort } from "../src/index.js";
import { assertOAuthRejects, createTestClock } from "./helpers.js";
/**
 * @file Single-flight, lease-guarded token refresh.
 *
 * This is the file that has to earn its keep. A rotating single-use refresh token means a race is
 * not "wasted work" — it permanently kills the connection. So the tests assert on the CALL COUNT of
 * the refresh port, not just on the returned value: a correct-looking token returned after two
 * redemptions is exactly the bug.
 */
const KEY = "workspace-1:higgs";
function tokens(overrides: Partial<OAuthTokenSet> = {}): OAuthTokenSet {
    return { accessToken: "at-current", refreshToken: "rt-current", tokenType: "Bearer", scopes: [], expiresAt: "2026-08-25T12:05:00.000Z", ...overrides };
}
interface PortDouble {
    readonly port: TokenRefreshPort;
    refreshCalls: number;
    refreshInputs: {
        key: string;
        refreshToken: string;
    }[];
    persisted: OAuthTokenSet[];
    needsReauth: {
        key: string;
        reason: string;
    }[];
    leaseAcquisitions: number;
    leaseReleases: string[];
    leaseHeld: boolean;
    stored: OAuthTokenSet | null;
}
function makePort(options: {
    refresh?: (refreshToken: string) => Promise<OAuthTokenSet>;
    leaseGranted?: boolean;
    withLease?: boolean;
    initial?: OAuthTokenSet | null;
} = {}): PortDouble {
    const state: PortDouble = {
        refreshCalls: 0,
        refreshInputs: [],
        persisted: [],
        needsReauth: [],
        leaseAcquisitions: 0,
        leaseReleases: [],
        leaseHeld: false,
        stored: options.initial === undefined ? tokens() : options.initial,
        port: undefined as unknown as TokenRefreshPort,
    };
    const port: TokenRefreshPort = {
        async load() {
            return state.stored;
        },
        async refresh({ key, refreshToken }) {
            state.refreshCalls += 1;
            state.refreshInputs.push({ key, refreshToken });
            if (options.refresh)
                return options.refresh(refreshToken);
            return tokens({ accessToken: "at-rotated", refreshToken: "rt-rotated", expiresAt: "2026-08-25T13:00:00.000Z" });
        },
        async persist({ tokens: next }) {
            state.persisted.push(next);
            state.stored = next;
        },
        async markNeedsReauth({ key, reason }) {
            state.needsReauth.push({ key, reason });
        },
    };
    if (options.withLease !== false) {
        port.tryAcquireRefreshLease = async () => {
            state.leaseAcquisitions += 1;
            if (options.leaseGranted === false || state.leaseHeld)
                return false;
            state.leaseHeld = true;
            return true;
        };
        port.releaseRefreshLease = async ({ key }) => {
            state.leaseReleases.push(key);
            assert.equal(state.leaseHeld, true, "only the lease owner may release it");
            state.leaseHeld = false;
        };
    }
    state.port = port;
    return state;
}
test("a token that is not near expiry is returned without touching the provider", async () => {
    const clock = createTestClock("2026-08-25T12:00:00.000Z");
    const double = makePort({ initial: tokens({ expiresAt: "2026-08-25T18:00:00.000Z" }) });
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port: double.port
    });
    assert.equal(await refresher.getAccessToken({
        key: KEY
    }), "at-current");
    assert.equal(double.refreshCalls, 0);
});
test("a token inside the refresh skew is refreshed proactively, before it actually expires", async () => {
    // Expires at 12:05, skew is 120s, so at 12:03 it is due even though it is still valid.
    const clock = createTestClock("2026-08-25T12:03:30.000Z");
    const double = makePort();
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port: double.port
    });
    assert.equal(await refresher.getAccessToken({
        key: KEY
    }), "at-rotated");
    assert.equal(double.refreshCalls, 1);
    assert.deepEqual(double.refreshInputs, [{ key: KEY, refreshToken: "rt-current" }]);
    assert.deepEqual(double.persisted, [tokens({ accessToken: "at-rotated", refreshToken: "rt-rotated", expiresAt: "2026-08-25T13:00:00.000Z" })]);
    assert.deepEqual(double.leaseReleases, [KEY]);
    assert.equal(double.leaseHeld, false);
    clock.advance(60 * 60 * 1000);
    assert.equal(await refresher.getAccessToken({
        key: KEY
    }), "at-rotated");
    assert.equal(double.leaseAcquisitions, 2, "a later refresh can reacquire the released lease");
    assert.deepEqual(double.leaseReleases, [KEY, KEY]);
    assert.deepEqual(double.refreshInputs[1], { key: KEY, refreshToken: "rt-rotated" });
});
test("concurrent callers collapse onto ONE refresh — the rotating token is redeemed once", async () => {
    const clock = createTestClock("2026-08-25T12:04:00.000Z");
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const double = makePort({
        refresh: async () => {
            await gate;
            return tokens({ accessToken: "at-rotated", refreshToken: "rt-rotated", expiresAt: "2026-08-25T13:00:00.000Z" });
        },
    });
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port: double.port
    });
    const inflight = [refresher.getAccessToken({
            key: KEY
        }), refresher.getAccessToken({
            key: KEY
        }), refresher.getAccessToken({
            key: KEY
        })];
    // Let all three get past their `load` and reach the single-flight map before asserting: the map
    // is populated after the load resolves, which is the earliest point at which "one attempt" is
    // even a meaningful claim.
    await new Promise((resolve) => setImmediate(resolve));
    // All three must now be waiting on the SAME attempt, not three of their own.
    assert.equal(refresher.inFlightCount({}), 1);
    release?.();
    const results = await Promise.all(inflight);
    assert.deepEqual(results, ["at-rotated", "at-rotated", "at-rotated"]);
    assert.equal(double.refreshCalls, 1, "a rotating single-use refresh token must be redeemed exactly once");
    assert.equal(double.persisted.length, 1);
    assert.deepEqual(double.persisted[0], tokens({ accessToken: "at-rotated", refreshToken: "rt-rotated", expiresAt: "2026-08-25T13:00:00.000Z" }));
    assert.equal(refresher.inFlightCount({}), 0);
    assert.equal(await refresher.getAccessToken({
        key: KEY
    }), "at-rotated");
    assert.equal(double.refreshCalls, 1, "the next caller reads the persisted rotation without another refresh");
    assert.deepEqual(double.leaseReleases, [KEY]);
});
test("the in-flight entry is cleared after a failure, so a later call can try again", async () => {
    const clock = createTestClock("2026-08-25T12:04:00.000Z");
    let attempt = 0;
    const double = makePort({
        refresh: async () => {
            attempt += 1;
            if (attempt === 1)
                throw new OAuthError({
                    code: "OAUTH_PROVIDER_UNREACHABLE", message: "down",
                    operatorAction: "retry"
                });
            return tokens({ accessToken: "at-rotated", expiresAt: "2026-08-25T13:00:00.000Z" });
        },
    });
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port: double.port
    });
    await assertOAuthRejects(() => refresher.getAccessToken({
        key: KEY
    }), "OAUTH_PROVIDER_UNREACHABLE");
    assert.equal(refresher.inFlightCount({}), 0);
    assert.deepEqual(double.leaseReleases, [KEY]);
    assert.equal(double.leaseHeld, false);
    assert.equal(await refresher.getAccessToken({
        key: KEY
    }), "at-rotated");
    assert.equal(double.leaseAcquisitions, 2);
    assert.deepEqual(double.leaseReleases, [KEY, KEY]);
});
test("the rotated token is persisted BEFORE it is handed out", async () => {
    const clock = createTestClock("2026-08-25T12:04:00.000Z");
    const order: string[] = [];
    let finishPersist!: () => void;
    const gate = new Promise<void>((resolve) => { finishPersist = resolve; });
    let enteredPersist!: () => void;
    const entered = new Promise<void>((resolve) => { enteredPersist = resolve; });
    const double = makePort();
    const wrapped: TokenRefreshPort = {
        ...double.port,
        persist: async ({ key, tokens: next }) => {
            order.push("persist");
            enteredPersist();
            await gate;
            await double.port.persist({ key, tokens: next });
        },
    };
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port: wrapped
    });
    let settled = false;
    const pending = refresher.getAccessToken({
        key: KEY
    }).then((accessToken) => {
        settled = true;
        order.push("returned");
        return accessToken;
    });
    await entered;
    await new Promise((resolve) => setImmediate(resolve));
    try {
        assert.equal(settled, false, "the caller must wait for persistence to finish");
        assert.deepEqual(double.persisted, []);
        assert.equal(double.leaseHeld, true, "the lease covers the durable write too");
    }
    finally {
        finishPersist();
    }
    const accessToken = await pending;
    assert.deepEqual(order, ["persist", "returned"]);
    assert.equal(accessToken, "at-rotated");
});
test("a rejected persistence never hands out the rotated token and releases the lease", async () => {
    const clock = createTestClock("2026-08-25T12:04:00.000Z");
    const double = makePort();
    const failure = new Error("durable token write failed");
    let failPersist!: (error: Error) => void;
    const gate = new Promise<void>((_resolve, reject) => { failPersist = reject; });
    let enteredPersist!: () => void;
    const entered = new Promise<void>((resolve) => { enteredPersist = resolve; });
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock,
        port: { ...double.port, persist: async () => { enteredPersist(); await gate; } }
    });
    const rejected = assert.rejects(refresher.getAccessToken({
        key: KEY
    }), (error) => error === failure);
    await entered;
    failPersist(failure);
    await rejected;
    assert.deepEqual(double.persisted, []);
    assert.deepEqual(double.leaseReleases, [KEY]);
    assert.equal(double.leaseHeld, false);
});
test("a provider answering invalid_grant transitions the connection to needs_reauth and stops", async () => {
    const clock = createTestClock("2026-08-25T12:04:00.000Z");
    const double = makePort({
        refresh: async () => {
            throw new OAuthError({
                code: "OAUTH_INVALID_GRANT", message: "refused",
                operatorAction: "reconnect"
            });
        },
    });
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port: double.port
    });
    const error = await assertOAuthRejects(() => refresher.getAccessToken({
        key: KEY
    }), "OAUTH_INVALID_GRANT");
    assert.equal(error.retryable, false);
    assert.equal(error.message, "this connection needs to be re-authorized (the provider rejected the stored refresh token)");
    assert.deepEqual(double.needsReauth, [{ key: KEY, reason: "the provider rejected the stored refresh token" }]);
    assert.equal(double.persisted.length, 0);
});
test("a re-seal failure while marking needs_reauth still surfaces the REAUTH error, not the write's own error", async () => {
    // Models `external-resource-oauth.ts`'s `setOAuthStatus`: once its clear-token re-seal retries are
    // exhausted it rethrows its own error class, not an `OAuthError`. That must never displace the
    // `OAUTH_INVALID_GRANT` signal every downstream caller (e.g. `tokenResolver.resolveAccessToken`
    // at `external-resource-oauth.ts:925`) branches on to stop retrying a dead connection.
    const clock = createTestClock("2026-08-25T12:04:00.000Z");
    const resealFailure = new Error("secret store unconfigured: re-seal retries exhausted");
    const double = makePort({
        refresh: async () => {
            throw new OAuthError({
                code: "OAUTH_INVALID_GRANT", message: "refused",
                operatorAction: "reconnect"
            });
        },
    });
    const port: TokenRefreshPort = {
        ...double.port,
        markNeedsReauth: async ({ key, reason }) => {
            double.needsReauth.push({ key, reason });
            throw resealFailure;
        },
    };
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port
    });
    const error = await assertOAuthRejects(() => refresher.getAccessToken({
        key: KEY
    }), "OAUTH_INVALID_GRANT");
    assert.equal(error.message, "this connection needs to be re-authorized (the provider rejected the stored refresh token)");
    assert.equal(error.retryable, false);
    assert.equal(error.cause, resealFailure, "the write's own failure must be carried as `cause`, never thrown in place of the reauth error");
});
test("a re-seal failure while marking needs_reauth (no-refresh-token case) still surfaces the REAUTH error", async () => {
    const clock = createTestClock("2026-08-25T12:04:00.000Z");
    const resealFailure = new Error("secret store unconfigured: re-seal retries exhausted");
    const double = makePort({ initial: tokens({ refreshToken: null }) });
    const port: TokenRefreshPort = {
        ...double.port,
        markNeedsReauth: async ({ key, reason }) => {
            double.needsReauth.push({ key, reason });
            throw resealFailure;
        },
    };
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port
    });
    const error = await assertOAuthRejects(() => refresher.getAccessToken({
        key: KEY
    }), "OAUTH_INVALID_GRANT");
    assert.equal(error.message, "this connection needs to be re-authorized (no refresh token)");
    assert.equal(error.cause, resealFailure);
});
test("a TRANSIENT refresh failure does NOT mark the connection needs_reauth", async () => {
    const clock = createTestClock("2026-08-25T12:04:00.000Z");
    const double = makePort({
        refresh: async () => {
            throw new OAuthError({
                code: "OAUTH_PROVIDER_UNREACHABLE", message: "timeout",
                operatorAction: "retry later"
            });
        },
    });
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port: double.port
    });
    await assertOAuthRejects(() => refresher.getAccessToken({
        key: KEY
    }), "OAUTH_PROVIDER_UNREACHABLE");
    assert.deepEqual(double.needsReauth, [], "a provider having a bad minute must not nag the operator to reconnect");
});
// REGRESSION: fails if the expiry test clock is reverted to the still-valid 12:04 fixture.
test("a connection whose provider issued no refresh token goes to needs_reauth at expiry", async () => {
    const clock = createTestClock("2026-08-25T12:05:00.000Z");
    const double = makePort({ initial: tokens({ refreshToken: null }) });
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port: double.port
    });
    const error = await assertOAuthRejects(() => refresher.getAccessToken({
        key: KEY
    }), "OAUTH_INVALID_GRANT");
    assert.equal(error.message, "this connection needs to be re-authorized (no refresh token)");
    assert.deepEqual(double.needsReauth, [
        { key: KEY, reason: "the provider issued no refresh token and the access token has expired" },
    ]);
    assert.equal(double.refreshCalls, 0);
});
test("a connection holding no token at all is needs_reauth, not a crash", async () => {
    const clock = createTestClock();
    const double = makePort({ initial: null });
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port: double.port
    });
    const error = await assertOAuthRejects(() => refresher.getAccessToken({
        key: KEY
    }), "OAUTH_INVALID_GRANT");
    assert.equal(error.message, "this connection needs to be re-authorized (this connection holds no token)");
});
test("a null expiry means never proactively refresh — no lifetime is fabricated", async () => {
    const clock = createTestClock("2030-01-01T00:00:00.000Z");
    const double = makePort({ initial: tokens({ expiresAt: null }) });
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port: double.port
    });
    assert.equal(await refresher.getAccessToken({
        key: KEY
    }), "at-current");
    assert.equal(double.refreshCalls, 0);
    assert.equal(isTokenDueForRefresh({
        tokens: tokens({ expiresAt: null }),
        nowIso: "2030-01-01T00:00:00.000Z",
        skewMs: 120000
    }), false);
});
test("losing the cross-process lease means re-reading, NOT refreshing behind the winner's back", async () => {
    const clock = createTestClock("2026-08-25T12:04:00.000Z");
    const double = makePort({ leaseGranted: false });
    // Model the other process publishing its rotated token during our first re-read.
    const port: TokenRefreshPort = {
        ...double.port,
        load: async () => double.stored,
    };
    const refresher = createTokenRefresher({
        clock,
        port,
        sleep: async () => {
            double.stored = tokens({ accessToken: "at-from-other-process", expiresAt: "2026-08-25T14:00:00.000Z" });
        }
    }, {
        leasePollMs: 1,
        leaseWaitMs: 100
    });
    assert.equal(await refresher.getAccessToken({
        key: KEY
    }), "at-from-other-process");
    assert.equal(double.refreshCalls, 0, "the loser of the lease must never redeem the refresh token");
    assert.equal(double.leaseAcquisitions, 1);
    assert.deepEqual(double.leaseReleases, [], "a lease loser must not release another process's lease");
});
test("a lease holder that never publishes leaves the loser on its still-valid token rather than racing", async () => {
    const clock = createTestClock("2026-08-25T12:04:00.000Z");
    const double = makePort({ leaseGranted: false });
    const refresher = createTokenRefresher({
        clock,
        port: double.port,
        // Advancing the clock is what ends the wait; the stored token stays stale.
        sleep: async () => clock.advance(5)
    }, {
        leasePollMs: 1,
        leaseWaitMs: 10
    });
    // The token expires at 12:05 and it is 12:04, so it is due for refresh but still usable.
    assert.equal(await refresher.getAccessToken({
        key: KEY
    }), "at-current");
    assert.equal(double.refreshCalls, 0);
});
test("a lease holder that never publishes, on an already-expired token, fails loudly", async () => {
    const clock = createTestClock("2026-08-25T12:10:00.000Z");
    const double = makePort({ leaseGranted: false });
    const refresher = createTokenRefresher({
        clock,
        port: double.port,
        sleep: async () => clock.advance(5)
    }, {
        leasePollMs: 1,
        leaseWaitMs: 10
    });
    const error = await assertOAuthRejects(() => refresher.getAccessToken({
        key: KEY
    }), "OAUTH_PROVIDER_UNREACHABLE");
    assert.equal(error.message, "another process is refreshing this connection's token and did not finish in time");
    assert.equal(double.refreshCalls, 0);
});
test("a port with no lease support still gets the in-process single-flight guarantee", async () => {
    const clock = createTestClock("2026-08-25T12:04:00.000Z");
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const double = makePort({
        withLease: false,
        refresh: async () => {
            await gate;
            return tokens({ accessToken: "at-rotated", expiresAt: "2026-08-25T13:00:00.000Z" });
        },
    });
    const refresher = createTokenRefresher({
        sleep: fixtureSleep,
        clock, port: double.port
    });
    const inflight = [refresher.getAccessToken({
            key: KEY
        }), refresher.getAccessToken({
            key: KEY
        })];
    release?.();
    await Promise.all(inflight);
    assert.equal(double.refreshCalls, 1);
    assert.equal(double.leaseAcquisitions, 0);
});

// REGRESSION: fails if performRefresh describes a still-valid no-refresh token as expired.
test('a no-refresh token in the proactive skew window reports refresh due', async () => {
    const clock = createTestClock('2026-08-25T12:04:00.000Z');
    const double = makePort({ initial: tokens({ refreshToken: null }) });
    const refresher = createTokenRefresher({ clock, port: double.port, sleep: fixtureSleep });
    await assertOAuthRejects(() => refresher.getAccessToken({ key: KEY }), 'OAUTH_INVALID_GRANT');
    assert.deepEqual(double.needsReauth, [{ key: KEY, reason: 'the provider issued no refresh token and the access token is due for refresh' }]);
    assert.equal(double.refreshCalls, 0);
});
