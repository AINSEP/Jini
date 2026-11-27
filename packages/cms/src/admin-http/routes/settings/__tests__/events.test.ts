import { expect, it, vi } from "vitest";
import { admitSubscriber, createNamespaceResolver, settingsEventsRoute } from "../events.js";
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

function admissionDeps() {
  const principal = vi.fn(() => ({ id: "editor-2" }));
  const authorize = vi.fn<Parameters<typeof admitSubscriber>[0]["deps"]["authorize"]>()
    .mockResolvedValue({ settings: true, preview: false, reason: "settings grant" });
  return { rejectForeignWorkspace: () => false, settingsReady: Promise.resolve(), principal,
    report: vi.fn(), includePreview: () => true, authorize, json: vi.fn() };
}

it.each(["settings readiness", "principal lookup"] as const)("refuses a failed %s before feed authorization", async (stage) => {
  const deps = admissionDeps();
  const error = new Error("private readiness or session details");
  if (stage === "settings readiness") deps.settingsReady = Promise.reject(error);
  else deps.principal.mockImplementationOnce(() => { throw error; });
  expect(await admitSubscriber({ deps })).toBeNull();
  expect(deps.principal).toHaveBeenCalledTimes(stage === "settings readiness" ? 0 : 1);
  expect(deps.report.mock.calls).toEqual([[error]]);
  expect(deps.json.mock.calls).toEqual([[{ error: "unauthenticated", code: "UNAUTHENTICATED" }, 401]]);
  expect(deps.authorize).not.toHaveBeenCalled();
});

it("refuses a subscriber with neither feed grant but admits a preview-only editor", async () => {
  const deps = admissionDeps();
  deps.authorize.mockResolvedValueOnce({ settings: false, preview: false, reason: "no grants" })
    .mockResolvedValueOnce({ settings: false, preview: true, reason: "no settings grant" });
  expect(await admitSubscriber({ deps })).toBeNull();
  expect(deps.json.mock.calls).toEqual([[{
    error: "principal 'editor-2' is not authorized for 'settings.read' (no grants)",
    code: "FORBIDDEN", details: { permission: "settings.read", reason: "no grants" },
  }, 403]]);
  expect(await admitSubscriber({ deps })).toEqual({
    principal: { id: "editor-2" }, access: { settings: false, preview: true, reason: "no settings grant" }, includePreview: true,
  });
  expect(deps.json).toHaveBeenCalledTimes(1);
  expect(deps.authorize.mock.calls).toEqual([[{ principalId: "editor-2", includePreview: true }], [{ principalId: "editor-2", includePreview: true }]]);
});

it("caches present and missing namespaces by setting id within each connection", async () => {
  const findDefinitionBySettingId = vi.fn(async ({ settingId }: { settingId: string }) => {
    if (settingId === "site-title") return { namespace: "site" };
    if (settingId === "deleted") return null;
    throw new Error("unexpected setting id");
  });
  const deps = { settingsRepo: { findDefinitionBySettingId } };
  const resolve = createNamespaceResolver({ deps });
  expect(await resolve({ settingId: "site-title" })).toBe("site");
  expect(await resolve({ settingId: "deleted" })).toBeNull();
  expect(await resolve({ settingId: "deleted" })).toBeNull();
  expect(await resolve({ settingId: "site-title" })).toBe("site");
  expect(findDefinitionBySettingId.mock.calls).toEqual([[{ settingId: "site-title" }], [{ settingId: "deleted" }]]);
  const nextConnection = createNamespaceResolver({ deps });
  expect(await nextConnection({ settingId: "site-title" })).toBe("site");
  expect(findDefinitionBySettingId.mock.calls).toEqual([
    [{ settingId: "site-title" }], [{ settingId: "deleted" }], [{ settingId: "site-title" }],
  ]);
});

it("retries the same cursor after a read failure, and a full page cannot jump to the global head", async () => {
  const work = new Map<number, () => void>();
  const report = vi.fn();
  const write = vi.fn();
  const readHead = vi.fn().mockResolvedValueOnce(12).mockResolvedValue(900);
  const failure = new Error("ledger temporarily unavailable");
  const page = Array.from({ length: 200 }, (_, index) => ({ seq: 13 + index } as SettingRevisionRecord));
  const readRevisions = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(page).mockResolvedValue([]);
  await settingsEventsRoute.open<number>({
    workspaceId: "garden", initialAccess: { settings: true, preview: false }, lastEventId: undefined, afterRevision: "4",
    ports: {
      writeHead: () => {}, write, end: () => {}, onClose: () => {},
      schedule: ({ work: callback, ms }) => { work.set(ms, callback); return ms; }, clear: ({ timer }) => { work.delete(timer); },
      readHead, readRevisions, collect: async ({ revisions }) => revisions.length ? { namespaces: ["site"], cursor: 212 } : { namespaces: [], cursor: 0 },
      reauthorize: async () => ({ settings: true, preview: false }), previewTick: () => {}, report, headFailureText: "unavailable",
    },
  });
  const poll = work.get(1_000);
  if (!poll) throw new Error("settings poll did not schedule");
  await poll();
  await poll();
  await poll();
  expect(report.mock.calls).toEqual([[{ phase: "poll", error: failure }]]);
  expect(readRevisions.mock.calls).toEqual([
    [{ sinceSeq: 4, limit: 200, workspaceId: "garden" }],
    [{ sinceSeq: 4, limit: 200, workspaceId: "garden" }],
    [{ sinceSeq: 212, limit: 200, workspaceId: "garden" }],
  ]);
  expect(write.mock.calls).toEqual([
    [{ frame: ": connected\n\n" }], [{ frame: "id: 212\n" }],
    [{ frame: "event: settings-changed\n" }], [{ frame: 'data: {"namespaces":["site"]}\n\n' }],
  ]);
});

it("does not resolve a principal or authorize when the host already rejected the workspace", async () => {
  const deps = { ...admissionDeps(), rejectForeignWorkspace: () => true };
  expect(await admitSubscriber({ deps })).toBeNull();
  expect(deps.principal).not.toHaveBeenCalled();
  expect(deps.authorize).not.toHaveBeenCalled();
  expect(deps.json).not.toHaveBeenCalled();
});

it("rejects an overlapping poll and clears every timer once both feed grants are revoked", async () => {
  const work = new Map<number, () => void>();
  const closes: Array<() => void> = [];
  const clear = vi.fn(({ timer }: { timer: number }) => { work.delete(timer); });
  const write = vi.fn();
  const end = vi.fn();
  const readRevisions = vi.fn(async () => []);
  const previewTick = vi.fn();
  function deferred<T>() {
    let resolve: (value: T) => void = () => { throw new Error("promise executor did not initialize"); };
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }
  const pending = deferred<{ namespaces: string[]; cursor: number }>();
  const collecting = deferred<void>();
  await settingsEventsRoute.open<number>({
    workspaceId: "garden", initialAccess: { settings: true, preview: true }, lastEventId: "-1", afterRevision: undefined,
    ports: {
      writeHead: () => {}, write, end, onClose: ({ close }) => { closes.push(close); },
      schedule: ({ work: callback, ms }) => { work.set(ms, callback); return ms; }, clear,
      readHead: async () => 12, readRevisions,
      collect: () => { collecting.resolve(undefined); return pending.promise; },
      reauthorize: async () => ({ settings: false, preview: false }), previewTick, report: vi.fn(), headFailureText: "unavailable",
    },
  });
  const poll = work.get(1_000);
  const recheck = work.get(30_000);
  const keepalive = work.get(25_000);
  if (!poll || !recheck || !keepalive) throw new Error("feed timers did not schedule");
  const inFlight = poll();
  await collecting.promise;
  // Leave the second invocation unawaited until the first is released, so removing the
  // overlap guard is an assertion failure rather than a deadlocked test.
  const overlapping = poll();
  await recheck();
  pending.resolve({ namespaces: ["site"], cursor: 13 });
  await Promise.all([inFlight, overlapping]);
  keepalive();
  const [close] = closes;
  if (!close) throw new Error("close callback did not register");
  close();
  expect(readRevisions.mock.calls).toEqual([[{ workspaceId: "garden", sinceSeq: 12, limit: 200 }]]);
  expect(previewTick.mock.calls).toEqual([[{}]]);
  expect(write.mock.calls).toEqual([[{ frame: ": connected\n\n" }]]);
  expect(end.mock.calls).toEqual([[{}]]);
  expect(clear.mock.calls).toEqual([[{ timer: 1_000 }], [{ timer: 25_000 }], [{ timer: 30_000 }]]);
  expect(work.size).toBe(0);
});
