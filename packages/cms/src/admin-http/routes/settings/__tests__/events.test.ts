import { expect, it, vi } from "vitest";
import { settingsEventsRoute } from "../events.js";
import type { SettingRevisionRecord } from "@jini-ai/core/settings";

it("clamps resume position and never emits the global head as the settings event id", async () => {
  const frames: string[] = []; const timers = new Map<number, () => void>();
  const readRevisions = vi.fn(async () => [{ seq: 31 } as SettingRevisionRecord]);
  await settingsEventsRoute.open({ workspaceId: "w", initialAccess: { settings: true, preview: false }, lastEventId: "999", afterRevision: "1", ports: {
    writeHead: () => {}, write: ({ frame }) => { frames.push(frame); }, end: () => {}, onClose: () => {},
    schedule: ({ work, ms }) => { timers.set(ms, work); return ms; }, clear: () => {},
    readHead: vi.fn().mockResolvedValueOnce(10).mockResolvedValue(100), readRevisions, collect: async () => ({ namespaces: ["site"], cursor: 31 }),
    reauthorize: async () => ({ settings: true, preview: false }), previewTick: () => {}, report: () => {}, headFailureText: "unavailable",
  } });
  await timers.get(1000)?.();
  expect(readRevisions).toHaveBeenCalledWith({ workspaceId: "w", sinceSeq: 10, limit: 200 });
  expect(frames.join("")).toContain("id: 31\n"); expect(frames.join("")).not.toContain("id: 100\n");
});

it("writes a safe head-read failure without scheduling timers", async () => {
  const calls: string[] = []; const schedule = vi.fn(() => 1);
  await settingsEventsRoute.open({ workspaceId: "w", initialAccess: { settings: true, preview: false }, lastEventId: undefined, afterRevision: undefined, ports: {
    writeHead: () => { calls.push("head"); }, readHead: async () => { calls.push("read"); throw new Error("private SQL"); },
    write: ({ frame }) => { calls.push(frame); }, end: () => { calls.push("end"); }, schedule, clear: () => {}, onClose: () => {},
    readRevisions: async () => [], collect: async () => ({ namespaces: [], cursor: 0 }), reauthorize: async () => ({ settings: true, preview: false }), previewTick: () => {}, report: () => {}, headFailureText: "safe copy",
  } });
  expect(calls).toEqual(["head", "read", 'event: error\ndata: {"code":"FEED_UNAVAILABLE","message":"safe copy"}\n\n', "end"]);
  expect(schedule).not.toHaveBeenCalled();
});

it("failed reauthorization suppresses an in-flight poll and both close adapters dispose once", async () => {
  const timers = new Map<number, () => void>(); const closes: Array<() => void> = [];
  const clear = vi.fn(); const end = vi.fn(); const write = vi.fn();
  let release: ((batch: { namespaces: string[]; cursor: number }) => void) | undefined;
  const pending = new Promise<{ namespaces: string[]; cursor: number }>(resolve => { release = resolve; });
  await settingsEventsRoute.open({ workspaceId: "w", initialAccess: { settings: true, preview: false }, lastEventId: undefined, afterRevision: undefined, ports: {
    writeHead: () => {}, write, end, onClose: ({ close }) => { closes.push(close, close); }, schedule: ({ work, ms }) => { timers.set(ms, work); return ms; }, clear,
    readHead: async () => 100, readRevisions: async () => [], collect: () => pending,
    reauthorize: async () => { throw new Error("auth unavailable"); }, previewTick: () => {}, report: () => {}, headFailureText: "safe",
  } });
  const tick = timers.get(1000)?.();
  await Promise.resolve(); await Promise.resolve();
  await timers.get(30000)?.();
  release?.({ namespaces: ["secret"], cursor: 101 }); await tick;
  for (const close of closes) close();
  expect(clear).toHaveBeenCalledTimes(3); expect(end).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledTimes(1); expect(write).toHaveBeenCalledWith({ frame: ": connected\n\n" });
});
