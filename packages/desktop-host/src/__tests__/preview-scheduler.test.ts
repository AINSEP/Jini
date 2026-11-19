/** Fake timer and capture ports exercise the policy without servers or real waits. */
import { test } from "vitest";
import assert from "node:assert/strict";
import { createPreviewScheduler } from "../index.js";

type PreviewTarget = { value: number };

const SITE = "/scratch/site";
function harness() {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map<number, { work: () => void; at: number }>();
  const targets = new Map<string, PreviewTarget>([[SITE, { value: 8123 }]]);
  const captures: Array<PreviewTarget & { key: string }> = [];
  let capture: (input: PreviewTarget & { key: string }) => Promise<boolean> = async (_input) => true;
  const scheduler = createPreviewScheduler<number, PreviewTarget & { key: string }>({ ports: {
    current: ({ key }) => { const target = targets.get(key); return target ? { key, ...target } : undefined; },
    capture: (input) => { captures.push(input); return capture(input); },
    schedule: ({ work, delayMs }) => { const timer = ++nextTimer; timers.set(timer, { work, at: now + delayMs }); return timer; },
    cancel: ({ timer }) => { timers.delete(timer); },
  } }, {});
  return {
    scheduler, targets, captures, timers,
    setCapture(fn: typeof capture) { capture = fn; },
    async tick(ms: number) {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.work();
      }
      // Flush the injected async capture and the scheduler's completion continuation.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test("P1: debounce reserves once and resolves the current target when it fires", async () => {
  const h = harness();
  h.scheduler.schedule({ key: SITE }, {});
  h.scheduler.schedule({ key: SITE }, {});
  assert.equal(h.timers.size, 1);
  await h.tick(1499);
  assert.deepEqual(h.captures, []);
  h.targets.set(SITE, { value: 9000 });
  await h.tick(1);
  assert.deepEqual(h.captures, [{ key: SITE, value: 9000 }]);
  h.scheduler.schedule({ key: SITE }, {});
  assert.equal(h.timers.size, 1, "a later public visit permits refresh");
});

test("P1: a site no longer running when the timer fires is skipped and can be started later", async () => {
  const h = harness();
  h.scheduler.schedule({ key: SITE }, {});
  h.targets.delete(SITE);
  await h.tick(1500);
  assert.equal(h.captures.length, 0);
  h.targets.set(SITE, { value: 9001 });
  h.scheduler.schedule({ key: SITE }, {});
  await h.tick(1500);
  assert.equal(h.captures[0]?.value, 9001);
});

test("P1: stop cancels the pending debounce without a hidden navigation", async () => {
  const h = harness();
  h.scheduler.schedule({ key: SITE }, {});
  h.scheduler.cancel({ key: SITE }, {});
  h.targets.delete(SITE);
  assert.equal(h.timers.size, 0);
  await h.tick(20_000);
  assert.deepEqual(h.captures, []);
});

test("P1: restart within the debounce cancels the old work and captures only the new target", async () => {
  const h = harness();
  h.scheduler.schedule({ key: SITE }, {});
  await h.tick(1000);
  h.scheduler.cancel({ key: SITE }, {});
  h.targets.set(SITE, { value: 9002 });
  h.scheduler.schedule({ key: SITE }, {});
  await h.tick(500);
  assert.equal(h.captures.length, 0);
  await h.tick(1000);
  assert.deepEqual(h.captures.map((capture) => capture.value), [9002]);
});

test("P1: restart after a successful capture re-arms the lifecycle reservation", async () => {
  const h = harness();
  h.scheduler.schedule({ key: SITE }, {});
  await h.tick(1500);
  h.scheduler.cancel({ key: SITE }, {});
  h.targets.set(SITE, { value: 9003 });
  h.scheduler.schedule({ key: SITE }, {});
  await h.tick(1500);
  assert.deepEqual(h.captures.map((capture) => capture.value), [8123, 9003]);
});

test("P1: false and rejected capture results both permit a later successful capture", async () => {
  for (const failure of [async () => false, async () => { throw new Error("load failed"); }]) {
    const h = harness();
    h.setCapture(failure);
    h.scheduler.schedule({ key: SITE }, {});
    await h.tick(1500);
    h.setCapture(async () => true);
    h.scheduler.schedule({ key: SITE }, {});
    await h.tick(1500);
    assert.equal(h.captures.length, 2);
    h.scheduler.schedule({ key: SITE }, {});
    assert.equal(h.timers.size, 1);
  }
});

test("P1: an old in-flight failure cannot erase the replacement lifecycle's reservation", async () => {
  const h = harness();
  let finishOld!: (result: boolean) => void;
  h.setCapture(() => new Promise<boolean>((resolve) => { finishOld = resolve; }));
  h.scheduler.schedule({ key: SITE }, {});
  await h.tick(1500);
  h.scheduler.cancel({ key: SITE }, {});
  h.targets.set(SITE, { value: 9004 });
  h.setCapture(async () => true);
  h.scheduler.schedule({ key: SITE }, {});
  finishOld(false);
  await h.tick(1500);
  h.scheduler.schedule({ key: SITE }, {});
  assert.equal(h.timers.size, 1);
  assert.deepEqual(h.captures.map((capture) => capture.value), [8123, 9004]);
});

test("P1: a timer callback that was already dispatched when Stop cancelled it captures nothing", async () => {
  const h = harness();
  h.scheduler.schedule({ key: SITE }, {});
  // Grab the queued work before cancel removes it, as a host timer that already fired would still run it.
  const [dispatched] = [...h.timers.values()];
  h.scheduler.cancel({ key: SITE }, {});
  dispatched!.work();
  await h.tick(0);
  assert.deepEqual(h.captures, [], "the cancelled lifecycle's late callback owns no work");
  h.scheduler.schedule({ key: SITE }, {});
  assert.equal(h.timers.size, 1, "and it left no reservation blocking the next Start");
});

test('release cancels stale capture and the next public visit permits refresh', async () => {
  let work!: () => void;
  let valid!: () => boolean;
  let finish!: (captured: boolean) => void;
  const scheduler = createPreviewScheduler({ ports: {
    current: () => ({ key: SITE, value: 8123 }),
    capture: (_input, options) => { valid = options.isCurrent!; return new Promise<boolean>(resolve => { finish = resolve; }); },
    schedule: ({ work: next }) => { work = next; return 1; }, cancel: () => {},
  } });
  scheduler.schedule({ key: SITE });
  work();
  assert.equal(valid(), true);
  scheduler.cancel({ key: SITE });
  assert.equal(valid(), false);
  scheduler.schedule({ key: SITE });
  finish(true);
  await Promise.resolve();
  work();
  assert.equal(valid(), true);
  finish(true);
  await Promise.resolve();
});
