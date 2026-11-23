import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  RETENTION_DEFAULT_INTERVAL_MS,
  createRetentionRunner,
  type RetentionPassResult,
  type RetentionPolicy,
  type RetentionScheduler,
} from '../runner.js';

/** A promise the test settles by hand, so a pass can be held "in flight" while others arrive. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
}

/** Lets every already-queued microtask (and the runner's own `.then` chain) run. */
const settle = () => new Promise(resolve => setImmediate(resolve));

interface Recorder { readonly events: string[] }

function policy(
  id: string,
  recorder: Recorder,
  overrides: Partial<Pick<RetentionPolicy, 'measure' | 'sweep' | 'kind'>> = {},
): RetentionPolicy {
  return {
    id,
    kind: overrides.kind ?? 'cache',
    measure: overrides.measure ?? (async () => { recorder.events.push(`${id}:measure`); return { bytes: 10, items: 1 }; }),
    sweep: overrides.sweep ?? (async () => { recorder.events.push(`${id}:sweep`); return { freedBytes: 10, removed: 1 }; }),
  };
}

function fakeScheduler() {
  const timers: Array<{ callback: () => void; ms: number; cleared: boolean }> = [];
  const scheduler: RetentionScheduler = {
    setInterval: (callback, ms) => { const timer = { callback, ms, cleared: false }; timers.push(timer); return timer; },
    clearInterval: handle => { (handle as { cleared: boolean }).cleared = true; },
  };
  return { scheduler, timers };
}

function makeRunner(policies: RetentionPolicy[], optional: Parameters<typeof createRetentionRunner>[1] = {}) {
  const errors: Array<{ message: string; policyId: string | undefined }> = [];
  const { scheduler, timers } = fakeScheduler();
  let tick = 1_000;
  const runner = createRetentionRunner({
    policies,
    clock: { now: () => tick++ },
    scheduler,
    reportError: (error, { policyId }) => { errors.push({ message: error.message, policyId }); },
  }, optional);
  return { runner, errors, timers };
}

const statuses = (result: RetentionPassResult) =>
  result.status === 'completed' ? result.policies.map(outcome => `${outcome.id}:${outcome.status}`) : [result.status];

test('dryRun never calls sweep', async () => {
  const recorder: Recorder = { events: [] };
  const { runner, errors } = makeRunner([
    policy('cache', recorder, { sweep: async () => { throw new Error('sweep must not run in a dry run'); } }),
  ]);
  const result = await runner.runOnce({ dryRun: true });
  assert.equal(result.status, 'completed');
  assert.deepEqual(statuses(result), ['cache:measured']);
  assert.deepEqual(recorder.events, ['cache:measure']);
  assert.deepEqual(errors, []);
  assert.ok(result.status === 'completed' && result.policies[0]!.status === 'measured' && result.policies[0]!.measurement.bytes === 10);
});

test('a live pass sweeps each policy with the injected clock', async () => {
  const seen: number[] = [];
  const recorder: Recorder = { events: [] };
  const { runner } = makeRunner([policy('a', recorder, { sweep: async ({ now }) => { seen.push(now); return { freedBytes: null, removed: 0 }; } })]);
  const result = await runner.runOnce({ dryRun: false });
  assert.deepEqual(statuses(result), ['a:swept']);
  assert.equal(seen.length, 1);
  assert.ok(result.status === 'completed' && result.startedAt === seen[0] && result.dryRun === false);
});

test('one failing policy does not stop the next', async () => {
  const recorder: Recorder = { events: [] };
  const { runner, errors } = makeRunner([
    policy('broken', recorder, { sweep: async () => { throw new Error('disk said no'); } }),
    policy('next', recorder),
  ]);
  const result = await runner.runOnce({ dryRun: false });
  assert.deepEqual(statuses(result), ['broken:failed', 'next:swept']);
  assert.deepEqual(recorder.events, ['next:sweep']);
  assert.deepEqual(errors, [{ message: 'Storage cleanup "broken" failed while cleaning up (Error).', policyId: 'broken' }]);
  assert.ok(result.status === 'completed' && result.policies[0]!.status === 'failed'
    && result.policies[0]!.message === errors[0]!.message);
});

test('a failing measurement is reported in plain words and the pass still completes', async () => {
  const recorder: Recorder = { events: [] };
  const { runner, errors } = makeRunner([
    policy('m', recorder, { measure: async () => { throw 'not an Error'; } }),
    policy('n', recorder),
  ]);
  const result = await runner.runOnce({ dryRun: true });
  assert.deepEqual(statuses(result), ['m:failed', 'n:measured']);
  assert.equal(errors[0]!.message, 'Storage cleanup "m" failed while measuring (string).');
});

test('a throwing reportError cannot break the pass', async () => {
  const recorder: Recorder = { events: [] };
  const { scheduler } = fakeScheduler();
  const runner = createRetentionRunner({
    policies: [policy('bad', recorder, { sweep: async () => { throw new Error('x'); } }), policy('ok', recorder)],
    clock: { now: () => 1 },
    scheduler,
    reportError: () => { throw new Error('reporter is down'); },
  });
  assert.deepEqual(statuses(await runner.runOnce({ dryRun: false })), ['bad:failed', 'ok:swept']);
});

test('boot, timer and manual passes share one in-flight pass', async () => {
  const gate = deferred();
  const recorder: Recorder = { events: [] };
  let sweeps = 0;
  const { runner, timers } = makeRunner([
    policy('slow', recorder, { sweep: async () => { sweeps++; await gate.promise; return { freedBytes: 1, removed: 1 }; } }),
  ], { scheduledDryRun: false });
  runner.start(); // boot pass, live because the host opted in
  timers[0]!.callback(); // timer fires while the boot pass is still running
  const manual = runner.runOnce({ dryRun: false });
  await settle();
  assert.equal(sweeps, 1);
  gate.resolve();
  const result = await manual;
  assert.deepEqual(statuses(result), ['slow:swept']);
  assert.equal(sweeps, 1);
  await runner.stop();
});

test('a dry run that arrives during a live pass gets a measurement-only result', async () => {
  const gate = deferred();
  const recorder: Recorder = { events: [] };
  const { runner } = makeRunner([
    policy('p', recorder, { sweep: async () => { recorder.events.push('p:sweep-start'); await gate.promise; recorder.events.push('p:sweep-end'); return { freedBytes: 5, removed: 1 }; } }),
  ]);
  const live = runner.runOnce({ dryRun: false });
  await settle();
  const dry = runner.runOnce({ dryRun: true });
  await settle();
  // Serialized: the measurement waits for the sweep instead of reading a half-cleaned folder.
  assert.deepEqual(recorder.events, ['p:sweep-start']);
  gate.resolve();
  const [liveResult, dryResult] = await Promise.all([live, dry]);
  assert.deepEqual(statuses(liveResult), ['p:swept']);
  assert.deepEqual(statuses(dryResult), ['p:measured']);
  assert.ok(dryResult.status === 'completed' && dryResult.dryRun === true);
  assert.deepEqual(recorder.events, ['p:sweep-start', 'p:sweep-end', 'p:measure']);
});

test('a confirmed cleanup that arrives during a dry run gets an actual sweep', async () => {
  const gate = deferred();
  const recorder: Recorder = { events: [] };
  const { runner } = makeRunner([
    policy('p', recorder, { measure: async () => { recorder.events.push('p:measure-start'); await gate.promise; return { bytes: 1 }; } }),
  ]);
  const dry = runner.runOnce({ dryRun: true });
  await settle();
  const live = runner.runOnce({ dryRun: false });
  const secondDry = runner.runOnce({ dryRun: true });
  const secondLive = runner.runOnce({ dryRun: false });
  await settle();
  assert.deepEqual(recorder.events, ['p:measure-start']);
  gate.resolve();
  const [dryResult, liveResult, secondDryResult, secondLiveResult] = await Promise.all([dry, live, secondDry, secondLive]);
  assert.deepEqual(statuses(dryResult), ['p:measured']);
  assert.deepEqual(statuses(liveResult), ['p:swept']);
  assert.equal(secondDryResult, dryResult, 'a second dry run joins the running dry run');
  assert.equal(secondLiveResult, liveResult, 'a second cleanup joins the queued cleanup');
  assert.deepEqual(recorder.events, ['p:measure-start', 'p:sweep']);
});

test('stop during a queued pass cancels it and still drains the running one', async () => {
  const gate = deferred();
  const recorder: Recorder = { events: [] };
  const { runner } = makeRunner([
    policy('p', recorder, { sweep: async () => { await gate.promise; recorder.events.push('p:sweep-end'); return { freedBytes: 0, removed: 0 }; } }),
  ]);
  const live = runner.runOnce({ dryRun: false });
  await settle();
  const queued = runner.runOnce({ dryRun: true });
  let stopped = false;
  const stopping = runner.stop().then(() => { stopped = true; });
  assert.deepEqual(await queued, { status: 'stopped', dryRun: true });
  await settle();
  assert.equal(stopped, false, 'stop waits for the pass in flight');
  gate.resolve();
  await stopping;
  assert.deepEqual(statuses(await live), ['p:swept']);
  assert.deepEqual(recorder.events, ['p:sweep-end'], 'the cancelled measurement never ran');
});

test('stop awaits the pass in flight', async () => {
  const gate = deferred();
  const recorder: Recorder = { events: [] };
  const { runner } = makeRunner([
    policy('p', recorder, { measure: async () => { await gate.promise; recorder.events.push('p:measured'); return { bytes: 0 }; } }),
  ]);
  void runner.runOnce({ dryRun: true });
  await settle();
  let done = false;
  const stopping = runner.stop().then(() => { done = true; });
  await settle();
  assert.equal(done, false);
  gate.resolve();
  await stopping;
  assert.deepEqual(recorder.events, ['p:measured']);
});

test('after stop no pass starts, the timer is cleared, and start refuses in plain words', async () => {
  const recorder: Recorder = { events: [] };
  const { runner, timers } = makeRunner([policy('p', recorder)]);
  runner.start();
  runner.start(); // idempotent: one timer, one boot pass
  assert.equal(timers.length, 1);
  await runner.stop();
  await runner.stop(); // safe twice
  assert.equal(timers[0]!.cleared, true);
  const before = recorder.events.length;
  assert.deepEqual(await runner.runOnce({ dryRun: false }), { status: 'stopped', dryRun: false });
  timers[0]!.callback();
  await settle();
  assert.equal(recorder.events.length, before);
  assert.throws(() => runner.start(), /This storage cleanup runner was stopped/);
});

test('scheduled passes are measure-only unless the host opts in, at the default daily interval', async () => {
  const recorder: Recorder = { events: [] };
  const { runner, timers } = makeRunner([policy('p', recorder)]);
  runner.start();
  assert.equal(timers[0]!.ms, RETENTION_DEFAULT_INTERVAL_MS);
  assert.equal(RETENTION_DEFAULT_INTERVAL_MS, 24 * 60 * 60 * 1000);
  await settle();
  timers[0]!.callback();
  await settle();
  await runner.stop();
  assert.deepEqual(recorder.events, ['p:measure', 'p:measure']);
});

test('onReport receives every finished pass and its own failure is reported, not thrown', async () => {
  const recorder: Recorder = { events: [] };
  const reports: RetentionPassResult[] = [];
  const { runner, errors } = makeRunner([policy('p', recorder)], {
    onReport: report => { reports.push(report); throw new Error('report sink full'); },
    intervalMs: 5,
  });
  const result = await runner.runOnce({ dryRun: true });
  assert.deepEqual(reports, [result]);
  assert.deepEqual(errors, [{ message: 'Storage cleanup report could not be delivered (Error).', policyId: undefined }]);
});

test('kinds outside cache, derived and old-copy are refused at creation', () => {
  const recorder: Recorder = { events: [] };
  const content = { ...policy('posts', recorder), kind: 'content' } as unknown as RetentionPolicy;
  assert.throws(() => makeRunner([content]), {
    name: 'TypeError',
    message: 'Storage policy "posts" has kind "content". Only cache, derived and old-copy data may be cleaned automatically.',
  });
});

test('duplicate policy ids and a bad interval are refused at creation', () => {
  const recorder: Recorder = { events: [] };
  assert.throws(() => makeRunner([policy('a', recorder), policy('a', recorder)]), { name: 'TypeError', message: 'Storage policy "a" is listed twice.' });
  for (const intervalMs of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.throws(() => makeRunner([], { intervalMs }), { name: 'RangeError', message: /interval must be a positive number of milliseconds/ });
  }
});

test('type test: kind "content" does not compile', () => {
  const recorder: Recorder = { events: [] };
  const base = policy('x', recorder);
  // @ts-expect-error -- owner content is never an automatic retention kind; `tsc` pins this line.
  const content: RetentionPolicy = { ...base, kind: 'content' };
  // @ts-expect-error -- chats are content now; the v1 "history" kind must not come back.
  const history: RetentionPolicy = { ...base, kind: 'history' };
  assert.equal(content.kind, 'content');
  assert.equal(history.kind, 'history');
});

test('a collaborator that synchronously requests another pass cannot start an overlapping one', async () => {
  const recorder: Recorder = { events: [] };
  let active = 0;
  let maxActive = 0;
  let reentered: Promise<RetentionPassResult> | undefined;
  const holder: { runner?: ReturnType<typeof makeRunner>['runner'] } = {};
  const enter = () => { active++; maxActive = Math.max(maxActive, active); };
  const { runner } = makeRunner([
    policy('p', recorder, {
      measure: async () => {
        enter();
        // Synchronous re-entry, before the first await: the runner must already show this pass in flight.
        reentered ??= holder.runner!.runOnce({ dryRun: false });
        recorder.events.push('p:measure');
        await settle();
        active--;
        return { bytes: 1 };
      },
      sweep: async () => { enter(); recorder.events.push('p:sweep'); active--; return { freedBytes: 0, removed: 0 }; },
    }),
  ]);
  holder.runner = runner;
  const dry = await runner.runOnce({ dryRun: true });
  assert.deepEqual(statuses(dry), ['p:measured']);
  assert.deepEqual(statuses(await reentered!), ['p:swept']);
  assert.equal(maxActive, 1);
  assert.deepEqual(recorder.events, ['p:measure', 'p:sweep']);
});

test('a throwing clock fails that pass, and the queue still advances and recovers', async () => {
  const recorder: Recorder = { events: [] };
  const { scheduler } = fakeScheduler();
  let calls = 0;
  const runner = createRetentionRunner({
    policies: [policy('p', recorder)],
    clock: { now: () => { calls++; if (calls === 1) throw new Error('clock is broken /secret/path'); return calls; } },
    scheduler,
    reportError: () => {},
  });
  const live = runner.runOnce({ dryRun: false });
  const waitingDry = runner.runOnce({ dryRun: true });
  await assert.rejects(live, /clock is broken/);
  assert.deepEqual(statuses(await waitingDry), ['p:measured'], 'the opposite-mode waiter runs after the failed pass');
  assert.deepEqual(statuses(await runner.runOnce({ dryRun: false })), ['p:swept'], 'a later pass starts normally');
  await runner.stop();
});

test('a scheduled pass that fails is reported through the injected reporter, never as an unhandled rejection', async () => {
  const recorder: Recorder = { events: [] };
  const { scheduler, timers } = fakeScheduler();
  const errors: Array<{ error: Error; policyId: string | undefined }> = [];
  const boom = new Error('clock is broken /secret/path');
  let throwing = true;
  const runner = createRetentionRunner({
    policies: [policy('p', recorder)],
    clock: { now: () => { if (throwing) throw boom; return 1; } },
    scheduler,
    reportError: (error, { policyId }) => { errors.push({ error, policyId }); },
  });
  runner.start();
  await settle();
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.error.message, 'A scheduled storage cleanup pass could not run.');
  assert.equal(errors[0]!.error.cause, boom);
  assert.equal(errors[0]!.policyId, undefined);
  throwing = false;
  timers[0]!.callback();
  await settle();
  assert.deepEqual(recorder.events, ['p:measure'], 'the next scheduled pass runs');
  await runner.stop();
});

test('stop resolves even when the pass in flight failed', async () => {
  const recorder: Recorder = { events: [] };
  const { scheduler } = fakeScheduler();
  const runner = createRetentionRunner({
    policies: [policy('p', recorder)],
    clock: { now: () => { throw new Error('no clock'); } },
    scheduler,
    reportError: () => {},
  });
  const live = runner.runOnce({ dryRun: false });
  const stopping = runner.stop();
  await assert.rejects(live, /no clock/);
  await stopping;
});
