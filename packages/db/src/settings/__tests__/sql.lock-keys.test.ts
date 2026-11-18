import assert from "node:assert/strict";
import { test } from "vitest";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import { SqlSettingsRepo } from "../repo.sql.js";
import { TABLES } from "./support/settings-tables.fixture.js";

/**
 * @file The revision-stream lock key, asserted exactly against a recording fake that implements the kernel
 * interface: `transaction` runs the body, `lockKey` records its argument, and the order of events is kept.
 */

function recordingKernel(): { kernel: StorageKernel<Kysely<unknown>, unknown>; events: string[] } {
  const events: string[] = [];
  const kernel: StorageKernel<Kysely<unknown>, unknown> = {
    dialect: "sqlite",
    transport: "fake",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    run: async () => { events.push("statement"); return { seq: 7 } as never; },
    transaction: async (fn) => { events.push("begin"); const result = await fn(); events.push("commit"); return result; },
    lockKey: async (key) => { events.push(`lock:${key}`); },
    inTransaction: () => true,
    require: () => undefined,
    backupTo: async () => undefined,
    close: async () => undefined,
  };
  return { kernel, events };
}

test("appendRevision locks the one install-wide revision stream inside the transaction, before the insert", async () => {
  const { kernel, events } = recordingKernel();
  const seq = await new SqlSettingsRepo({ kernel, tables: TABLES }, {}).appendRevision({
    entityKind: "value", settingId: "s", scope: "global", workspaceId: null, principalId: null, op: "set",
    beforeJson: null, afterJson: "x", defVersion: 1, actor: "a", originPluginId: null, changeSetId: null, createdAt: "t",
  });
  assert.equal(seq, 7);
  assert.deepEqual(events, ["begin", "lock:setting_revisions", "statement", "commit"]);
});
