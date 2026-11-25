import assert from "node:assert/strict";
import { test } from "vitest";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import { SqlChangeSetRepo } from "../change-set-repo.sql.js";
import { SqlOutboxAdapter } from "../outbox-repo.sql.js";
import { TABLES } from "./support/events-tables.fixture.js";

/**
 * @file The outbox claim lock key, asserted exactly against a recording fake that implements the kernel interface:
 * `transaction` runs the body, `lockKey` records its argument, and the order of events is kept.
 */

function recordingKernel(): { kernel: StorageKernel<Kysely<unknown>, unknown>; events: string[] } {
  const events: string[] = [];
  const kernel: StorageKernel<Kysely<unknown>, unknown> = {
    dialect: "sqlite",
    transport: "fake",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    run: async () => { events.push("read"); return [] as never; },
    transaction: async (fn) => { events.push("begin"); const result = await fn(); events.push("commit"); return result; },
    lockKey: async (key) => { events.push(`lock:${key}`); },
    inTransaction: () => true,
    require: () => undefined,
    backupTo: async () => undefined,
    close: async () => undefined,
  };
  return { kernel, events };
}

test("claimPending locks outbox_events:claim inside the transaction, before the select", async () => {
  const { kernel, events } = recordingKernel();
  const claimed = await new SqlOutboxAdapter({ kernel, tables: TABLES, claimLeaseMs: 1000 }, {}).claimPending({ batchSize: 5, nowIso: "2026-11-18T00:00:00.000Z" });
  assert.deepEqual(claimed, []);
  assert.deepEqual(events, ["begin", "lock:outbox_events:claim", "read", "commit"]);
});

test("a change-set insert takes no lock: header, items and event are one transaction around one run", async () => {
  const { kernel, events } = recordingKernel();
  await new SqlChangeSetRepo({ kernel, tables: TABLES }, {}).insert({
    record: { id: "cs-1", workspaceId: "ws-1", actorId: "test-writer", actor: { id: "test-writer", kind: "user" }, status: "proposed", summary: "s", createdAt: "2026-11-18T00:00:00.000Z" },
    items: [],
  });
  assert.deepEqual(events, ["begin", "read", "commit"]);
});
