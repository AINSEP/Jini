import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemorySettingsRepo } from "../repo.memory.js";
import type { SettingRevisionRecord } from "../types.js";

/**
 * The in-memory repo is the reference adapter every settings test runs on, so
 * its ledger-sequence and transaction semantics are contracts of their own:
 * a seeded ledger must continue numbering past its highest seq, and an
 * overlapping transaction must be refused rather than silently joined.
 */

const NOW = "2026-07-12T00:00:00.000Z";

function revision(seq: number): SettingRevisionRecord {
  return {
    seq,
    entityKind: "value",
    settingId: "setting-1",
    scope: "global",
    workspaceId: null,
    principalId: null,
    op: "set",
    beforeJson: null,
    afterJson: "v",
    defVersion: 1,
    actor: "actor-1",
    originPluginId: null,
    changeSetId: null,
    createdAt: NOW,
  };
}

test("a repo seeded with an out-of-order ledger reports the highest seq and continues numbering after it", async () => {
  const repo = new InMemorySettingsRepo({ revisions: [revision(7), revision(3)] });

  assert.equal(await repo.maxRevisionSeq(), 7);
  const { seq: _seq, ...unsequenced } = revision(0);
  assert.equal(await repo.appendRevision(unsequenced), 8);
  assert.deepEqual((await repo.listRevisions({ settingId: "setting-1" })).map((r) => r.seq), [3, 7, 8]);
});

test("transaction refuses a second overlapping transaction and leaves the outer one able to commit", async () => {
  const repo = new InMemorySettingsRepo();
  const { seq: _seq, ...unsequenced } = revision(0);

  const committed = await repo.transaction(async () => {
    await repo.appendRevision(unsequenced);
    await assert.rejects(() => repo.transaction(async () => "inner"), /not reentrant/);
    return "outer";
  });

  assert.equal(committed, "outer");
  assert.equal(await repo.maxRevisionSeq(), 1);
  // The refusal released nothing: a fresh transaction after the outer one finished is allowed.
  assert.equal(await repo.transaction(async () => "next"), "next");
});

test("a throwing transaction rolls back its ledger writes and the seq counter with them", async () => {
  const repo = new InMemorySettingsRepo({ revisions: [revision(2)] });
  const { seq: _seq, ...unsequenced } = revision(0);

  await assert.rejects(
    () =>
      repo.transaction(async () => {
        await repo.appendRevision(unsequenced);
        throw new Error("boom");
      }),
    /boom/
  );

  assert.equal(await repo.maxRevisionSeq(), 2);
  assert.equal(await repo.appendRevision(unsequenced), 3);
  // The failed transaction released the non-reentrancy flag: the next one is not refused.
  assert.equal(await repo.transaction(async () => "again"), "again");
});
