import assert from "node:assert/strict";
import { test } from "vitest";

import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import { workspaceRepoFor } from "../sql/repo.js";

/**
 * @file The workspace roster lock key, asserted exactly against a recording fake that implements the kernel
 * interface: `transaction` runs the body, `lockKey` records its argument and the order of events.
 */

function recordingKernel(): { kernel: StorageKernel<Kysely<unknown>, unknown>; events: string[] } {
  const events: string[] = [];
  const kernel: StorageKernel<Kysely<unknown>, unknown> = {
    dialect: "sqlite",
    transport: "fake",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    run: async () => { throw new Error("no statement is expected in this test"); },
    transaction: async (fn) => { events.push("begin"); const result = await fn(); events.push("commit"); return result; },
    lockKey: async (key) => { events.push(`lock:${key}`); },
    inTransaction: () => true,
    require: () => undefined,
    backupTo: async () => undefined,
    close: async () => undefined,
  };
  return { kernel, events };
}

test("transaction takes the install-wide roster lock inside the transaction, before the callback", async () => {
  const { kernel, events } = recordingKernel();
  const repo = workspaceRepoFor({ kernel, tables: { workspaces: "workspaces" } }, {});
  const result = await repo.transaction({ fn: async () => { events.push("body"); return "done"; } });
  assert.equal(result, "done");
  assert.deepEqual(events, ["begin", "lock:workspace:roster", "body", "commit"]);
});
