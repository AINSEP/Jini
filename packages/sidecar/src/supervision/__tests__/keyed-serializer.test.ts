/**
 * @file Direct tests for `keyed-serializer.ts`. No Electron, no real child process — pure promise
 * ordering, asserted against a controllable fake `fn`.
 */
import { test } from "vitest";
import assert from "node:assert/strict";

import { createKeyedSerializer } from "../supervisor.js";

function deferred() {
  let resolve!: (value?: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

test("run() resolves to fn's own return value", async () => {
  const { run } = createKeyedSerializer({});
  const result = await run({ key: "site-a", fn: () => Promise.resolve(42) });
  assert.equal(result, 42);
});

test("two calls for the SAME key run strictly one after another, never overlapping", async () => {
  const { run } = createKeyedSerializer({});
  const order: string[] = [];
  const first = deferred();

  const call1 = run({ key: "site-a", fn: async () => {
    order.push("1-start");
    await first.promise;
    order.push("1-end");
  } });
  const call2 = run({ key: "site-a", fn: async () => {
    order.push("2-start");
  } });

  // call2's body must not have run yet — call1 is still awaiting `first`.
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(order, ["1-start"]);

  first.resolve();
  await Promise.all([call1, call2]);
  assert.deepEqual(order, ["1-start", "1-end", "2-start"]);
});

test("calls for DIFFERENT keys are never serialized against each other", async () => {
  const { run } = createKeyedSerializer({});
  const order: string[] = [];
  const blockA = deferred();

  const callA = run({ key: "site-a", fn: async () => {
    order.push("a-start");
    await blockA.promise;
    order.push("a-end");
  } });
  const callB = run({ key: "site-b", fn: async () => {
    order.push("b-start");
    order.push("b-end");
  } });

  await callB;
  assert.deepEqual(order, ["a-start", "b-start", "b-end"]);

  blockA.resolve();
  await callA;
  assert.deepEqual(order, ["a-start", "b-start", "b-end", "a-end"]);
});

test("a failed call does not block the next call queued behind it for the same key", async () => {
  const { run } = createKeyedSerializer({});
  const order: string[] = [];

  const call1 = run({ key: "site-a", fn: async () => {
    order.push("1");
    throw new Error("boom");
  } });
  const call2 = run({ key: "site-a", fn: async () => {
    order.push("2");
    return "ok";
  } });

  await assert.rejects(call1, /boom/);
  assert.equal(await call2, "ok");
  assert.deepEqual(order, ["1", "2"]);
});


test("settling an older job cannot release a newer same-key tail", async () => {
  const { run } = createKeyedSerializer({});
  const first = deferred();
  const second = deferred();
  const started = deferred();
  const order: string[] = [];
  const one = run({ key: "a", fn: () => first.promise });
  const two = run({ key: "a", fn: async () => {
    order.push("two");
    started.resolve();
    await second.promise;
  } });
  first.resolve();
  await one;
  await started.promise;
  const three = run({ key: "a", fn: () => { order.push("three"); } });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(order, ["two"]);
  second.resolve();
  await Promise.all([two, three]);
  assert.deepEqual(order, ["two", "three"]);
});
