import assert from "node:assert/strict";
import { test } from "vitest";
import { sql } from "kysely";

import { gateJournalKernel, type JournalKernel } from "../../recovery/journal-kernel.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const callback = async () => "callback result";
const statement = sql`SELECT 'journal value' AS payload`;
const operations = [
  { method: "run", argument: callback, result: "run result", invoke: (k: JournalKernel) => k.run(callback) },
  { method: "transaction", argument: callback, result: "transaction result", invoke: (k: JournalKernel) => k.transaction(callback) },
  { method: "query", argument: statement, result: [{ payload: "journal value" }], invoke: (k: JournalKernel) => k.query(statement) },
  { method: "execute", argument: statement, result: undefined, invoke: (k: JournalKernel) => k.execute(statement) },
  { method: "backupTo", argument: "/isolated-fixture/backup.db", result: undefined, invoke: (k: JournalKernel) => k.backupTo("/isolated-fixture/backup.db") },
] as const;

// These are forwarding-contract tests. Real persistence/rollback is covered in
// the host's journal-kernel integration test (real SQLite file); only the underlying port is faked here (F2.6).
function strictPort(method: string, argument: unknown, result: unknown, calls: unknown[][], failure?: Error): JournalKernel {
  const unexpected = () => { assert.fail("unexpected underlying journal operation"); };
  return {
    dialect: "sqlite", transport: "better-sqlite3", ready: Promise.resolve(),
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: true },
    run: unexpected, transaction: unexpected, query: unexpected, execute: unexpected,
    backupTo: unexpected, close: unexpected, lockKey: unexpected, require: unexpected, inTransaction: unexpected,
    [method]: async (...args: unknown[]) => {
      calls.push(args);
      assert.equal(args.length, method === "close" ? 0 : 1);
      if (method !== "close") assert.equal(args[0], argument);
      if (failure) throw failure;
      return result;
    },
  } as JournalKernel;
}

for (const operation of operations) {
  // Mutation: delete await ready in this method. F7.1 requires asserting while readiness is held.
  test(`${operation.method} waits for readiness, forwards its exact input, and returns the port result`, async () => {
    const ready = deferred();
    const calls: unknown[][] = [];
    const port = strictPort(operation.method, operation.argument, operation.result, calls);
    const kernel = gateJournalKernel({ kernel: port, ready: ready.promise });
    assert.equal(kernel.ready, ready.promise);
    const done = operation.invoke(kernel);
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(calls, []);
    } finally {
      ready.resolve();
    }
    assert.deepEqual(await done, operation.result);
    assert.deepEqual(calls, [[operation.argument]]);
    // A second call must still reach the port, not reuse the first result (F6.2).
    assert.deepEqual(await operation.invoke(kernel), operation.result);
    assert.deepEqual(calls, [[operation.argument], [operation.argument]]);
  });

  // Mutation: catch readiness errors and continue into the port. Error identity pins the cause.
  test(`${operation.method} rejects with the readiness error without entering the underlying kernel`, async () => {
    const ready = deferred();
    const calls: unknown[][] = [];
    const kernel = gateJournalKernel({ kernel: strictPort(operation.method, operation.argument, operation.result, calls), ready: ready.promise });
    const error = new Error(`schema unavailable for ${operation.method}`);
    const first = assert.rejects(operation.invoke(kernel), actual => actual === error);
    ready.reject(error);
    await first;
    await assert.rejects(operation.invoke(kernel), actual => actual === error);
    assert.deepEqual(calls, []);
  });

  // Mutation: swallow a port failure after readiness. Readiness failure must not mask this path.
  test(`${operation.method} propagates the underlying operation error after readiness`, async () => {
    const calls: unknown[][] = [];
    const error = new Error(`port failure for ${operation.method}`);
    const kernel = gateJournalKernel({ kernel: strictPort(operation.method, operation.argument, operation.result, calls, error), ready: Promise.resolve() });
    await assert.rejects(operation.invoke(kernel), actual => actual === error);
    assert.deepEqual(calls, [[operation.argument]]);
  });
}

for (const fails of [false, true]) {
  // Mutation: await ready directly in close; a rejected open must still close the underlying handle.
  test(`close waits for ${fails ? "failed" : "successful"} readiness and releases the underlying handle`, async () => {
    const ready = deferred();
    const calls: unknown[][] = [];
    const kernel = gateJournalKernel({ kernel: strictPort("close", undefined, undefined, calls), ready: ready.promise });
    const closed = kernel.close();
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(calls, []);
    } finally {
      if (fails) ready.reject(new Error("open failed"));
      else ready.resolve();
    }
    await closed;
    assert.deepEqual(calls, [[]]);
  });
}

test("close propagates a close failure even after the schema open failed", async () => {
  const calls: unknown[][] = [];
  const error = new Error("close failed");
  const kernel = gateJournalKernel({ kernel: strictPort("close", undefined, undefined, calls, error), ready: Promise.reject(new Error("open failed")) });
  await assert.rejects(kernel.close(), actual => actual === error);
  assert.deepEqual(calls, [[]]);
});
