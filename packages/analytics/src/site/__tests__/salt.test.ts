import assert from "node:assert/strict";
import { test } from "vitest";
import { hkdfSync } from "node:crypto";

import type { AnalyticsSaltContext } from "../../index.js";
import { deriveDailySalt } from "../salt.js";

/** @file The site salt wrapper derives with the host-injected HKDF wire context, byte-for-byte. */

const ANALYTICS_SEED = "test-site-key-seed-do-not-use-in-prod";
/** A test-only host wire context; the real one is defined (byte-identical) by the host. */
const saltContext: AnalyticsSaltContext = { extractionSalt: "host-analytics-daily-salt-hkdf-v1", infoPrefix: "analytics-salt:" };

test("deriveDailySalt is deterministic for a fixed (analyticsSeed, workspaceId, utcDate) triple", () => {
  const first = deriveDailySalt({ analyticsSeed: ANALYTICS_SEED, workspaceId: "workspace-1", utcDate: "2026-07-10", saltContext });
  const second = deriveDailySalt({ analyticsSeed: ANALYTICS_SEED, workspaceId: "workspace-1", utcDate: "2026-07-10", saltContext });

  assert.equal(first.equals(second), true);
  assert.equal(first.length, 32);
  // PARITY: the injected context is used byte-for-byte (extraction salt + info prefix).
  const expected = Buffer.from(hkdfSync("sha256", ANALYTICS_SEED,
    "host-analytics-daily-salt-hkdf-v1", "analytics-salt:workspace-1:2026-07-10", 32));
  assert.deepEqual(first, expected);
  // Pinned bytes: any change to the derivation (or to the injected context) turns this red.
  assert.equal(first.toString("hex"), "f05ddfaf1be83cc35a5f5a0a1472e886b88533e8f09331f7a1285b376dac42bc");
});

test("deriveDailySalt rotates across UTC days (salt rotation)", () => {
  const day1 = deriveDailySalt({ analyticsSeed: ANALYTICS_SEED, workspaceId: "workspace-1", utcDate: "2026-07-10", saltContext });
  const day2 = deriveDailySalt({ analyticsSeed: ANALYTICS_SEED, workspaceId: "workspace-1", utcDate: "2026-07-11", saltContext });

  assert.equal(day1.equals(day2), false);
});

test("deriveDailySalt is workspace-scoped (no cross-workspace salt reuse)", () => {
  const workspaceA = deriveDailySalt({ analyticsSeed: ANALYTICS_SEED, workspaceId: "workspace-a", utcDate: "2026-07-10", saltContext });
  const workspaceB = deriveDailySalt({ analyticsSeed: ANALYTICS_SEED, workspaceId: "workspace-b", utcDate: "2026-07-10", saltContext });

  assert.equal(workspaceA.equals(workspaceB), false);
});

test("deriveDailySalt changes when the analytics seed changes", () => {
  const seedA = deriveDailySalt({ analyticsSeed: "seed-a", workspaceId: "workspace-1", utcDate: "2026-07-10", saltContext });
  const seedB = deriveDailySalt({ analyticsSeed: "seed-b", workspaceId: "workspace-1", utcDate: "2026-07-10", saltContext });

  assert.equal(seedA.equals(seedB), false);
});

test("deriveDailySalt changes when the injected host extraction salt changes", () => {
  const a = deriveDailySalt({ analyticsSeed: ANALYTICS_SEED, workspaceId: "workspace-1", utcDate: "2026-07-10", saltContext });
  const b = deriveDailySalt({ analyticsSeed: ANALYTICS_SEED, workspaceId: "workspace-1", utcDate: "2026-07-10", saltContext: { ...saltContext, extractionSalt: "other-host-salt" } });

  assert.equal(a.equals(b), false);
});

test("deriveDailySalt rejects an empty workspaceId", () => {
  assert.throws(() => deriveDailySalt({ analyticsSeed: ANALYTICS_SEED, workspaceId: "", utcDate: "2026-07-10", saltContext }), RangeError);
});

test("deriveDailySalt rejects an empty utcDate", () => {
  assert.throws(() => deriveDailySalt({ analyticsSeed: ANALYTICS_SEED, workspaceId: "workspace-1", utcDate: "", saltContext }), RangeError);
});
