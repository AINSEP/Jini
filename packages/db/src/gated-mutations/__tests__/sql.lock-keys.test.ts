import assert from "node:assert/strict";
import { test } from "vitest";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import { SqlTokenStore } from "../repo.sql.js";
import { TABLES } from "./support/token-table.fixture.js";

/**
 * @file The per-token redemption lock key, asserted exactly against a recording fake that implements the kernel
 * interface: `transaction` runs the body, `lockKey` records its argument, and the order of events is kept.
 */

function recordingKernel(): { kernel: StorageKernel<Kysely<unknown>, unknown>; events: string[] } {
  const events: string[] = [];
  const kernel: StorageKernel<Kysely<unknown>, unknown> = {
    dialect: "sqlite",
    transport: "fake",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    run: async () => { events.push("read"); return undefined as never; },
    transaction: async (fn) => { events.push("begin"); const result = await fn(); events.push("commit"); return result; },
    lockKey: async (key) => { events.push(`lock:${key}`); },
    inTransaction: () => true,
    require: () => undefined,
    backupTo: async () => undefined,
    close: async () => undefined,
  };
  return { kernel, events };
}

test("tryRedeem locks gated_mutation_tokens:<token> inside the transaction, before the read", async () => {
  const { kernel, events } = recordingKernel();
  const result = await new SqlTokenStore({ kernel, tables: TABLES }, {}).tryRedeem({ token: "tok-1", now: "2026-11-18T00:00:00.000Z" });
  assert.deepEqual(result, { redeemed: false, record: null });
  assert.deepEqual(events, ["begin", "lock:gated_mutation_tokens:tok-1", "read", "commit"]);
});
