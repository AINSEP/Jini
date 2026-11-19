/** Behavioral contract for P1 in e2e-0112-packaged/fix-spec-and-decision.md.
 * Fake timer and capture ports exercise the policy without Electron, servers or real waits. */
import { test } from "vitest";
import assert from "node:assert/strict";
import { createPreviewScheduler } from "../index.js";

const KEY = "preview-key";
function harness() {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map<number, { work: () => void; at: number }>();
  const targets = new Map<string, { revision: number; label: string }>([[KEY, { revision: 8123, label: "initial" }]]);
  const captures: Array<{ revision: number; label: string }> = [];
  let capture: (input: { revision: number; label: string }) => Promise<boolean> = async (_input) => true;
  const scheduler = createPreviewScheduler<number, { revision: number; label: string }>({ ports: {
    current: ({ key }) => targets.get(key),
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

test("P1: debounce reserves once and resolves the current revision/label when it fires", async () => {
  const h = harness();
  h.scheduler.schedule({ key: KEY }, {});
  h.scheduler.schedule({ key: KEY }, {});
  assert.equal(h.timers.size, 1);
  await h.tick(1499);
  assert.deepEqual(h.captures, []);
  h.targets.set(KEY, { revision: 9000, label: "current" });
  await h.tick(1);
  assert.deepEqual(h.captures, [{ revision: 9000, label: "current" }]);
  h.scheduler.schedule({ key: KEY }, {});
  assert.equal(h.timers.size, 1, "a later public visit permits refresh");
});

test("P1: a site no longer running when the timer fires is skipped and can be started later", async () => {
  const h = harness();
  h.scheduler.schedule({ key: KEY }, {});
  h.targets.delete(KEY);
  await h.tick(1500);
  assert.equal(h.captures.length, 0);
  h.targets.set(KEY, { revision: 9001, label: "initial" });
  h.scheduler.schedule({ key: KEY }, {});
  await h.tick(1500);
  assert.equal(h.captures[0]?.revision, 9001);
});

test("P1: stop cancels the pending debounce without a hidden navigation", async () => {
  const h = harness();
  h.scheduler.schedule({ key: KEY }, {});
  h.scheduler.cancel({ key: KEY }, {});
  h.targets.delete(KEY);
  assert.equal(h.timers.size, 0);
  await h.tick(20_000);
  assert.deepEqual(h.captures, []);
});

test("P1: restart within the debounce cancels the old work and captures only the new port", async () => {
  const h = harness();
  h.scheduler.schedule({ key: KEY }, {});
  await h.tick(1000);
  h.scheduler.cancel({ key: KEY }, {});
  h.targets.set(KEY, { revision: 9002, label: "initial" });
  h.scheduler.schedule({ key: KEY }, {});
  await h.tick(500);
  assert.equal(h.captures.length, 0);
  await h.tick(1000);
  assert.deepEqual(h.captures.map((capture) => capture.revision), [9002]);
});

test("P1: restart after a successful capture re-arms the lifecycle reservation", async () => {
  const h = harness();
  h.scheduler.schedule({ key: KEY }, {});
  await h.tick(1500);
  h.scheduler.cancel({ key: KEY }, {});
  h.targets.set(KEY, { revision: 9003, label: "initial" });
  h.scheduler.schedule({ key: KEY }, {});
  await h.tick(1500);
  assert.deepEqual(h.captures.map((capture) => capture.revision), [8123, 9003]);
});

test("P1: false and rejected capture results both permit a later successful capture", async () => {
  for (const failure of [async () => false, async () => { throw new Error("load failed"); }]) {
    const h = harness();
    h.setCapture(failure);
    h.scheduler.schedule({ key: KEY }, {});
    await h.tick(1500);
    h.setCapture(async () => true);
    h.scheduler.schedule({ key: KEY }, {});
    await h.tick(1500);
    assert.equal(h.captures.length, 2);
    h.scheduler.schedule({ key: KEY }, {});
    assert.equal(h.timers.size, 1);
  }
});

test("P1: an old in-flight failure cannot erase the replacement lifecycle's reservation", async () => {
  const h = harness();
  let finishOld!: (result: boolean) => void;
  h.setCapture(() => new Promise<boolean>((resolve) => { finishOld = resolve; }));
  h.scheduler.schedule({ key: KEY }, {});
  await h.tick(1500);
  h.scheduler.cancel({ key: KEY }, {});
  h.targets.set(KEY, { revision: 9004, label: "initial" });
  h.setCapture(async () => true);
  h.scheduler.schedule({ key: KEY }, {});
  finishOld(false);
  await h.tick(0);
  h.scheduler.schedule({ key: KEY }, {});
  assert.equal(h.timers.size, 1);
  await h.tick(1500);
  assert.deepEqual(h.captures.map((capture) => capture.revision), [8123, 9004]);
});

test("P1: a timer callback that was already dispatched when Stop cancelled it captures nothing", async () => {
  const h = harness();
  h.scheduler.schedule({ key: KEY }, {});
  // Grab the queued work before cancel removes it, as a host timer that already fired would still run it.
  const [dispatched] = [...h.timers.values()];
  h.scheduler.cancel({ key: KEY }, {});
  dispatched!.work();
  await h.tick(0);
  assert.deepEqual(h.captures, [], "the cancelled lifecycle's late callback owns no work");
  h.scheduler.schedule({ key: KEY }, {});
  assert.equal(h.timers.size, 1, "and it left no reservation blocking the next Start");
});

test('release cancels stale capture and the next public visit permits refresh', async () => {
  let work!: () => void;
  let valid!: () => boolean;
  let finish!: (captured: boolean) => void;
  const scheduler = createPreviewScheduler({ ports: {
    current: () => ({ revision: 8123, label: 'initial' }),
    capture: (_input, options) => { valid = options.isCurrent!; return new Promise<boolean>(resolve => { finish = resolve; }); },
    schedule: ({ work: next }) => { work = next; return 1; }, cancel: () => {},
  } });
  scheduler.schedule({ key: KEY });
  work();
  assert.equal(valid(), true);
  scheduler.cancel({ key: KEY });
  assert.equal(valid(), false);
  scheduler.schedule({ key: KEY });
  finish(true);
  await Promise.resolve();
  work();
  assert.equal(valid(), true);
  finish(true);
  await Promise.resolve();
});
