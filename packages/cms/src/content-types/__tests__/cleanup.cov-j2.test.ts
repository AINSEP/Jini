import assert from "node:assert/strict";
import { test } from "vitest";

import { planCleanup } from "../cleanup.js";
import { CleanupNotEligibleError } from "../errors.js";

/**
 * @file `planCleanup`'s remaining eligibility outcomes: the authorization gate that runs before
 * any repo read, a missing content type, a tombstone row with no recorded `tombstonedAt`, and a
 * gateway that refuses the plan after every local check passed.
 * See docs/decisions/DR-002-content-lifecycle-and-cleanup.md.
 */

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowMs: () => Date.parse(NOW) };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const input = { workspaceId: "ws-1", actorId: "user-1", contentTypeKey: "recipe", exportReference: "export-1" };

function recordingRepo(row: { status: "active" | "deprecated" | "tombstone"; tombstonedAt: string | null } | null) {
  const reads: unknown[] = [];
  return { reads, findByKey: async (params: unknown) => { reads.push(params); return row; } };
}

function recordingGateway(result: { ok: true; value: { planId: string; planHash: string } } | { ok: false; error: unknown }) {
  const calls: unknown[] = [];
  return { calls, plan: async (call: unknown) => { calls.push(call); return result; } };
}

const eligiblePlan = { ok: true as const, value: { planId: "plan-1", planHash: "hash-1" } };

test("planCleanup refuses with reason='forbidden' and the evaluator's reason, before reading the repo or reaching the gateway", async () => {
  const repo = recordingRepo({ status: "tombstone", tombstonedAt: "2026-01-01T00:00:00.000Z" });
  const gateway = recordingGateway(eligiblePlan);
  const permissionRequests: unknown[] = [];

  const result = await planCleanup({
    deps: {
      repo, gateway, clock,
      authorize: async (request: unknown) => { permissionRequests.push(request); return { allowed: false, reason: "no-grant" }; },
    },
    input,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.error instanceof CleanupNotEligibleError);
  assert.equal(result.error.reason, "forbidden");
  assert.equal(result.error.message, "principal 'user-1' is not authorized to plan a cleanup (no-grant)");
  assert.deepEqual(permissionRequests, [{ principalId: "user-1", permission: "admin.collections.read", workspaceId: "ws-1" }]);
  assert.equal(repo.reads.length, 0);
  assert.equal(gateway.calls.length, 0);
});

test("planCleanup reports a content type that does not exist as reason='not_tombstoned' without reaching the gateway", async () => {
  const repo = recordingRepo(null);
  const gateway = recordingGateway(eligiblePlan);

  const result = await planCleanup({ deps: { repo, gateway, clock, authorize: alwaysAllow }, input });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.reason, "not_tombstoned");
  assert.deepEqual(repo.reads, [{ workspaceId: "ws-1", key: "recipe" }]);
  assert.equal(gateway.calls.length, 0);
});

test("planCleanup treats a tombstone row with no recorded tombstonedAt as tombstoned just now (retention window not elapsed)", async () => {
  const gateway = recordingGateway(eligiblePlan);

  const result = await planCleanup({
    deps: { repo: recordingRepo({ status: "tombstone", tombstonedAt: null }), gateway, clock, authorize: alwaysAllow },
    input,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.reason, "retention_window_not_elapsed");
  assert.equal(gateway.calls.length, 0);
});

test("planCleanup surfaces a gateway refusal as reason='gateway_rejected' carrying the gateway's error text", async () => {
  const gateway = recordingGateway({ ok: false, error: "plan store unavailable" });

  const result = await planCleanup({
    deps: { repo: recordingRepo({ status: "tombstone", tombstonedAt: "2026-01-01T00:00:00.000Z" }), gateway, clock, authorize: alwaysAllow },
    input,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.reason, "gateway_rejected");
  assert.equal(result.error.message, "plan store unavailable");
  assert.deepEqual(gateway.calls, [{ principalId: "user-1", workspaceId: "ws-1", contentTypeKey: "recipe", domain: "collections", action: "cleanup" }]);
});
