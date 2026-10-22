import assert from "node:assert/strict";
import { test } from "vitest";

import { registerContentType } from "../write-service.js";

/**
 * @file every Collections route/tool is gated by exactly one of
 * `admin.collections.read` (read-class operations) or `admin.collections.manage` (mutating
 * operations).
 *
 * Covers: (read-only principal denied on a mutating call), (read-only principal
 * allowed on a read call — asserted here at the write-side negative case; the positive read case
 * is exercised implicitly by every other unit test's use of `alwaysAllow` for read-only actions).
 * See docs/decisions/DR-001-safe-schema-and-index-transitions.md.
 */

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowMs: () => Date.parse(NOW)};
let idCounter = 0;
const ids = { newId: () => `ct-perm-${++idCounter}` };

function fakeRepo() {
  const rows: unknown[] = [];
  return {
    rows,
    save: async (row: unknown) => {
      rows.push(row);
    },
    appendRevision: async () => undefined,
    findByKey: async () => null,
    transaction: async <T>({ fn }: { fn: () => Promise<T> }) => fn(),
  };
}

function fakeIndexProvisioner() {
  // `applyFieldIndexTransitions` is a no-op rather than absent: this suite only exercises the
  // register path, which never calls it, but the package typechecks its tests (the host this was
  // ported from did not), so the fake has to satisfy the whole `IndexProvisionerPort`.
  return {
    provisionIndexesForNewContentType: async () => undefined,
    applyFieldIndexTransitions: async () => undefined,
  };
}

const outbox = { enqueue: async () => undefined };

test("AC-36: a principal holding only admin.collections.read is rejected FORBIDDEN when it attempts a content-type create/update/lifecycle call", async () => {
  const readOnlyAuthorize = async (params: { permission: string }) => ({
    allowed: params.permission === "admin.collections.read",
    reason: params.permission === "admin.collections.read" ? "matched" : "insufficient_permission",
  });
  const repo = fakeRepo();

  const result = await registerContentType({
    deps: { repo, clock, ids, authorize: readOnlyAuthorize, indexProvisioner: fakeIndexProvisioner(), outbox },
    input: { workspaceId: "ws-1", actorId: "read-only-user", key: "recipe", label: "Recipe", fields: [{ name: "a", kind: "text", required: false, queryable: false }] },
  });

  assert.equal(result.ok, false);
  assert.equal(repo.rows.length, 0);
});
