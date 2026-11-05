import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSettlementWorker } from '../settlement-worker.js';
function createCommerceWorker(required: Parameters<typeof createSettlementWorker>[0] & { directory: string }, optional: { acquire?: () => () => void; schedule?: Parameters<typeof createSettlementWorker>[1]['schedule']; withOwnership?: Parameters<typeof createSettlementWorker>[1]['withOwnership'] } = {}) {
  return createSettlementWorker(required, { withOwnership: optional.withOwnership ?? (async run => { const release = optional.acquire!(); try { await run(); return { acquired: true }; } finally { release(); } }), schedule: optional.schedule ?? (() => () => {}) });
}

function fixture({ owner = true, active = true, pending = false } = {}) {
  const timers: (() => void)[] = [];
  const warnings: string[] = [];
  const state = { active, pending, runs: 0, acquisitions: 0, releases: 0 };
  const worker = createCommerceWorker({ owner, directory: 'unused', active: async () => state.active,
    hasPending: async () => state.pending, run: async () => { state.runs++; }, warn: message => warnings.push(message) }, {
    acquire: () => { state.acquisitions++; return () => { state.releases++; }; },
    schedule: run => { timers.push(run); return () => { const index = timers.indexOf(run); if (index >= 0) timers.splice(index, 1); }; },
  });
  return { worker, timers, warnings, state };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('commerce-off with no durable work schedules nothing and releases ownership', async () => {
  const { worker, timers, state } = fixture({ active: false });
  await worker.kick(); await tick();
  assert.equal(state.runs, 0); assert.equal(timers.length, 0); assert.equal(state.releases, 1);
  await worker.close();
});

test('daemon/client compositions never acquire ownership or poll', async () => {
  const { worker, timers, state } = fixture({ owner: false });
  await worker.kick(); assert.equal(state.acquisitions, 0); assert.equal(timers.length, 0);
  await worker.close();
});

test('one owner serializes repeated kicks and drains previously recorded work after disable/restart', async () => {
  const { worker, timers, state } = fixture({ active: false, pending: true });
  await Promise.all([worker.kick(), worker.kick(), worker.kick()]);
  assert.equal(state.runs, 1); assert.equal(state.acquisitions, 1); assert.equal(timers.length, 1);
  timers.shift()!(); await tick(); assert.equal(state.runs, 2); assert.equal(timers.length, 1);
  state.pending = false; timers.shift()!(); await tick();
  assert.equal(state.runs, 2); assert.equal(timers.length, 0); assert.equal(state.releases, 1);
  await worker.close();
});

test('close waits for an in-flight durable projection and then releases ownership', async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const done = new Promise<void>(resolve => { release = resolve; });
  let released = false, closed = false;
  const worker = createCommerceWorker({ owner: true, directory: 'unused', active: async () => true,
    hasPending: async () => true, run: async () => { entered(); await done; }, warn: () => {} }, {
    acquire: () => () => { released = true; }, schedule: () => () => {},
  });
  const kick = worker.kick(); await started;
  const closing = worker.close().then(() => { closed = true; }); await tick();
  assert.equal(closed, false); assert.equal(released, false);
  release(); await Promise.all([kick, closing]); assert.equal(released, true);
});

test('a competing PostgreSQL owner runs no settlement and can be retried later', async () => {
  let acquired = false, runs = 0;
  const worker = createCommerceWorker({ owner: true, directory: 'unused', active: async () => true,
    hasPending: async () => true, run: async () => { runs++; }, warn: () => {} }, {
    withOwnership: async run => { if (!acquired) return { acquired: false }; await run(); return { acquired: true }; }, schedule: () => () => {},
  });
  await worker.kick(); assert.equal(runs, 0);
  acquired = true; await worker.kick(); assert.equal(runs, 1); await worker.close();
});

test('close before asynchronous ownership acquisition prevents a late payment cycle', async () => {
  let release!: () => void, runs = 0;
  const acquired = new Promise<void>(resolve => { release = resolve; });
  const worker = createCommerceWorker({ owner: true, directory: 'unused', active: async () => true,
    hasPending: async () => true, run: async () => { runs++; }, warn: () => {} }, {
    withOwnership: async run => { await acquired; await run(); return { acquired: true }; }, schedule: () => () => {},
  });
  const kick = worker.kick(); const close = worker.close(); release(); await Promise.all([kick, close]);
  assert.equal(runs, 0);
});

test('lost PostgreSQL session ownership stops future cycles and releases the worker', async () => {
  let valid = true, runs = 0, released = false;
  const timers: (() => void)[] = [], warnings: string[] = [];
  const worker = createCommerceWorker({ owner: true, directory: 'unused', active: async () => true,
    hasPending: async () => true, run: async () => { runs++; }, warn: message => warnings.push(message) }, {
    withOwnership: async run => { try { await run({ assertOwned: async () => { if (!valid) throw new Error('connection lost'); } }); return { acquired: true }; } finally { released = true; } },
    schedule: run => { timers.push(run); return () => {}; },
  });
  await worker.kick(); assert.equal(runs, 1);
  valid = false; timers.shift()!(); await tick();
  assert.equal(runs, 1); assert.equal(timers.length, 1); assert.equal(released, true);
  assert.equal(warnings.length, 1); await worker.close();
});

test('standby retries ownership and takes over after the former owner exits without another HTTP request', async () => {
  let available = false, runs = 0;
  const timers: (() => void)[] = [];
  const worker = createCommerceWorker({ owner: true, directory: 'unused', active: async () => true,
    hasPending: async () => true, run: async () => { runs++; }, warn: () => {} }, {
    withOwnership: async run => { if (!available) return { acquired: false }; await run(); return { acquired: true }; },
    schedule: run => { timers.push(run); return () => { const i = timers.indexOf(run); if (i >= 0) timers.splice(i, 1); }; },
  });
  await worker.kick(); await tick(); assert.equal(runs, 0); assert.equal(timers.length, 1);
  available = true; timers.shift()!(); await tick(); assert.equal(runs, 1); assert.equal(timers.length, 1);
  await worker.close(); assert.equal(timers.length, 0);
});

test('unreadable activation cannot strand previously recorded payment work', async () => {
  let runs = 0;
  const worker = createCommerceWorker({ owner: true, directory: 'unused', active: async () => { throw new Error('unreadable activation'); },
    hasPending: async () => true, run: async () => { runs++; }, warn: () => {} }, {
    acquire: () => () => {}, schedule: () => () => {},
  });
  await worker.kick(); assert.equal(runs, 1); await worker.close();
});
