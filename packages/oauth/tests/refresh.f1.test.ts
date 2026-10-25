import assert from "node:assert/strict";
import { test } from "vitest";
import { isTokenDueForRefresh } from "../src/refresh.js";

// F1 fix wave (Stryker L1 §4 refresh.ts:41 — `<=` boundary and skew sign).
const tokens = (expiresAt: string | null) => ({ accessToken: "a", refreshToken: "r", tokenType: "Bearer", scopes: [], expiresAt });
const EXP = "2026-01-01T00:10:00.000Z";
for (const [label, nowIso, skewMs, due] of [
    ["1 ms before (expiry - skew)", "2026-01-01T00:08:59.999Z", 60_000, false],
    ["exactly at (expiry - skew)", "2026-01-01T00:09:00.000Z", 60_000, true],
    ["after (expiry - skew)", "2026-01-01T00:09:30.000Z", 60_000, true],
    ["no skew, 1 ms before expiry", "2026-01-01T00:09:59.999Z", 0, false],
    ["no skew, exactly at expiry", EXP, 0, true],
    ["a larger skew refreshes earlier", "2026-01-01T00:05:00.000Z", 300_000, true],
] as const) {
    test(`F1: isTokenDueForRefresh — ${label} → ${due}`, () => {
        assert.equal(isTokenDueForRefresh({ tokens: tokens(EXP), nowIso, skewMs }), due);
    });
}
test("F1: a token with no expiry is never due", () => {
    assert.equal(isTokenDueForRefresh({ tokens: tokens(null), nowIso: "2099-01-01T00:00:00.000Z", skewMs: 60_000 }), false);
});
