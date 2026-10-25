import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { createRespawnPolicy } from "../respawn-policy.js";
import { createDaemonSupervisor } from "../supervisor.js";
import type { SpawnedDaemonProcess, SupervisorEvent } from "../supervisor.js";

/**
 * One-conjunct-at-a-time tests for the respawn / termination state machine (TEST-ANTIPATTERNS AP8):
 * each case flips exactly one input (exited, stopping, terminating, deliberate, pending retry,
 * cooldown edge) and asserts the observable spawn/terminate/event outcome. Deterministic fakes only.
 */
function harness({ cooldownMs = 30, asyncTerminate = false, pidless = false }: { cooldownMs?: number; asyncTerminate?: boolean; pidless?: boolean } = {}) {
  const pid = pidless ? undefined : 100;
  let time = 0;
  const events: SupervisorEvent[] = [];
  const failures: string[] = [];
  const tasks = new Set<() => void>();
  const children: EventEmitter[] = [];
  const terminations: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  let terminateCalls = 0;
  const supervisor = createDaemonSupervisor({
    now: () => time,
    policy: createRespawnPolicy({ now: () => time }, { backoffScheduleMs: [5], crashLoopMaxFailures: 2 }),
    scheduler: { schedule: ({ run }) => { tasks.add(run); return () => { tasks.delete(run); }; } },
    spawnDaemonProcess: () => {
      const emitter = new EventEmitter();
      children.push(emitter);
      const child: SpawnedDaemonProcess = {
        pid,
        on: (input) => {
          if (input.event === "exit") emitter.on("exit", (code, signal) => input.listener({ code, signal }));
          else emitter.on("error", (error) => input.listener({ error }));
        },
        kill: () => true,
      };
      return child;
    },
    terminateProcess: () => {
      terminateCalls += 1;
      if (!asyncTerminate) return undefined;
      return new Promise<void>((resolve, reject) => { terminations.push({ resolve, reject }); });
    },
    classifyExit: ({ code, signal }) => ({ isPortConflict: false, reason: `exit ${code}/${signal ?? "none"}` }),
    failureReporter: { clear: () => undefined, record: ({ reason }) => { failures.push(reason); } },
    logger: { emit: (event) => { events.push(event); } },
  }, { onDemandCooldownMs: cooldownMs });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { supervisor, children, tasks, events, failures, terminations, flush,
    terminateCalls: () => terminateCalls, advance: (ms: number) => { time += ms; },
    retry: () => { for (const run of [...tasks]) { tasks.delete(run); run(); } } };
}

describe("onDemandCooldownMs validation", () => {
  it("0 is a valid cooldown", () => {
    expect(() => harness({ cooldownMs: 0 })).not.toThrow();
  });
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("%s is refused with RangeError", (cooldownMs) => {
    expect(() => harness({ cooldownMs })).toThrow(new RangeError("onDemandCooldownMs must be finite and non-negative"));
  });
});

describe("failure events", () => {
  it("an ordinary crash failure carries no decision key; a give-up carries the policy decision", () => {
    const h = harness();
    h.supervisor.start();
    h.children[0]!.emit("exit", 1, null);
    const first = h.events.filter((event) => event.type === "failure");
    expect(first).toEqual([{ type: "failure", at: 0, reason: "exit 1/none" }]);
    expect("decision" in first[0]!).toBe(false);
    h.retry();
    h.children[1]!.emit("exit", 1, null);
    const giveUp = h.events.filter((event) => event.type === "failure").at(-1);
    expect(giveUp).toEqual({ type: "failure", at: 0, reason: "gave up after 2 attempts in 60s: exit 1/none", decision: expect.objectContaining({ action: "give-up", attempts: 2 }) });
  });
});

describe("async termination ordering", () => {
  it("terminate resolving BEFORE exit does not spawn; the later exit does", async () => {
    const h = harness({ asyncTerminate: true });
    h.supervisor.start();
    h.supervisor.restart();
    h.terminations[0]!.resolve();
    await h.flush();
    expect(h.children).toHaveLength(1);
    h.children[0]!.emit("exit", 0, "SIGTERM");
    expect(h.children).toHaveLength(2);
  });

  it("exit BEFORE terminate resolves waits for the resolve, then spawns once", async () => {
    const h = harness({ asyncTerminate: true });
    h.supervisor.start();
    h.supervisor.restart();
    h.children[0]!.emit("exit", 0, "SIGTERM");
    expect(h.children).toHaveLength(1);
    h.terminations[0]!.resolve();
    await h.flush();
    expect(h.children).toHaveLength(2);
    expect(h.events.find((event) => event.type === "exit")).toEqual({ type: "exit", at: 0, pid: 100, code: 0, signal: "SIGTERM", deliberate: true });
  });

  it("shutdown during a pending replacement wins: no spawn after terminate resolves", async () => {
    const h = harness({ asyncTerminate: true });
    h.supervisor.start();
    h.supervisor.restart();
    h.children[0]!.emit("exit", 0, "SIGTERM");
    h.supervisor.shutdown();
    expect(h.terminateCalls()).toBe(1);
    h.terminations[0]!.resolve();
    await h.flush();
    expect(h.children).toHaveLength(1);
  });

  it("a failed terminate reports, clears the replacement, and the later deliberate exit is NOT a crash", async () => {
    const h = harness({ asyncTerminate: true });
    h.supervisor.start();
    h.supervisor.restart();
    h.terminations[0]!.reject(new Error("EPERM"));
    await h.flush();
    expect(h.failures).toEqual(["failed to stop daemon: Error: EPERM"]);
    h.children[0]!.emit("exit", 0, null);
    expect(h.children).toHaveLength(1);
    expect(h.tasks.size).toBe(0);
    expect(h.failures).toHaveLength(1);
  });
});

describe("child event guards", () => {
  it("an error on a child WITH a pid is reported but does not mark it exited (its later exit still retries)", () => {
    const h = harness();
    h.supervisor.start();
    h.children[0]!.emit("error", new Error("kill failed"));
    expect(h.failures).toEqual(["failed to start daemon: kill failed"]);
    h.children[0]!.emit("exit", 1, null);
    expect(h.tasks.size).toBe(1);
  });

  it("an error on a pid-less child marks it exited, so ensureStarted can spawn again", () => {
    const h = harness({ pidless: true, cooldownMs: 0 });
    h.supervisor.start();
    h.children[0]!.emit("error", new Error("ENOENT"));
    expect(h.supervisor.ensureStarted()).toEqual({ ok: true });
    expect(h.children).toHaveLength(2);
  });

  it("events after exit are ignored: second exit and late error are no-ops", () => {
    const h = harness();
    h.supervisor.start();
    h.children[0]!.emit("exit", 1, null);
    h.children[0]!.emit("exit", 1, null);
    h.children[0]!.emit("error", new Error("late"));
    expect(h.events.filter((event) => event.type === "exit")).toHaveLength(1);
    expect(h.failures).toEqual(["exit 1/none"]);
    expect(h.tasks.size).toBe(1);
  });
});

describe("single-flight controls", () => {
  it("a second restart on the same live child does not terminate it twice", () => {
    const h = harness();
    h.supervisor.start();
    h.supervisor.restart();
    h.supervisor.restart();
    expect(h.terminateCalls()).toBe(1);
  });

  it("start() while a retry is pending does not spawn ahead of the backoff", () => {
    const h = harness();
    h.supervisor.start();
    h.children[0]!.emit("exit", 1, null);
    h.supervisor.start();
    expect(h.children).toHaveLength(1);
    h.retry();
    expect(h.children).toHaveLength(2);
  });

  it("ensureStarted reports ok without spawning while a child runs or a retry is pending", () => {
    const h = harness();
    h.supervisor.start();
    expect(h.supervisor.ensureStarted()).toEqual({ ok: true });
    h.children[0]!.emit("exit", 1, null);
    expect(h.supervisor.ensureStarted()).toEqual({ ok: true });
    expect(h.children).toHaveLength(1);
  });

  it("on-demand cooldown: refused at cooldown-1, allowed at exactly cooldown", () => {
    const h = harness({ pidless: true, cooldownMs: 30 });
    h.advance(1000);
    h.supervisor.start();
    h.children[0]!.emit("error", new Error("ENOENT"));
    expect(h.supervisor.ensureStarted()).toEqual({ ok: true });
    expect(h.children).toHaveLength(2);
    h.children[1]!.emit("error", new Error("ENOENT"));
    h.advance(29);
    expect(h.supervisor.ensureStarted()).toEqual({ ok: false, reason: "cooling down before trying again" });
    expect(h.children).toHaveLength(2);
    h.advance(1);
    expect(h.supervisor.ensureStarted()).toEqual({ ok: true });
    expect(h.children).toHaveLength(3);
  });

  it("shutdown is idempotent and does not terminate an already-exited child", () => {
    const h = harness();
    h.supervisor.start();
    h.supervisor.shutdown();
    h.supervisor.shutdown();
    expect(h.terminateCalls()).toBe(1);
    const g = harness();
    g.supervisor.start();
    g.children[0]!.emit("exit", 1, null);
    g.supervisor.shutdown();
    expect(g.terminateCalls()).toBe(0);
    expect(g.tasks.size).toBe(0);
  });
});
