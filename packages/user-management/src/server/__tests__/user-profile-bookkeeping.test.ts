import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import assert from "node:assert/strict";
import { test } from "vitest";
import type { UserRecord } from "../../core/types.js";
import { InMemoryUserRepo } from "../repo.memory.js";

const STORED: UserRecord = { principalId: "p1", workspaceId: "w1", username: "alice", passwordHash: "hash-new", lastLoginAt: "2026-11-25T10:00:00.000Z", version: 3 };

test("a versioned profile save keeps the stored login and password bookkeeping, not the editor snapshot's", async () => {
  const repo = new InMemoryUserRepo({ assertVersionedWrite }, { initialRows: [STORED] });
  // The editor opened the profile before the latest login and password change landed.
  const snapshot: UserRecord = { ...STORED, passwordHash: "hash-old", lastLoginAt: "2026-11-01T00:00:00.000Z", email: "a@example.test" };
  await repo.save(snapshot, { expectedVersion: 3 });
  assert.deepEqual(await repo.findByPrincipalId({ workspaceId: "w1", principalId: "p1" }), { ...STORED, email: "a@example.test", version: 4 });
});
