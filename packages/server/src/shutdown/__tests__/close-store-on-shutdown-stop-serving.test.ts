import { EventEmitter } from "node:events";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it as test, vi } from "vitest";

import { closeStoreOnShutdown, stopServingWithinGrace, type ShutdownProcess } from "../close-store-on-shutdown.js";

/**
 * @file The default boot's (`index.ts`) shutdown stops serving before it closes the store. It used
 * to discard `createServingApp`'s outbox-drainer and trash-sweeper handles and never close the
 * listener, so a SIGTERM while the drainer awaited a subscriber closed the store beneath that
 * delivery; the claimed event stayed `processing` until its lease expired and was delivered again.
 *
 * Outcome Matrix:
 *   Given a stopServing port, SIGTERM          -> serving stops (and settles) before the store closes
 *   Given a worker mid-run                     -> stopServingWithinGrace waits for its stop()
 *   Given a request in flight                  -> it completes, then the listener reports closed
 *   Given a worker whose stop() rejects         -> the shutdown still resolves
 */

afterEach(() => {
  vi.useRealTimers();
});

class FakeProcess extends EventEmitter implements ShutdownProcess {
  exit(): void {
    this.emit("exited");
  }
  exited(): Promise<void> {
    return new Promise((resolve) => this.once("exited", () => resolve()));
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  return { promise: new Promise<void>((res) => (resolve = res)), resolve };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("SIGTERM: stopServing settles before boot work is awaited and the store closes", async () => {
  const proc = new FakeProcess();
  const order: string[] = [];
  const serving = deferred();
  closeStoreOnShutdown(
    { store: { storage: { kind: "postgres" }, close: async () => void order.push("close") }, onShutdown: () => {} },
    { proc, stopServing: async () => { order.push("stop-serving"); await serving.promise; order.push("serving-stopped"); } }
  );
  const exited = proc.exited();
  proc.emit("SIGTERM");
  await tick();
  expect(order, "the store must not close while serving is still stopping").toEqual(["stop-serving"]);
  serving.resolve();
  await exited;
  expect(order).toEqual(["stop-serving", "serving-stopped", "close"]);
});

test("stopServingWithinGrace waits for a running worker's stop and a request in flight", async () => {
  const order: string[] = [];
  const release = deferred();
  const server = createServer((_req, res) => {
    order.push("request");
    void release.promise.then(() => res.end("done"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const response = new Promise<string>((resolve) => {
    request({ port, host: "127.0.0.1", path: "/", agent: false }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve(body));
    }).end();
  });
  while (!order.includes("request")) await tick();

  const drain = deferred();
  const stopped = stopServingWithinGrace(
    { server, workers: [{ stop: async () => { await drain.promise; order.push("drainer-stopped"); } }] },
    { graceMs: 5_000 }
  ).then(() => order.push("stopped"));
  await tick();
  expect(server.listening, "the listener stops taking connections at once").toBe(false);
  drain.resolve();
  await tick();
  expect(!order.includes("stopped"), "still waiting on the request in flight").toBe(true);
  release.resolve();
  expect(await response).toBe("done");
  await stopped;
  expect(order).toEqual(["request", "drainer-stopped", "stopped"]);
});

test("stopServingWithinGrace still resolves when a worker's stop rejects and the listener was never started", async () => {
  const server = createServer();
  await stopServingWithinGrace({ server, workers: [{ stop: async () => { throw new Error("boom"); } }] });
  expect(server.listening).toBe(false);
});

test("an upgraded socket cannot hold database disposal past the listener grace", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const proc = new FakeProcess();
  const calls: string[] = [];
  const server = {
    close: () => { calls.push("listener"); },
    closeIdleConnections: () => { calls.push("idle"); },
    closeAllConnections: () => { calls.push("cut"); },
  };
  closeStoreOnShutdown({
    store: { storage: { kind: "sqlite" }, close: async () => { calls.push("store"); } },
    onShutdown: () => {},
  }, { proc, stopServing: () => stopServingWithinGrace({ server, workers: [] }, { graceMs: 500 }) });
  const exited = proc.exited();
  proc.emit("SIGTERM");
  expect(calls).toEqual(["listener", "idle"]);
  vi.advanceTimersByTime(500);
  await exited;
  expect(calls).toEqual(["listener", "idle", "cut", "store"]);
});
