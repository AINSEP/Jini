// @vitest-environment jsdom
/**
 * @file `useResourceReadings` rendered under jsdom with every effect injected: the bridge, the
 * visibility source and the timers, so cadence and hide/show races are driven by hand.
 */
import assert from "node:assert/strict";
import { act, renderHook as render } from "@testing-library/react";
import { test, vi } from "vitest";
import { useResourceReadings, type ResourceReadingsPorts, type ResourceReadingsRequest } from "../use-resource-readings.hooks.js";

interface Snapshot { status: "available" | "unavailable"; pollIntervalMs: number }
const snapshot = (pollIntervalMs = 60_000): Snapshot => ({ status: "available", pollIntervalMs });

/** The `current()` / `rerender()` / `unmount()` handle these cases were written against. */
function renderHook<T>(useHook: () => T) {
  const view = render(useHook);
  return { current: () => view.result.current, rerender: () => view.rerender(), unmount: () => view.unmount() };
}

/** Let pending promise callbacks and the React updates they schedule run. */
async function settle() {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}

function fixture() {
  let hidden = false;
  const listeners = new Set<() => void>();
  const timers = new Map<number, { run: () => void; delay: number }>();
  const requests: ResourceReadingsRequest[] = [];
  let nextTimer = 0;
  let read = async (request: ResourceReadingsRequest) => snapshot(request.panelOpen ? 10_000 : 60_000);
  const ports: ResourceReadingsPorts<Snapshot> = {
    getBridge: () => ({ getResources: (request) => { requests.push(request); return read(request); } }),
    document: {
      get hidden() { return hidden; },
      addEventListener: (_event, listener) => { listeners.add(listener); },
      removeEventListener: (_event, listener) => { listeners.delete(listener); },
    },
    setTimer: ({ run, delay }) => { const id = ++nextTimer; timers.set(id, { run, delay }); return id; },
    clearTimer: ({ id }) => { timers.delete(id); },
  };
  return { ports, requests, timers, listeners,
    setRead: (next: typeof read) => { read = next; },
    visibility: (value: boolean) => act(() => { hidden = value; for (const listener of listeners) listener(); }),
    tick: () => act(() => { const [id, timer] = timers.entries().next().value!; timers.delete(id); timer.run(); }),
  };
}

test("visible badge and panel use main cadence; hidden documents and unmount release polling", async () => {
  const f = fixture();
  let panelOpen = false;
  const hook = renderHook(() => useResourceReadings({ panelOpen, ports: f.ports }));
  await settle();
  assert.deepEqual(f.requests, [{ panelOpen: false }]);
  assert.equal([...f.timers.values()][0]!.delay, 60_000);
  panelOpen = true; hook.rerender(); await settle();
  assert.deepEqual(f.requests, [{ panelOpen: false }, { panelOpen: true }]);
  assert.equal([...f.timers.values()][0]!.delay, 10_000);
  f.visibility(true);
  assert.equal(f.timers.size, 0);
  f.visibility(false); await settle();
  assert.equal(f.requests.length, 3);
  f.tick(); await settle();
  assert.equal(f.requests.length, 4);
  hook.unmount();
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 0);
});

test("a panel change waits for an outstanding badge read and discards its result", async () => {
  const f = fixture();
  let finish!: (value: Snapshot) => void;
  f.setRead(() => new Promise((resolve) => { finish = resolve; }));
  let panelOpen = false;
  const hook = renderHook(() => useResourceReadings({ panelOpen, ports: f.ports }));
  await settle();
  panelOpen = true; hook.rerender(); await settle();
  assert.equal(f.requests.length, 1);
  f.setRead(async () => snapshot(5_000));
  await act(async () => { finish(snapshot()); }); await settle();
  assert.deepEqual(f.requests, [{ panelOpen: false }, { panelOpen: true }]);
  assert.equal(hook.current()!.pollIntervalMs, 5_000);
  assert.equal([...f.timers.values()][0]!.delay, 5_000);
});

test("a site lifecycle change refreshes the collapsed reading without waiting a minute", async () => {
  const f = fixture();
  let refreshKey = "stopped";
  const hook = renderHook(() => useResourceReadings({ panelOpen: false, ports: f.ports }, { refreshKey }));
  await settle();
  assert.equal(f.requests.length, 1);
  refreshKey = "running"; hook.rerender(); await settle();
  assert.deepEqual(f.requests, [{ panelOpen: false }, { panelOpen: false }]);
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0]!.delay, 60_000);
  hook.rerender(); await settle();
  assert.equal(f.requests.length, 2, "unchanged card state does not add polling");
});

test("starts hidden without a read; IPC failures withdraw stale data and retry promptly", async () => {
  const f = fixture(); f.visibility(true);
  const hook = renderHook(() => useResourceReadings({ panelOpen: true, ports: f.ports }));
  await settle(); assert.equal(f.requests.length, 0);
  f.visibility(false); await settle(); assert.equal(hook.current()!.status, "available");
  f.setRead(async () => { throw new Error("fixture failure"); });
  vi.spyOn(console, "error").mockImplementation(() => {});
  f.tick(); await settle();
  assert.equal(hook.current(), null);
  assert.equal([...f.timers.values()][0]!.delay, 5_000);
  vi.restoreAllMocks();
});

test("IPC failure logs once across polls and panel changes until a successful read", async () => {
  const f = fixture();
  const logs: unknown[][] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logs.push(args); });
  f.setRead(async () => { throw Object.assign(new Error("boom acct_ak_0123456789ab.SECRETSECRETSECRETSECRET"), { code: "ECONNRESET" }); });
  let panelOpen = false;
  const hook = renderHook(() => useResourceReadings({ panelOpen, ports: f.ports }));
  await settle(); f.tick(); await settle();
  assert.equal(logs.length, 1, "only the first failure in a streak is logged");
  const firstLog = logs[0]?.join(" ") ?? "";
  assert.match(firstLog, /\[resources\] Could not read resource usage/);
  assert.match(firstLog, /Error/);
  assert.match(firstLog, /ECONNRESET/);
  assert.doesNotMatch(firstLog, /boom|SECRETSECRETSECRETSECRET/);
  panelOpen = true; hook.rerender(); await settle();
  assert.equal(logs.length, 1, "changing the panel does not end a failure streak");
  f.setRead(async () => snapshot()); f.tick(); await settle();
  f.setRead(async () => { throw new Error("another failure"); });
  f.tick(); await settle(); f.tick(); await settle();
  assert.equal(logs.length, 2, "a successful read starts a new failure streak");
  hook.unmount();
  vi.restoreAllMocks();
});

test("a missing resource preload remains unavailable and creates no timer", async () => {
  const f = fixture(); f.ports.getBridge = () => undefined;
  const hook = renderHook(() => useResourceReadings({ panelOpen: false, ports: f.ports }));
  await settle();
  assert.equal(hook.current(), null);
  assert.equal(f.timers.size, 0);
});

test("hide/show during a read discards that reading and retries without overlapping", async () => {
  const f = fixture();
  let finish!: (value: Snapshot) => void;
  f.setRead(() => new Promise((resolve) => { finish = resolve; }));
  const hook = renderHook(() => useResourceReadings({ panelOpen: true, ports: f.ports }));
  await settle();
  f.visibility(true); f.visibility(false); await settle();
  assert.equal(f.requests.length, 1);
  await act(async () => { finish(snapshot()); }); await settle();
  assert.equal(hook.current(), null, "the pre-hide reading is discarded");
  assert.equal([...f.timers.values()][0]!.delay, 0);
  f.setRead(async () => snapshot(5_000));
  f.tick(); await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(hook.current()!.pollIntervalMs, 5_000);
});

test("a reply that lands while hidden arms no timer: a hidden panel does not poll", async () => {
  const f = fixture();
  let finish!: (value: Snapshot) => void;
  f.setRead(() => new Promise((resolve) => { finish = resolve; }));
  const hook = renderHook(() => useResourceReadings({ panelOpen: true, ports: f.ports }));
  await settle();
  f.visibility(true); await settle();
  await act(async () => { finish(snapshot(5_000)); }); await settle();
  assert.equal(f.timers.size, 0, "no read is scheduled while the document is hidden");
  assert.equal(hook.current(), null, "the reading that straddled the hide is not shown");
  assert.equal(f.requests.length, 1);
  hook.unmount();
});

test("late replies after unmount cannot rearm polling", async () => {
  const f = fixture();
  let finish!: (value: Snapshot) => void;
  f.setRead(() => new Promise((resolve) => { finish = resolve; }));
  const hook = renderHook(() => useResourceReadings({ panelOpen: true, ports: f.ports }));
  await settle(); hook.unmount();
  await act(async () => { finish(snapshot()); }); await settle();
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.size, 0);
});
