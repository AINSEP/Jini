import { afterEach, expect, it as test, vi } from "vitest";

import { awaitBootWorkWithinBound } from "../await-boot-work.js";

/**
 * @file A store close must not land under boot work the composition started and never awaited
 * (`legacyPublishCredentialsReady`, `createApp`'s BYOK tool-registration pass), or those passes log
 * "The database connection is not open". The wait is bounded so a hung pass cannot hang shutdown.
 *
 * Outcome Matrix:
 *   Given no boot work                         -> resolves at once, nothing logged
 *   Given two pending passes                   -> resolves only after BOTH settle
 *   Given a pass that rejects                  -> still resolves (the close must run), nothing logged
 *   Given a pass that never settles            -> resolves after the bound, logged
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A logger port that records each line's message (and nothing else) into `logged`. */
function lineLogger(logged: string[]) {
  const write = ({ message }: { message: string }) => void logged.push(message);
  return { info: write, warn: write, error: write };
}

/** Resolves after every currently queued microtask and one macrotask turn. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("no boot work resolves at once and logs nothing", async () => {
  const logged: string[] = [];

  await awaitBootWorkWithinBound({ work: [], logger: lineLogger(logged) });

  expect(logged).toEqual([]);
});

test("waits until every boot pass has settled", async () => {
  const legacy = deferred();
  const byok = deferred();
  let done = false;

  const waiting = awaitBootWorkWithinBound({ work: [legacy.promise, byok.promise], logger: lineLogger([]) }).then(() => (done = true));
  await tick();
  expect(done, "nothing has settled yet").toBe(false);

  legacy.resolve();
  await tick();
  expect(done, "the BYOK pass is still running").toBe(false);

  byok.resolve();
  await waiting;
  expect(done).toBe(true);
});

test("a rejected boot pass still lets the wait resolve, so the close runs", async () => {
  const failing = deferred();
  const logged: string[] = [];
  const waiting = awaitBootWorkWithinBound({ work: [failing.promise], logger: lineLogger(logged) });

  failing.reject(new Error("boom"));

  await waiting;
  expect(logged).toEqual([]);
});

test("a boot pass that never settles is abandoned after the bound, and logged", async () => {
  const logged: string[] = [];
  const startedAt = Date.now();

  await awaitBootWorkWithinBound({ work: [new Promise<void>(() => {})], logger: lineLogger(logged) }, { timeoutMs: 20 });

  expect(Date.now() - startedAt >= 15, "the wait lasted roughly the bound").toBe(true);
  expect(logged).toEqual(["[shutdown] boot work did not settle within 20 ms; closing the store anyway"]);
});

test("the abandoned pass is reported on the injected logger's error level, never straight to stderr", async () => {
  const errors: unknown[] = [];
  vi.spyOn(console, "error").mockImplementation((message: unknown) => void errors.push(message));
  const reported: string[] = [];
  const write = ({ message }: { message: string }) => void reported.push(message);

  await awaitBootWorkWithinBound({ work: [new Promise<void>(() => {})], logger: { info: () => {}, warn: () => {}, error: write } }, { timeoutMs: 5 });

  expect(reported).toEqual(["[shutdown] boot work did not settle within 5 ms; closing the store anyway"]);
  expect(errors).toEqual([]);
});
