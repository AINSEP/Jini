import assert from "node:assert/strict";
import { test } from "vitest";

import { planCleanup } from "../cleanup.js";

/**
 * @file REQ-20 — the destructive cleanup ceremony's `plan()` eligibility gate (C-405),
 * instantiating the gated-mutation gateway (`domain="collections"`, `action="cleanup"`).
 *
 * Covers: AC-31 (not-tombstoned rejection), AC-32 (retention window not elapsed), AC-33 (eligible
 * plan returned), EC-09 (deprecated, never tombstoned), behavior.spec.md §2.3's fixed eligibility
 * check order (status -> retention window -> export reference).
 */

const alwaysAllow = async () => ({ allowed: true, reason: "matched" });

function contentType(overrides: Partial<{ status: "active" | "deprecated" | "tombstone"; tombstonedAt: string | null }> = {}) {
  return { workspaceId: "ws-1", key: "recipe", status: "tombstone" as const, tombstonedAt: "2026-06-01T00:00:00.000Z", ...overrides };
}

function fakeRepo(ct: ReturnType<typeof contentType>) {
  return { findByKey: async () => ct };
}

function fakeGateway() {
  const calls: unknown[] = [];
  return {
    calls,
    plan: async (input: unknown) => {
      calls.push(input);
      // `as const` on the discriminant: without it TS widens `ok` to `boolean`, which no longer
      // matches the `Result` union the port returns. Value-identical, type-narrower.
      return { ok: true as const, value: { planId: "plan-cleanup-1", planHash: "sha256:" + "1".repeat(64) } };
    },
  };
}

test("AC-31/EC-09: plan() for a content type still 'active' or 'deprecated' (never tombstoned) returns CLEANUP_NOT_ELIGIBLE, reason='not_tombstoned'", async () => {
  for (const status of ["active", "deprecated"] as const) {
    const repo = fakeRepo(contentType({ status }));
    const gateway = fakeGateway();
    const clock = { nowIso: () => "2026-07-15T00:00:00.000Z" };

    const result = await planCleanup({
      deps: { repo, gateway, clock, authorize: alwaysAllow },
      input: { workspaceId: "ws-1", actorId: "user-1", contentTypeKey: "recipe", exportReference: "export-1" },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      const err = result.error as { reason?: string };
      assert.equal(err.reason, "not_tombstoned");
    }
    assert.equal(gateway.calls.length, 0, "the gateway's own plan() must never be reached before eligibility is confirmed");
  }
});

test("AC-32: plan() before 30 days have elapsed since tombstonedAt returns CLEANUP_NOT_ELIGIBLE, reason='retention_window_not_elapsed'", async () => {
  const repo = fakeRepo(contentType({ status: "tombstone", tombstonedAt: "2026-07-01T00:00:00.000Z" }));
  const gateway = fakeGateway();
  const clock = { nowIso: () => "2026-07-15T00:00:00.000Z" }; // 14 days elapsed, not 30

  const result = await planCleanup({
    deps: { repo, gateway, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-1", actorId: "user-1", contentTypeKey: "recipe", exportReference: "export-1" },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    const err = result.error as { reason?: string };
    assert.equal(err.reason, "retention_window_not_elapsed");
  }
});

test("behavior.spec.md §7: plan() at EXACTLY 30 days elapsed is treated as eligible (inclusive lower bound)", async () => {
  const repo = fakeRepo(contentType({ status: "tombstone", tombstonedAt: "2026-06-15T00:00:00.000Z" }));
  const gateway = fakeGateway();
  const clock = { nowIso: () => "2026-07-15T00:00:00.000Z" }; // exactly 30 days

  const result = await planCleanup({
    deps: { repo, gateway, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-1", actorId: "user-1", contentTypeKey: "recipe", exportReference: "export-1" },
  });

  assert.equal(result.ok, true, "the 30-day window is inclusive (elapsed >= 30 days), not exclusive");
});

test("plan() without an exportReference returns CLEANUP_NOT_ELIGIBLE, reason='export_reference_missing', even when tombstoned and retention window has elapsed", async () => {
  const repo = fakeRepo(contentType({ status: "tombstone", tombstonedAt: "2026-01-01T00:00:00.000Z" }));
  const gateway = fakeGateway();
  const clock = { nowIso: () => "2026-07-15T00:00:00.000Z" };

  const result = await planCleanup({
    deps: { repo, gateway, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-1", actorId: "user-1", contentTypeKey: "recipe", exportReference: "" },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    const err = result.error as { reason?: string };
    assert.equal(err.reason, "export_reference_missing");
  }
});

test("AC-33: plan() succeeds and returns an executable Plan once status='tombstone', retention window elapsed, and exportReference present", async () => {
  const repo = fakeRepo(contentType({ status: "tombstone", tombstonedAt: "2026-01-01T00:00:00.000Z" }));
  const gateway = fakeGateway();
  const clock = { nowIso: () => "2026-07-15T00:00:00.000Z" };

  const result = await planCleanup({
    deps: { repo, gateway, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-1", actorId: "user-1", contentTypeKey: "recipe", exportReference: "export-1" },
  });

  assert.equal(result.ok, true);
  assert.equal(gateway.calls.length, 1);
});

test("behavior.spec.md §2.3: eligibility conditions are checked in fixed order — a type that fails BOTH 'not_tombstoned' and would-also-fail retention/export reports only 'not_tombstoned'", async () => {
  const repo = fakeRepo(contentType({ status: "active", tombstonedAt: null }));
  const gateway = fakeGateway();
  const clock = { nowIso: () => "2026-07-15T00:00:00.000Z" };

  const result = await planCleanup({
    deps: { repo, gateway, clock, authorize: alwaysAllow },
    input: { workspaceId: "ws-1", actorId: "user-1", contentTypeKey: "recipe", exportReference: "" },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    const err = result.error as { reason?: string };
    assert.equal(err.reason, "not_tombstoned", "a later condition must never be evaluated once an earlier one has already failed");
  }
});
