import assert from "node:assert/strict";
import { test } from "vitest";

import { createRestorePoint, type CreateRestorePointRequired } from "../../recovery/restore-point-create.js";

/** @file `createRestorePoint`: authorize on every call, refuse while an operation is in flight, idempotent by key, never the gated ceremony. */

function harness(allowed = true) {
  const events: unknown[] = [];
  const saved = new Map<string, { restorePointId: string; idempotencyKey: string }>();
  let ids = 0;
  const deps: CreateRestorePointRequired["deps"] = {
    repo: {
      save: async (row) => {
        events.push(["save", row]);
        saved.set(row.idempotencyKey, row);
      },
      findByIdempotencyKey: async (key) => {
        events.push(["find", key]);
        return saved.get(key) ?? null;
      },
    },
    clock: { nowIso: () => "2026-10-21T08:00:00.000Z" },
    ids: { newId: () => `rp-${++ids}` },
    authorize: async (params) => {
      events.push(["authorize", params]);
      return { allowed, reason: allowed ? "ok" : "role lacks backup.create" };
    },
    gateway: { plan: async () => assert.fail("restore-point creation never goes through the gated ceremony") },
  };
  return { deps, events };
}

const input = (overrides: Partial<CreateRestorePointRequired["input"]> = {}): CreateRestorePointRequired["input"] => ({
  principalId: "user-1",
  principalKind: "user",
  idempotencyKey: "key-1",
  trigger: "manual",
  operationInFlight: false,
  ...overrides,
});

test("a first request mints and saves a restore point attributed to its principal", async () => {
  const h = harness();
  assert.deepEqual(await createRestorePoint({ deps: h.deps, input: input() }), { ok: true, value: { restorePointId: "rp-1" } });
  assert.deepEqual(h.events, [
    ["authorize", { principalId: "user-1", permission: "backup.create" }],
    ["find", "key-1"],
    ["save", { restorePointId: "rp-1", idempotencyKey: "key-1", trigger: "manual", createdAt: "2026-10-21T08:00:00.000Z", createdBy: "user-1" }],
  ]);
});

test("a repeated idempotency key returns the first point without saving again, but is re-authorized", async () => {
  const h = harness();
  await createRestorePoint({ deps: h.deps, input: input() });
  h.events.length = 0;

  assert.deepEqual(await createRestorePoint({ deps: h.deps, input: input({ trigger: "template-upgrade" }) }, {}), { ok: true, value: { restorePointId: "rp-1" } });
  assert.deepEqual(h.events, [["authorize", { principalId: "user-1", permission: "backup.create" }], ["find", "key-1"]]);
});

test("an unauthorized principal is refused with the authorizer's reason before anything is read or written", async () => {
  const h = harness(false);
  assert.deepEqual(await createRestorePoint({ deps: h.deps, input: input() }), { ok: false, error: { code: "FORBIDDEN", message: "role lacks backup.create" } });
  assert.equal(h.events.length, 1);
});

test("an operation in flight refuses creation after authorization and before any lookup", async () => {
  const h = harness();
  assert.deepEqual(await createRestorePoint({ deps: h.deps, input: input({ operationInFlight: true }) }), {
    ok: false,
    error: { code: "RESTORE_OPERATION_IN_FLIGHT", message: "a migration or restore is already in flight for this site" },
  });
  assert.deepEqual(h.events, [["authorize", { principalId: "user-1", permission: "backup.create" }]]);
});
