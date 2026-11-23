import assert from "node:assert/strict";
import { test } from "vitest";
import { startMailRetention } from "../retention.js";
import type { MailSqlKernel } from "../ledger.repo.js";

test("retention has one boot pass, skips overlap, drains before close, and rejects invalid intervals", async () => {
  let tick!: () => void, release!: () => void; const held = new Promise<void>(yes => { release = yes; }); let passes = 0, writes = 0, cancelled = false;
  const db = { transaction: async (run: () => Promise<void>) => { passes++; await held; await run(); }, execute: async () => { writes++; } } as unknown as MailSqlKernel<unknown>;
  const stop = startMailRetention({ db }, { now: () => 0, every: run => { tick = run; return () => { cancelled = true; }; } });
  tick(); assert.equal(passes, 1); let stopped = false; const closing = stop().then(() => { stopped = true; });
  assert.equal(cancelled, true); assert.equal(stopped, false); release(); await closing; tick(); assert.equal(passes, 1); assert.equal(writes, 5);
  for (const intervalMs of [0, -1, 1.5, NaN]) assert.throws(() => startMailRetention({ db }, { intervalMs }), /interval must be positive/);
});

test("a failed pass can retry; a throwing logger cannot reject timer work", async () => {
  let tick!: () => void, attempts = 0, reports = 0;
  const db = { transaction: async () => { attempts++; throw new Error("disk"); } } as unknown as MailSqlKernel<unknown>;
  const stop = startMailRetention({ db }, { every: run => { tick = run; return () => {}; }, onError: () => { reports++; throw new Error("logger"); } });
  await new Promise<void>(yes => setImmediate(yes)); tick(); await stop(); assert.equal(attempts, 2); assert.equal(reports, 2);
});
