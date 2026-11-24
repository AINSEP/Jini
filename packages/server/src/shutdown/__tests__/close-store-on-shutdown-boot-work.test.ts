import { EventEmitter } from "node:events";
import { expect, it as test } from "vitest";

import { closeStoreOnShutdown, type ShutdownProcess } from "../close-store-on-shutdown.js";

/**
 * @file The default boot's (`index.ts`) store close waits for the boot work the composition started
 * and never awaited, the same race the CLI serve command had (ffa366a90): `legacyPublishCredentialsReady`
 * and `createServingApp`'s `bootWork` (the BYOK tool-registration pass) read the store, and a site
 * stopped seconds after boot closed it under them ("The database connection is not open").
 *
 * Outcome Matrix:
 *   Given boot work registered after the handlers, SIGTERM -> close waits for every pass, then exit(0)
 *   Given a boot pass that never settles, SIGINT           -> close runs after half the bound, logged
 *   Given no bootWork port                                 -> close runs at once (unchanged)
 */

class FakeProcess extends EventEmitter implements ShutdownProcess {
  readonly exits: number[] = [];
  exit(code: number): void {
    this.exits.push(code);
    this.emit("exited");
  }
  exited(): Promise<void> {
    return new Promise((resolve) => this.once("exited", () => resolve()));
  }
}

function postgresStore(close: () => Promise<void>) {
  return { storage: { kind: "postgres", secretRef: "site" }, close };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  return { promise: new Promise<void>((res) => (resolve = res)), resolve };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A logger port recording each line's message, and separately what went in its error bag. */
function recordingLogger(logged: string[] = [], errors: unknown[] = []) {
  const write = ({ message }: { message: string }, optional?: { error?: unknown }) => {
    logged.push(message);
    if (optional !== undefined && "error" in optional) errors.push(optional.error);
  };
  return { info: write, warn: write, error: write };
}

test("SIGTERM: the store close waits for boot work registered after the handlers, then exits 0", async () => {
  const proc = new FakeProcess();
  const order: string[] = [];
  const legacyWork = deferred();
  const byokWork = deferred();
  // index.ts registers the handlers before createServingApp returns its bootWork, so the port is
  // read when the close starts, not at registration.
  const bootWork: Promise<unknown>[] = [legacyWork.promise];
  closeStoreOnShutdown(
    { store: postgresStore(async () => void order.push("close")), onShutdown: () => order.push("daemon"), logger: recordingLogger() },
    { proc, bootWork: () => bootWork }
  );
  bootWork.push(byokWork.promise);
  const exited = proc.exited();

  proc.emit("SIGTERM");
  await tick();
  expect(order, "the store close must wait for the legacy publish-credential tail").toEqual(["daemon"]);
  legacyWork.resolve();
  await tick();
  expect(order, "the BYOK tool-registration pass is still running").toEqual(["daemon"]);
  byokWork.resolve();
  await exited;

  expect(order).toEqual(["daemon", "close"]);
  expect(proc.exits).toEqual([0]);
});

test("a boot pass that never settles is abandoned after half the bound; the store still closes", async () => {
  const proc = new FakeProcess();
  const logs: string[] = [];
  let closes = 0;
  closeStoreOnShutdown(
    { store: postgresStore(async () => void (closes += 1)), onShutdown: () => {}, logger: recordingLogger(logs) },
    { proc, timeoutMs: 200, bootWork: () => [new Promise<void>(() => {})] }
  );
  const exited = proc.exited();

  proc.emit("SIGINT");
  await exited;

  expect(closes).toBe(1);
  expect(proc.exits).toEqual([0]);
  expect(logs).toEqual(["[shutdown] boot work did not settle within 100 ms; closing the store anyway"]);
});

test("without a bootWork port the store closes at once", async () => {
  const proc = new FakeProcess();
  let closes = 0;
  closeStoreOnShutdown({ store: postgresStore(async () => void (closes += 1)), onShutdown: () => {}, logger: recordingLogger() }, { proc });
  const exited = proc.exited();

  proc.emit("SIGTERM");
  await exited;

  expect(closes).toBe(1);
});
