import { EventEmitter } from "node:events";
import { afterEach, expect, it as test, vi } from "vitest";

import { closeStoreOnShutdown, closeWithinBound, type ShutdownProcess } from "../close-store-on-shutdown.js";

/**
 * @file The defaults and the non-Error/failed-daemon paths of the bounded shutdown close that the
 * per-dialect matrix (`close-store-on-shutdown.test.ts`) does not reach: every line goes to the
 * injected logger (never straight to `console.error`), with no `timeoutMs` the bound is the documented
 * 4 s, a non-Error rejection reaches the logger's error bag, and a daemon whose tree-stop REJECTED is
 * logged rather than lost —
 * after the store has closed and the process still exits 0.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A logger port recording each line's message, and separately what went in its error bag. */
function recordingLogger(logged: string[] = [], errors: unknown[] = []) {
  const write = ({ message }: { message: string }, optional?: { error?: unknown }) => {
    logged.push(message);
    if (optional !== undefined && "error" in optional) errors.push(optional.error);
  };
  return { info: write, warn: write, error: write };
}

test("closeWithinBound with no options logs a hung close on the injected logger (never console.error) after the default 4000 ms bound, then resolves", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const logged: string[] = [];
  let settled = false;
  const done = closeWithinBound({ close: () => new Promise<void>(() => {}), label: "the hung store", logger: recordingLogger(logged) }).then(() => { settled = true; });
  vi.advanceTimersByTime(3_999);
  await Promise.resolve();
  expect(settled).toBe(false);
  vi.advanceTimersByTime(1);
  await done;
  expect(logged).toEqual(["[shutdown] the hung store did not close within 4000 ms; exiting anyway"]);
  expect(errors).not.toHaveBeenCalled();
});

test("closeWithinBound hands a non-Error rejection to the logger's error bag, keeps it out of the line, and still resolves", async () => {
  const logged: string[] = [];
  const failures: unknown[] = [];
  await closeWithinBound({ close: () => Promise.reject("disk vanished"), label: "the sqlite store", logger: recordingLogger(logged, failures) }, { timeoutMs: 1_000 });
  expect(logged).toEqual(["[shutdown] closing the sqlite store failed"]);
  expect(failures).toEqual(["disk vanished"]);
});

class FakeProcess extends EventEmitter implements ShutdownProcess {
  readonly exits: number[] = [];
  exit(code: number): void {
    this.exits.push(code);
    this.emit("exited");
  }
}

test("closeStoreOnShutdown: a daemon stop that rejects is logged on the injected logger, after the store closed, and the process exits 0", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const logged: string[] = [];
  const failures: unknown[] = [];
  const treeStop = new Error("tree-stop failed");
  const order: string[] = [];
  const proc = new FakeProcess();
  const store = { storage: { kind: "sqlite" }, close: async () => { order.push("store closed"); } };
  closeStoreOnShutdown(
    { store, onShutdown: () => { order.push("daemon stop"); return Promise.reject(treeStop); }, logger: recordingLogger(logged, failures) },
    { proc, timeoutMs: 400 },
  );
  const exited = new Promise((resolve) => proc.once("exited", resolve));
  proc.emit("SIGTERM");
  await exited;
  expect(order).toEqual(["daemon stop", "store closed"]);
  expect(proc.exits).toEqual([0]);
  expect(logged).toEqual(["[shutdown] closing the sqlite store failed"]);
  expect(failures).toEqual([treeStop]);
  expect(errors).not.toHaveBeenCalled();
});
