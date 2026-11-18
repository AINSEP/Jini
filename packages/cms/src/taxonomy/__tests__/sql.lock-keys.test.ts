import assert from "node:assert/strict";
import { test } from "vitest";

import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import { SqlEntryTermRepo, SqlTaxonomyRepo } from "../sql/index.js";
import { TAXONOMY_TABLES } from "./support/taxonomy-tables.fixture.js";

/**
 * @file The taxonomy lock key, asserted exactly against a recording fake that implements the kernel interface:
 * `transaction` runs the body, `lockKey` records its argument, and `run` records that a statement ran, so the
 * order lock-before-read is observable. The fake's `run` answers every statement with no rows.
 */

function recordingKernel(): { kernel: StorageKernel<Kysely<unknown>, unknown>; events: string[] } {
  const events: string[] = [];
  const kernel: StorageKernel<Kysely<unknown>, unknown> = {
    dialect: "sqlite",
    transport: "fake",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    run: async () => { events.push("statement"); return [] as never; },
    transaction: async (fn) => { events.push("begin"); const result = await fn(); events.push("commit"); return result; },
    lockKey: async (key) => { events.push(`lock:${key}`); },
    inTransaction: () => true,
    require: () => undefined,
    backupTo: async () => undefined,
    close: async () => undefined,
  };
  return { kernel, events };
}

test("the taxonomy transaction takes the workspace's key inside the transaction, before the callback", async () => {
  const { kernel, events } = recordingKernel();
  const repo = new SqlTaxonomyRepo({ kernel, tables: TAXONOMY_TABLES, workspaceId: "ws-a" }, {});
  const result = await repo.transaction({ fn: async () => { events.push("body"); return "done"; } });
  assert.equal(result, "done");
  assert.deepEqual(events, ["begin", "lock:taxonomy:ws-a", "body", "commit"]);
});

test("the term re-point takes the same key, before it reads the rows it moves", async () => {
  const { kernel, events } = recordingKernel();
  const repo = new SqlEntryTermRepo({ kernel, tables: TAXONOMY_TABLES, workspaceId: "ws-b" }, {});
  await repo.repointTerm({ fromTermId: "a", intoTermId: "b" });
  assert.deepEqual(events, ["begin", "lock:taxonomy:ws-b", "statement", "statement", "commit"]);
});
