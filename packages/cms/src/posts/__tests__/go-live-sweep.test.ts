import { expect, it, vi } from "vitest";
import type { DomainEvent, OutboxPort } from "@jini-ai/core/contracts/events";
import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import type { GoLiveCandidatesPort, GoLiveRow } from "../../entries/go-live.js";
import { startPostGoLiveSweep } from "../go-live-sweep.js";

const first = "2026-11-25T12:00:00.000Z";
const goLive = "2026-11-25T11:57:00.000Z";
const row: GoLiveRow = { id: "article", workspaceId: "newsroom", kind: "post", status: "published", publishAt: goLive, updatedAt: "2026-11-25T11:49:00.000Z" };
function setup() {
  const listGoLiveCandidates = vi.fn<GoLiveCandidatesPort["listGoLiveCandidates"]>(async ({ workspaceId, nowIso, afterIso }) =>
    workspaceId === "newsroom" && nowIso >= goLive && (afterIso === undefined || afterIso < goLive) ? [row] : []);
  const events: DomainEvent[] = [];
  const outbox: OutboxPort = { enqueue: async event => { events.push(event); }, claimPending: async () => [],
    markDelivered: async () => {}, markFailed: async () => {} };
  let now = first;
  const required = { deps: { repo: { listGoLiveCandidates }, outbox, clock: { nowMs: () => Date.parse(now) } }, workspaceId: "newsroom", onError: vi.fn() };
  return { required, events, listGoLiveCandidates, setNow: (iso: string) => { now = iso; } };
}

it("starts full catch-up immediately, refreshes the overlapped window, and clears the default timer on stop", async () => {
  vi.useFakeTimers();
  const s = setup();
  const sweep = startPostGoLiveSweep(s.required);
  try {
    expect(s.listGoLiveCandidates).toHaveBeenCalledExactlyOnceWith({ workspaceId: "newsroom", nowIso: first }, {});
    await vi.advanceTimersByTimeAsync(59_999);
    expect(s.listGoLiveCandidates).toHaveBeenCalledTimes(1);
    s.setNow("2026-11-25T12:01:00.000Z");
    await vi.advanceTimersByTimeAsync(1);
    expect(s.listGoLiveCandidates).toHaveBeenLastCalledWith({
      workspaceId: "newsroom", nowIso: "2026-11-25T12:01:00.000Z", afterIso: "2026-11-25T11:50:00.000Z",
    }, {});
    const expected: DomainEvent = {
      id: "article-entry.published-at-2026-11-25T11:57:00.000Z", name: "entry.published",
      occurredAt: goLive, aggregateId: "article", workspaceId: "newsroom",
      payload: { entryId: "article", contentType: "post" },
    };
    expect(s.events).toEqual([expected, expected]);
    await sweep.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.listGoLiveCandidates).toHaveBeenCalledTimes(2);
  } finally {
    if (vi.getTimerCount() > 0) await sweep.stop();
    vi.useRealTimers();
  }
});

it("skips overlapping ticks, unrefs the host timer, and waits for the active pass to stop", async () => {
  const s = setup();
  let finish!: (rows: GoLiveRow[]) => void;
  s.listGoLiveCandidates.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const handle = { unref: vi.fn() };
  const setInterval = vi.fn(({ fn: _fn, ms: _ms }: { fn: () => void; ms: number }) => handle);
  const clearInterval = vi.fn();
  const sweep = startPostGoLiveSweep(s.required, { intervalMs: 321, timers: { setInterval, clearInterval } });
  const call = setInterval.mock.calls[0]?.[0];
  if (!call) throw new Error("No timer callback registered");
  expect(call.ms).toBe(321);
  expect(handle.unref).toHaveBeenCalledTimes(1);
  call.fn();
  expect(s.listGoLiveCandidates).toHaveBeenCalledTimes(1);
  let stopped = false;
  const pendingStop = sweep.stop().then(() => { stopped = true; });
  await Promise.resolve();
  expect(stopped).toBe(false);
  expect(clearInterval).toHaveBeenCalledExactlyOnceWith({ handle });
  finish([row]);
  await pendingStop;
  expect(s.events.map(event => event.id)).toEqual(["article-entry.published-at-2026-11-25T11:57:00.000Z"]);
  call.fn(); // A queued callback can fire after clearInterval.
  expect(s.listGoLiveCandidates).toHaveBeenCalledTimes(1);
});

it("retries the same window after a failed pass even when the host's reporter also throws", async () => {
  vi.useFakeTimers();
  const s = setup();
  const failure = new Error("candidate read unavailable");
  const traceNames: string[] = [];
  const trace = async <T>({ name, run }: { name: string; run: (span: { setOutcome(): void }) => T | Promise<T> }): Promise<T> => {
    traceNames.push(name);
    return run({ setOutcome() {} });
  };
  const tracker: Tracker = { capture() {}, error() {}, trace, metric() {} };
  s.required.onError.mockImplementation(() => { throw new Error("reporter offline"); });
  const sweep = startPostGoLiveSweep(s.required, { intervalMs: 1000, tracker });
  try {
    await vi.advanceTimersByTimeAsync(0);
    s.listGoLiveCandidates.mockRejectedValueOnce(failure);
    s.setNow("2026-11-25T12:01:00.000Z");
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.required.onError).toHaveBeenCalledExactlyOnceWith({ error: failure });
    expect(s.events.map(event => event.id)).toEqual(["article-entry.published-at-2026-11-25T11:57:00.000Z"]);
    s.setNow("2026-11-25T12:02:00.000Z");
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.listGoLiveCandidates.mock.calls).toEqual([
      [{ workspaceId: "newsroom", nowIso: first }, {}],
      [{ workspaceId: "newsroom", nowIso: "2026-11-25T12:01:00.000Z", afterIso: "2026-11-25T11:50:00.000Z" }, {}],
      [{ workspaceId: "newsroom", nowIso: "2026-11-25T12:02:00.000Z", afterIso: "2026-11-25T11:50:00.000Z" }, {}],
    ]);
    expect(s.events.map(event => event.id)).toEqual(["article-entry.published-at-2026-11-25T11:57:00.000Z", "article-entry.published-at-2026-11-25T11:57:00.000Z"]);
    expect(traceNames).toEqual(["post.go_live.sweep", "post.go_live.sweep", "post.go_live.sweep"]);
  } finally {
    await sweep.stop();
    vi.useRealTimers();
  }
});

it.each([0, -1, 0.5, NaN, Infinity])("rejects invalid sweep interval %s before querying candidates", intervalMs => {
  const s = setup();
  const start = () => startPostGoLiveSweep(s.required, { intervalMs, timers: {
    setInterval: () => { throw new Error("Unexpected timer"); }, clearInterval: () => {},
  } });
  expect(start).toThrow(RangeError);
  expect(start).toThrow("post go-live sweep interval must be positive");
  expect(s.listGoLiveCandidates).not.toHaveBeenCalled();
});
