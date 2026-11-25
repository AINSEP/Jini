import { expect, it } from "vitest";
import { createSettlementWorker } from "../settlement-worker.js";

// Pins for the settlement worker's claim decision (one holder per owner, duplicate kicks recognised
// as no-ops) and its failure path (a failed cycle is surfaced once, retried, and never wedges the claim).
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture({ owner = true, pending = true } = {}) {
  const timers: { run: () => void; delayMs: number }[] = [];
  const warnings: { message: string; error: unknown }[] = [];
  const state = { active: true, pending, runs: 0, acquisitions: 0, releases: 0, failure: null as Error | null };
  const worker = createSettlementWorker({
    owner, active: async () => state.active, hasPending: async () => state.pending,
    run: async () => { state.runs++; if (state.failure) throw state.failure; },
    warn: ({ message }, optional) => { warnings.push({ message, error: optional?.error }); },
    withOwnership: async run => { state.acquisitions++; try { await run(); return { acquired: true }; } finally { state.releases++; } },
    schedule: (run, delayMs) => { const entry = { run, delayMs }; timers.push(entry); return () => { const i = timers.indexOf(entry); if (i >= 0) timers.splice(i, 1); }; },
  });
  return { worker, timers, warnings, state };
}

it("settles a recorded payment once for concurrent duplicate kicks and recognises the rest as duplicates", async () => {
  const { worker, state, timers } = fixture();
  await Promise.all([worker.kick(), worker.kick(), worker.kick()]);
  expect(state).toMatchObject({ runs: 1, acquisitions: 1 });
  expect(timers.map(t => t.delayMs)).toEqual([5000]);
  await worker.close();
  expect(state.releases).toBe(1);
});

it("a non-owner composition never claims or schedules, however often it is kicked", async () => {
  const { worker, state, timers } = fixture({ owner: false });
  await worker.kick(); await worker.kick();
  expect(state).toMatchObject({ runs: 0, acquisitions: 0 }); expect(timers).toEqual([]);
  await worker.close();
});

it("a failed cycle surfaces the same error once, keeps retrying, and releases the claim when drained", async () => {
  const { worker, state, timers, warnings } = fixture();
  const failure = new Error("effect failed");
  state.failure = failure;
  await worker.kick();
  expect(warnings).toEqual([{ message: "Payment settlement is delayed; recorded payments will retry automatically. Cause: Error", error: failure }]);
  expect(timers.map(t => t.delayMs)).toEqual([5000]);
  timers.shift()!.run(); await tick();
  expect(state.runs).toBe(2); expect(warnings).toHaveLength(1);
  state.failure = null; timers.shift()!.run(); await tick();
  state.failure = failure; timers.shift()!.run(); await tick();
  expect(warnings).toHaveLength(2);
  state.failure = null; state.active = false; state.pending = false; timers.shift()!.run(); await tick();
  expect(timers).toEqual([]); expect(state.releases).toBe(1);
  await worker.close();
});

it("after a drained claim is released a later kick takes a fresh claim", async () => {
  const { worker, state } = fixture({ pending: false }); state.active = false;
  await worker.kick(); await tick();
  expect(state).toMatchObject({ runs: 0, acquisitions: 1, releases: 1 });
  state.active = true; await worker.kick();
  expect(state).toMatchObject({ runs: 1, acquisitions: 2 });
  await worker.close();
});
