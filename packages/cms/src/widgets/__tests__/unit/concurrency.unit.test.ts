import assert from "node:assert/strict";
import test from "../support/test-runner.js";
import { withEntryLock } from "../support/compat/concurrency.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

// F7.1: barriers expose overlap; a guessed sleep cannot prove exclusion.
test("same-key work queues in call order while another key progresses independently", { timeout: 2000 }, async () => {
  const entered = deferred();
  const release = deferred();
  const seen: string[] = [];
  const first = withEntryLock("b10-fifo", async () => { seen.push("first-start"); entered.resolve(); await release.promise; seen.push("first-end"); return 11; });
  await entered.promise;
  const second = withEntryLock("b10-fifo", async () => { seen.push("second"); return 22; });
  const third = withEntryLock("b10-fifo", async () => { seen.push("third"); return 33; });
  try {
    assert.equal(await withEntryLock("b10-independent", async () => { seen.push("other"); return 44; }), 44);
    assert.deepEqual(seen, ["first-start", "other"]);
  } finally { release.resolve(); }
  assert.deepEqual(await Promise.all([first, second, third]), [11, 22, 33]);
  assert.deepEqual(seen, ["first-start", "other", "first-end", "second", "third"]);
});

test("a failed holder rejects but releases its queued successor and allows reuse", { timeout: 2000 }, async () => {
  const entered = deferred();
  const release = deferred();
  const first = withEntryLock("b10-rejection", async () => { entered.resolve(); await release.promise; throw new Error("write failed"); });
  const rejected = assert.rejects(first, { message: "write failed" });
  await entered.promise;
  const second = withEntryLock("b10-rejection", async () => "recovered");
  release.resolve();
  await rejected;
  assert.equal(await second, "recovered");
  assert.equal(await withEntryLock("b10-rejection", async () => "reused"), "reused");
});
