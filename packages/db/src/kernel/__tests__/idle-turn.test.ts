import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildKernel, type KernelDriver } from "../kernel-core.js";
import { withIdleTurn } from "../idle-turn.js";
import type { KyselyKernel } from "../port.js";
import { openMemorySqliteKernel, openSqliteFileKernel, sqliteConnectionOf } from "../sqlite/index.js";

type Schema = { t: { id: string } };
const open = (filePath: string, options?: Database.Options) => new Database(filePath, options);
const dirs: string[] = [];
const kernels: KyselyKernel<Schema>[] = [];

/** A latch the test releases by hand, so an open transaction/run stays open across an assertion. */
function gate(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

const flavours: Array<[string, () => KyselyKernel<Schema>]> = [
  ["in-memory", () => openMemorySqliteKernel<Schema>({ open })],
  ["file-backed", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "idle-turn-"));
    dirs.push(dir);
    return openSqliteFileKernel<Schema>({ open, filePath: path.join(dir, "site.db") });
  }],
];

function track(kernel: KyselyKernel<Schema>): KyselyKernel<Schema> { kernels.push(kernel); return kernel; }

afterEach(async () => {
  for (const kernel of kernels.splice(0)) await kernel.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.each(flavours)("withIdleTurn on a %s kernel", (_name, make) => {
  it("step never runs while a kernel transaction is open", async () => {
    const kernel = track(make());
    const held = gate();
    const tx = kernel.transaction(async () => { await held.promise; });
    await Promise.resolve();
    const body = vi.fn(async () => "ran");
    await expect(withIdleTurn({ kernel, body })).resolves.toEqual({ ran: false, reason: "busy" });
    expect(body).not.toHaveBeenCalled();
    held.release();
    await tx;
  });

  it("refuses inside run() and inside transaction()", async () => {
    const kernel = track(make());
    const body = vi.fn(async () => "ran");
    await expect(kernel.run(() => withIdleTurn({ kernel, body }))).resolves.toEqual({ ran: false, reason: "in-scope" });
    await expect(kernel.transaction(() => withIdleTurn({ kernel, body }))).resolves.toEqual({ ran: false, reason: "in-scope" });
    expect(body).not.toHaveBeenCalled();
  });

  it("refuses when a foreign BEGIN is open on the raw handle", async () => {
    const kernel = track(make());
    await kernel.ready;
    const client = sqliteConnectionOf({ kernel })!;
    client.exec("BEGIN IMMEDIATE");
    const body = vi.fn(async () => "ran");
    try {
      await expect(withIdleTurn({ kernel, body })).resolves.toEqual({ ran: false, reason: "transaction-open" });
    } finally { client.exec("ROLLBACK"); }
    expect(body).not.toHaveBeenCalled();
    // The refusal released the turn it briefly took: an owned transaction still starts.
    await expect(kernel.transaction(async () => "after")).resolves.toBe("after");
  });

  it("queued work is never overtaken", async () => {
    const kernel = track(make());
    const runHeld = gate(), txHeld = gate();
    const run = kernel.run(async () => { await runHeld.promise; });
    await Promise.resolve();
    let txStarted = false;
    const tx = kernel.transaction(async () => { txStarted = true; await txHeld.promise; });
    const body = vi.fn(async () => "ran");
    // A transaction is queued behind the run: the idle turn may not cut in line.
    await expect(withIdleTurn({ kernel, body })).resolves.toEqual({ ran: false, reason: "busy" });
    runHeld.release();
    await run;
    await vi.waitFor(() => expect(txStarted).toBe(true));
    await expect(withIdleTurn({ kernel, body })).resolves.toEqual({ ran: false, reason: "busy" });
    txHeld.release();
    await tx;
    expect(body).not.toHaveBeenCalled();
  });

  it("a transaction requested during the body waits until the body returns", async () => {
    const kernel = track(make());
    const order: string[] = [];
    const entered = gate(), finish = gate();
    const turn = withIdleTurn({ kernel, body: async () => {
      order.push("body-start");
      entered.release();
      await finish.promise;
      order.push("body-end");
      return "done";
    } });
    await entered.promise;
    // A request on the test's own async chain, outside the body's held-lock scope.
    const tx = kernel.transaction(async () => { order.push("tx-start"); });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(["body-start"]);
    finish.release();
    await expect(turn).resolves.toEqual({ ran: true, value: "done" });
    await tx;
    expect(order).toEqual(["body-start", "body-end", "tx-start"]);
  });

  it("kernel calls inside the body throw", async () => {
    const kernel = track(make());
    const result = withIdleTurn({ kernel, body: () => kernel.run(async () => "nested") });
    await expect(result).rejects.toThrow(/already holds another connection/);
    await expect(withIdleTurn({ kernel, body: () => kernel.transaction(async () => "nested") })).rejects.toThrow(/already holds/);
  });

  it("releases after the body throws", async () => {
    const kernel = track(make());
    await expect(withIdleTurn({ kernel, body: async () => { throw new Error("body failed"); } })).rejects.toThrow("body failed");
    await expect(kernel.transaction(async () => "next")).resolves.toBe("next");
    await expect(withIdleTurn({ kernel, body: async () => "again" })).resolves.toEqual({ ran: true, value: "again" });
  });
});

it("postgres-shaped kernel without a turn lock returns unsupported", async () => {
  const driver = {
    dialect: "postgres", transport: "pg", capabilities: { interactiveTransactions: true, backup: false },
    ready: Promise.resolve(), oneConnection: false, base: {} as never,
    begin: async () => { throw new Error("unused"); }, lockKey: async () => {}, close: async () => {},
  } as unknown as KernelDriver<Schema>;
  const kernel = buildKernel<Schema>({ driver });
  const body = vi.fn(async () => "ran");
  await expect(withIdleTurn({ kernel, body })).resolves.toEqual({ ran: false, reason: "unsupported" });
  expect(body).not.toHaveBeenCalled();
});

it("a kernel this package did not build returns unsupported", async () => {
  const foreign = { ready: Promise.resolve() } as unknown as KyselyKernel<Schema>;
  await expect(withIdleTurn({ kernel: foreign, body: async () => "ran" })).resolves.toEqual({ ran: false, reason: "unsupported" });
});
