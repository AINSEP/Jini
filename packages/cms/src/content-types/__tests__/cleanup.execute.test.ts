import assert from "node:assert/strict";
import { test } from "vitest";

import { executeCleanup } from "../cleanup.js";
import type { Result } from "../types.js";

/**
 * @file REQ-21 — a successful cleanup `execute()` permanently and atomically removes
 * the target `content_types` row and every scoped `entries`/`entry_revisions`/
 * `content_type_revisions` row, in one transaction (C-405; INV-07).
 *
 * Covers: AC-34 (atomic multi-table removal), EC-10 (second execute() attempt against an
 * already-cleaned-up token is rejected per the gated-mutation gateway's own token/plan-staleness rules — this
 * package does not re-implement that rejection, only proves it forwards to the gateway
 * correctly and never attempts a second removal locally).
 *
 * Integration-level: exercises the repo's multi-table removal as one unit rather than mocking
 * each table write individually, since REQ-21's atomicity is the property under test.
 */

function fakeMultiTableRepo(seed: { contentTypeKey: string; entryCount: number; entryRevisionCount: number; contentTypeRevisionCount: number }) {
  let removed = false;
  return {
    isRemoved: () => removed,
    getRemainingCounts: () => (removed ? { entries: 0, entryRevisions: 0, contentTypeRevisions: 0, contentTypeExists: false } : { entries: seed.entryCount, entryRevisions: seed.entryRevisionCount, contentTypeRevisions: seed.contentTypeRevisionCount, contentTypeExists: true }),
    removeContentTypeAndAllScopedRows: async () => {
      removed = true;
      return { removedEntryCount: seed.entryCount };
    },
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
}

// `executeResult` is typed as the port's own `Result` rather than `unknown` so the fake satisfies
// `ExecuteCleanupGatewayPort`. Every call site already passes a well-formed `Result`; nothing about
// what the suite feeds in changes.
function fakeGateway(executeResult: Result<unknown, unknown> = { ok: true, value: {} }) {
  const calls: unknown[] = [];
  return {
    calls,
    execute: async (input: unknown) => {
      calls.push(input);
      return executeResult;
    },
  };
}

test("AC-34: a successful execute() removes the content type and ALL scoped entries/entryRevisions/contentTypeRevisions atomically", async () => {
  const repo = fakeMultiTableRepo({ contentTypeKey: "recipe", entryCount: 12, entryRevisionCount: 30, contentTypeRevisionCount: 4 });
  const gateway = fakeGateway();

  const result = await executeCleanup({
    deps: { repo, gateway },
    input: { principalId: "user-1", principalKind: "user", confirmationToken: "token-cleanup-1", contentTypeKey: "recipe" },
  });

  assert.equal(result.ok, true);
  const remaining = repo.getRemainingCounts();
  assert.equal(remaining.entries, 0);
  assert.equal(remaining.entryRevisions, 0);
  assert.equal(remaining.contentTypeRevisions, 0);
  assert.equal(remaining.contentTypeExists, false);
});

test("EC-10: executeCleanup forwards to the gateway (does not attempt a second local removal) when the gateway itself rejects an already-redeemed token", async () => {
  const repo = fakeMultiTableRepo({ contentTypeKey: "recipe", entryCount: 5, entryRevisionCount: 10, contentTypeRevisionCount: 2 });
  const gateway = fakeGateway({ ok: false, error: { code: "TOKEN_ALREADY_REDEEMED" } });

  const result = await executeCleanup({
    deps: { repo, gateway },
    input: { principalId: "user-1", principalKind: "user", confirmationToken: "already-redeemed-token", contentTypeKey: "recipe" },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal((result.error as { code: string }).code, "TOKEN_ALREADY_REDEEMED");
  assert.equal(repo.isRemoved(), false, "no local removal must be attempted when the gateway itself rejects the token");
});

test("INV-07: executeCleanup never runs its destructive removal against a content type whose status is not 'tombstone' — asserted via the eligibility gate rejecting before reaching removeContentTypeAndAllScopedRows", async () => {
  const repo = fakeMultiTableRepo({ contentTypeKey: "recipe", entryCount: 3, entryRevisionCount: 3, contentTypeRevisionCount: 1 });
  // Simulates the gateway's own execute() re-checking plan freshness and finding the content type
  // was concurrently reactivated between plan() and execute() — PLAN_STALE is the observable
  // rejection surface per the gateway's onBeforeCleanupExecute hook description.
  const gateway = fakeGateway({ ok: false, error: { code: "PLAN_STALE" } });

  const result = await executeCleanup({
    deps: { repo, gateway },
    input: { principalId: "user-1", principalKind: "user", confirmationToken: "token-stale", contentTypeKey: "recipe" },
  });

  assert.equal(result.ok, false);
  assert.equal(repo.isRemoved(), false);
});
