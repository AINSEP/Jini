import { expect, it as test } from "vitest";

import { startOwnParentWatchdog, type ParentWatchdogEvent, type ParentWatchdogPorts } from "../parent-watchdog.js";

/**
 * @file The parent watchdog, driven entirely through hand-written fakes for the
 * process-level ports: only a reparent or a confirmed (`ESRCH`) death self-terminates; every
 * inconclusive signal error is skipped; the escape hatch disables the watchdog outright.
 */

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function fakePorts({ env = {}, ppid = 100, signal = () => {} }: {
  env?: Record<string, string | undefined>; ppid?: number; signal?: (pid: number) => void;
} = {}) {
  const state = { ppid, exits: [] as number[], events: [] as ParentWatchdogEvent[], polls: [] as { callback: () => void; ms: number }[] };
  const ports: ParentWatchdogPorts = {
    env,
    envNames: { disable: "HOST_DISABLE_PARENT_WATCHDOG", devSupervisorPid: "HOST_DEV_SUPERVISOR_PID" },
    ppid: () => state.ppid,
    signalZero: signal,
    exit: (code) => void state.exits.push(code),
    report: (event) => void state.events.push(event),
    setInterval: (callback, ms) => void state.polls.push({ callback, ms }),
  };
  return { ports, state };
}

test("HOST_DISABLE_PARENT_WATCHDOG=1 disables the watchdog: no probe, no poll", () => {
  const signalled: number[] = [];
  const { ports, state } = fakePorts({ env: { HOST_DISABLE_PARENT_WATCHDOG: "1" }, signal: (pid) => void signalled.push(pid) });
  startOwnParentWatchdog(ports);
  expect(state.events).toEqual([{ kind: "disabled", disableEnvName: "HOST_DISABLE_PARENT_WATCHDOG" }]);
  expect(signalled).toEqual([]);
  expect(state.polls).toEqual([]);
});

test("a parent already gone at boot (ESRCH) self-terminates before arming the poll", () => {
  const { ports, state } = fakePorts({ ppid: 42, signal: () => { throw errno("ESRCH"); } });
  startOwnParentWatchdog(ports);
  expect(state.exits).toEqual([1]);
  expect(state.events).toEqual([{ kind: "parent-gone-at-boot", parentPid: 42 }]);
  expect(state.polls).toEqual([]);
});

test("an inconclusive boot probe (EPERM) still arms the 3s poll, which exits on a reparent", () => {
  const { ports, state } = fakePorts({ ppid: 42, signal: () => { throw errno("EPERM"); } });
  startOwnParentWatchdog(ports);
  expect(state.exits).toEqual([]);
  expect(state.polls.length).toBe(1);
  expect(state.polls[0]!.ms).toBe(3_000);
  state.polls[0]!.callback();
  expect(state.exits, "an unchanged parent is not a death").toEqual([]);
  state.ppid = 1;
  state.polls[0]!.callback();
  expect(state.exits).toEqual([1]);
  expect(state.events).toEqual([{ kind: "parent-reparented", parentPid: 42, currentPid: 1 }]);
});

test("an invalid HOST_DEV_SUPERVISOR_PID is reported and that check is disabled", () => {
  for (const raw of ["abc", "0", "-3", "1.5"]) {
    const signalled: number[] = [];
    const { ports, state } = fakePorts({ env: { HOST_DEV_SUPERVISOR_PID: raw }, signal: (pid) => void signalled.push(pid) });
    startOwnParentWatchdog(ports);
    expect(state.events).toEqual([{ kind: "invalid-supervisor-pid", envName: "HOST_DEV_SUPERVISOR_PID", raw }]);
    state.polls[0]!.callback();
    expect(signalled, `${raw}: only the boot parent probe ran; the supervisor is never signalled`).toEqual([100]);
    expect(state.exits).toEqual([]);
  }
});

test("a dev supervisor is probed each poll: alive or inconclusive continues, confirmed ESRCH exits", () => {
  let supervisor: "alive" | "eperm" | "gone" = "alive";
  const { ports, state } = fakePorts({ env: { HOST_DEV_SUPERVISOR_PID: "777" }, signal: (pid) => {
    if (pid !== 777) return;
    if (supervisor === "eperm") throw errno("EPERM");
    if (supervisor === "gone") throw errno("ESRCH");
  } });
  startOwnParentWatchdog(ports);
  const poll = state.polls[0]!.callback;
  poll();
  supervisor = "eperm";
  poll();
  expect(state.exits, "a live or inconclusive supervisor is never a self-kill").toEqual([]);
  supervisor = "gone";
  poll();
  expect(state.exits).toEqual([1]);
  expect(state.events).toEqual([{ kind: "supervisor-gone", supervisorPid: 777 }]);
});
