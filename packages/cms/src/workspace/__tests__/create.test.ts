import assert from "node:assert/strict";
import { test } from "vitest";

import type { OutboxPort, OutboxRecord } from "../../core/ports.js";
import { createWorkspace, WorkspaceConflictError, WorkspaceValidationError } from "../create.js";
import { InMemoryWorkspaceRepo } from "../repo.memory.js";

/**
 * Specification tests for the create-workspace slice.
 *
 * These tests intentionally exercise domain behavior without HTTP/framework coupling.
 */

/**
 * Minimal in-memory `OutboxPort`. Declared locally rather than imported: the host's
 * `InMemoryOutbox` lives in its own event-infrastructure module, which is not part of this
 * package's closure. Mirrors `navigation/__tests__`'s locally-declared outbox doubles, and
 * preserves the `claimPending`-based assertions below exactly as written.
 */
function fakeOutbox(): OutboxPort {
  const records: OutboxRecord[] = [];
  return {
    enqueue: async (event) => {
      records.push({
        id: event.id,
        event,
        status: "pending",
        attempts: 0,
        nextAttemptAt: event.occurredAt,
        createdAt: event.occurredAt,
      });
    },
    claimPending: async (batchSize, nowIso) => {
      const pending = records.filter((r) => r.status === "pending" && r.nextAttemptAt <= nowIso).slice(0, batchSize);
      for (const row of pending) row.status = "processing";
      return pending;
    },
    markDelivered: async () => {},
    markFailed: async () => {},
  };
}

test("createWorkspace stores workspace and enqueues workspace.created", async () => {
  const repo = new InMemoryWorkspaceRepo();
  const outbox = fakeOutbox();

  let n = 0;
  const idGen = { newId: () => `id-${++n}` };
  const clock = { nowIso: () => "2026-02-21T00:00:00.000Z" };

  const result = await createWorkspace(
    {
      deps: { repo, outbox, idGen, clock },
      input: { name: "Example Site", slug: "example-site" },
    }
  );

  assert.equal(result.id, "id-1");

  const rows = await outbox.claimPending(10, "2026-02-21T00:00:00.000Z");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.event.name, "workspace.created");
  assert.equal(rows[0]!.event.workspaceId, "id-1");
});

test("createWorkspace rejects invalid slug", async () => {
  const repo = new InMemoryWorkspaceRepo();
  const outbox = fakeOutbox();
  const idGen = { newId: () => "id-1" };
  const clock = { nowIso: () => "2026-02-21T00:00:00.000Z" };

  await assert.rejects(
    () =>
      createWorkspace({
        deps: { repo, outbox, idGen, clock },
        input: { name: "X", slug: "Bad Slug" },
      }),
    WorkspaceValidationError
  );
});

test("createWorkspace rejects duplicate slug", async () => {
  const repo = new InMemoryWorkspaceRepo();
  const outbox = fakeOutbox();
  let n = 0;
  const idGen = { newId: () => `id-${++n}` };
  const clock = { nowIso: () => "2026-02-21T00:00:00.000Z" };

  await createWorkspace({
    deps: { repo, outbox, idGen, clock },
    input: { name: "A", slug: "dup" },
  });
  await assert.rejects(
    () =>
      createWorkspace({
        deps: { repo, outbox, idGen, clock },
        input: { name: "B", slug: "dup" },
      }),
    WorkspaceConflictError
  );
});
