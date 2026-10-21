import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";
import { createRespawnPolicy } from "../respawn-policy.js";
import { createDaemonSupervisor } from "../supervisor.js";
import type { SpawnedDaemonProcess, SupervisorEvent } from "../supervisor.js";

// Generalized from the original supervisor tests: in-memory readiness and deterministic timers.
function harness({ maxFailures = 5, quiet = false, terminate, launchFailures = [], cooldownMs = 30 }: {
  maxFailures?: number; quiet?: boolean; cooldownMs?: number;
  terminate?: (input: { child: SpawnedDaemonProcess }) => void | Promise<void>;
  /** Values the next launches throw, in order, before launches start succeeding. */
  launchFailures?: unknown[];
} = {}) {
  let time = 0;
  let failure: string | undefined;
  const events: SupervisorEvent[] = [];
  const tasks = new Set<() => void>();
  const children: { child: SpawnedDaemonProcess; emitter: EventEmitter; killed: boolean }[] = [];
  const supervisor = createDaemonSupervisor({
    now: () => time,
    policy: createRespawnPolicy({ now: () => time }, { backoffScheduleMs: [5], crashLoopMaxFailures: maxFailures }),
    scheduler: { schedule: ({ run }) => { tasks.add(run); return () => { tasks.delete(run); }; } },
    spawnDaemonProcess: () => {
      if (launchFailures.length > 0) throw launchFailures.shift();
      const emitter = new EventEmitter();
      const item = { emitter, killed: false, child: undefined as unknown as SpawnedDaemonProcess };
      item.child = { on: (input) => {
        if (input.event === "exit") emitter.on("exit", (code, signal) => input.listener({ code, signal }));
        else emitter.on("error", (error) => input.listener({ error }));
      }, kill: () => { item.killed = true; return true; } };
      children.push(item);
      return item.child;
    },
    terminateProcess: terminate ?? (({ child }) => { child.kill({}, { signal: "SIGTERM" }); }),
    classifyExit: ({ code, signal }) => ({ isPortConflict: code === 9, reason: `exit ${code}/${signal ?? "none"}` }),
    failureReporter: { clear: () => { failure = undefined; }, record: ({ reason }) => { failure = reason; } },
    logger: { emit: (event) => { events.push(event); } },
  }, { onDemandCooldownMs: cooldownMs, quietRoutineLifecycle: quiet });
  return { supervisor, children, tasks, events, advance: (ms: number) => { time += ms; }, failure: () => failure,
    retry: () => { for (const run of [...tasks]) { tasks.delete(run); run(); } } };
}

test("unexpected exits retry, deliberate shutdown cancels retries and refuses rearming", () => {
  const h = harness();
  h.supervisor.start();
  h.children[0]!.emitter.emit("exit", 1, null);
  assert.equal(h.tasks.size, 1);
  h.retry();
  assert.equal(h.children.length, 2);
  assert.equal(h.failure(), undefined);
  h.supervisor.shutdown();
  assert.equal(h.children[1]!.killed, true);
  h.children[1]!.emitter.emit("exit", 0, "SIGTERM");
  h.retry();
  assert.equal(h.children.length, 2);
  assert.deepEqual(h.supervisor.restart(), { ok: false, reason: "shutting down" });
  assert.deepEqual(h.supervisor.ensureStarted(), { ok: false, reason: "shutting down" });
});

test("crash-loop and port-conflict caps report distinct reasons; manual restart rearms", () => {
  const h = harness({ maxFailures: 2 });
  h.supervisor.start();
  h.children[0]!.emitter.emit("exit", 1, null); h.retry();
  h.children[1]!.emitter.emit("exit", 1, null);
  assert.equal(h.tasks.size, 0);
  assert.equal(h.failure(), "gave up after 2 attempts in 60s: exit 1/none");
  assert.deepEqual(h.supervisor.restart(), { ok: true });
  assert.equal(h.children.length, 3);
  const p = harness({ maxFailures: 10 }); p.supervisor.start();
  for (let i = 0; i < 3; i++) { p.children[i]!.emitter.emit("exit", 9, null); p.retry(); }
  assert.equal(p.failure(), "gave up after 3 consecutive port conflicts: exit 9/none");
});

test("restart waits for actual exit and concurrent restarts spawn only one replacement", () => {
  const h = harness(); h.supervisor.start();
  h.supervisor.restart(); h.supervisor.restart();
  assert.equal(h.children.length, 1);
  assert.equal(h.children[0]!.killed, true);
  h.children[0]!.emitter.emit("exit", 0, "SIGTERM");
  assert.equal(h.children.length, 2);
  assert.equal(h.tasks.size, 0);
});

test("shutdown while a restart waits for exit never resurrects the child", () => {
  const h = harness(); h.supervisor.start(); h.supervisor.restart(); h.supervisor.shutdown();
  h.children[0]!.emitter.emit("exit", 0, "SIGTERM"); h.retry(); h.supervisor.start();
  assert.equal(h.children.length, 1);
});

test("spawn-level errors do not retry automatically; on-demand recovery obeys cooldown", () => {
  const h = harness(); h.supervisor.start();
  h.children[0]!.emitter.emit("error", new Error("missing command"));
  assert.equal(h.failure(), "failed to start daemon: missing command");
  assert.equal(h.tasks.size, 0);
  assert.deepEqual(h.supervisor.ensureStarted(), { ok: true });
  assert.equal(h.children.length, 2);
  h.children[1]!.emitter.emit("error", new Error("still missing"));
  assert.deepEqual(h.supervisor.ensureStarted(), { ok: false, reason: "cooling down before trying again" });
  h.advance(30);
  assert.deepEqual(h.supervisor.ensureStarted(), { ok: true });
  assert.equal(h.children.length, 3);
});

test("on-demand start is single-flight and never accelerates a scheduled retry", () => {
  const h = harness(); h.supervisor.start(); h.supervisor.start(); h.supervisor.ensureStarted();
  assert.equal(h.children.length, 1);
  h.children[0]!.emitter.emit("exit", 1, null);
  h.supervisor.ensureStarted();
  assert.equal(h.children.length, 1); assert.equal(h.tasks.size, 1);
});

test("quiet mode hides routine events and keeps failures and respawns", () => {
  const h = harness({ quiet: true }); h.supervisor.start();
  // Check emptiness without narrowing the array to never[]; later lifecycle callbacks append events.
  assert.equal(h.events.length, 0);
  h.children[0]!.emitter.emit("exit", 1, null); h.retry();
  assert.deepEqual(h.events.map((e) => e.type), ["exit", "failure", "spawn"]);
  h.supervisor.shutdown(); h.children[1]!.emitter.emit("exit", 0, "SIGTERM");
  assert.deepEqual(h.events.map((e) => e.type), ["exit", "failure", "spawn"]);
});

test("late events from an old process cannot fail its replacement", () => {
  const h = harness(); h.supervisor.start(); h.supervisor.restart();
  h.children[0]!.emitter.emit("exit", 0, "SIGTERM");
  h.children[0]!.emitter.emit("error", new Error("stale"));
  h.children[0]!.emitter.emit("exit", 1, null);
  assert.equal(h.children.length, 2); assert.equal(h.tasks.size, 0); assert.equal(h.failure(), undefined);
});

test("replacement waits for descendant teardown even when the immediate child exits first", async () => {
  let complete!: () => void;
  const h = harness({ terminate: () => new Promise<void>((resolve) => { complete = resolve; }) });
  h.supervisor.start(); h.supervisor.restart();
  h.children[0]!.emitter.emit("exit", 0, "SIGTERM");
  h.supervisor.ensureStarted(); h.supervisor.restart();
  assert.equal(h.children.length, 1);
  complete(); await Promise.resolve();
  assert.equal(h.children.length, 2);
});

test("shutdown cancels a replacement waiting for async tree teardown", async () => {
  let complete!: () => void;
  const h = harness({ terminate: () => new Promise<void>((resolve) => { complete = resolve; }) });
  h.supervisor.start(); h.supervisor.restart();
  h.children[0]!.emitter.emit("exit", 0, "SIGTERM"); h.supervisor.shutdown();
  complete(); await Promise.resolve();
  assert.equal(h.children.length, 1);
});

test("a launch that throws is reported with its message, publishes no child and is retried only on demand", () => {
  const h = harness({ launchFailures: [new Error("spawn EACCES"), "launcher unavailable"] });
  h.supervisor.start();
  assert.equal(h.failure(), "failed to start daemon: spawn EACCES");
  assert.equal(h.children.length, 0);
  assert.equal(h.tasks.size, 0, "a broken launch is not put on the crash backoff");
  assert.deepEqual(h.supervisor.ensureStarted(), { ok: true });
  assert.equal(h.failure(), "failed to start daemon: launcher unavailable", "a non-Error throw is reported by its text");
  h.advance(30);
  assert.deepEqual(h.supervisor.ensureStarted(), { ok: true });
  assert.equal(h.children.length, 1);
  assert.equal(h.failure(), undefined);
});

test("a stop that throws or rejects is reported and leaves the old child in place instead of replacing it", async () => {
  const sync = harness({ terminate: () => { throw new Error("EPERM"); } });
  sync.supervisor.start(); sync.supervisor.restart();
  assert.equal(sync.failure(), "failed to stop daemon: Error: EPERM");
  sync.children[0]!.emitter.emit("exit", 0, "SIGTERM");
  assert.equal(sync.children.length, 1, "a failed stop cancels the pending replacement");

  let rejectStop!: (error: unknown) => void;
  const async = harness({ terminate: () => new Promise<void>((_resolve, reject) => { rejectStop = reject; }) });
  async.supervisor.start(); async.supervisor.restart();
  rejectStop("tree still running");
  await Promise.resolve();
  assert.equal(async.failure(), "failed to stop daemon: tree still running");
});

test("shutdown before start and a repeated shutdown are both no-ops beyond the latch", () => {
  const h = harness();
  h.supervisor.shutdown();
  h.supervisor.shutdown();
  h.supervisor.start();
  assert.equal(h.children.length, 0);
  assert.deepEqual(h.supervisor.restart(), { ok: false, reason: "shutting down" });
});

test("the on-demand cooldown must be finite and non-negative", () => {
  for (const onDemandCooldownMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => harness({ cooldownMs: onDemandCooldownMs }), { name: "RangeError", message: "onDemandCooldownMs must be finite and non-negative" });
  }
});

test("restart or shutdown while a crash retry is scheduled cancels that retry", () => {
  const r = harness(); r.supervisor.start();
  r.children[0]!.emitter.emit("exit", 1, null);
  assert.equal(r.tasks.size, 1);
  assert.deepEqual(r.supervisor.restart(), { ok: true });
  assert.equal(r.tasks.size, 0, "the backoff task is withdrawn");
  assert.equal(r.children.length, 2, "restart replaces the exited child immediately");

  const s = harness(); s.supervisor.start();
  s.children[0]!.emitter.emit("exit", 1, null);
  s.supervisor.shutdown();
  assert.equal(s.tasks.size, 0);
  assert.equal(s.children.length, 1);
});
