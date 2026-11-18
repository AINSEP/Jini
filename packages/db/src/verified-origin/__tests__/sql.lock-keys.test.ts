import assert from "node:assert/strict";
import { test } from "vitest";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import { createVerifiedOrigin } from "@jini-ai/core/contracts/server/verified-origin";
import type { Kysely } from "kysely";
import { registerConfiguredOrigin } from "../register.js";
import { TABLES } from "./support/origin-table.fixture.js";

/**
 * @file The per-workspace origin lock key, asserted exactly against a recording fake that implements the kernel
 * interface: `transaction` runs the body, `lockKey` records its argument, and the order of events is kept.
 */

function recordingKernel(): { kernel: StorageKernel<Kysely<unknown>, unknown>; events: string[] } {
  const events: string[] = [];
  const kernel: StorageKernel<Kysely<unknown>, unknown> = {
    dialect: "sqlite",
    transport: "fake",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    run: async () => { events.push("statement"); return undefined as never; },
    transaction: async (fn) => { events.push("begin"); const result = await fn(); events.push("commit"); return result; },
    lockKey: async (key) => { events.push(`lock:${key}`); },
    inTransaction: () => true,
    require: () => undefined,
    backupTo: async () => undefined,
    close: async () => undefined,
  };
  return { kernel, events };
}

test("registerConfiguredOrigin locks origin_settings:<workspace> inside the transaction, before the read and the insert", async () => {
  const { kernel, events } = recordingKernel();
  const origin = createVerifiedOrigin({ scheme: "https", host: "example.com", verifiedAt: "2026-11-18T00:00:00.000Z", source: "workspace-setting" });
  assert.equal(await registerConfiguredOrigin({ kernel, tables: TABLES, workspaceId: "ws-1", origin }, {}), "inserted");
  assert.deepEqual(events, ["begin", "lock:origin_settings:ws-1", "statement", "statement", "commit"]);
});
