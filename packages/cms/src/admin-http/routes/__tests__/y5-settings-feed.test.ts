import { describe, expect, it, vi } from "vitest";
import { openSettingsEventsRequest, registerSettingsEventsRoute } from "../settings/events.js";
import { createThemePreviewFeed } from "../../../themes/preview/refresh.node.js";

describe("settings request feed composition", () => {
  it("resolves timers per request, lazily creates one preview feed and isolates its revision from settings cursors", async () => {
    const work: (() => void)[] = [];
    const frames: string[] = [];
    const createPreviewFeed = vi.fn<Parameters<typeof openSettingsEventsRequest>[0]["createPreviewFeed"]>((_input, _options) => () => { frames.push('event: theme-preview-refresh\ndata: {"revision":"next"}\n\n'); });
    const readRevisions = vi.fn(async () => []);
    const resolveTimers = vi.fn(() => ({ schedule: ({ work: callback }: { work: () => void; ms: number }) => { work.push(callback); return work.length; }, clear: vi.fn() }));
    await openSettingsEventsRequest({ workspaceId: "ws", resolveTimers,
      admission: { rejectForeignWorkspace: () => false, settingsReady: Promise.resolve(), principal: () => ({ id: "owner" }), report: vi.fn(), includePreview: () => true, authorize: async () => ({ settings: true, preview: true, reason: "allowed" }), json: vi.fn() },
      request: { httpVersionMajor: () => 2, lastEventId: () => "3", afterRevision: () => "7", themeRevision: () => "preview-revision", writeHead: vi.fn(), write: ({ frame }) => { frames.push(frame); }, end: vi.fn(), onClose: vi.fn() },
      settingsRepo: { findDefinitionBySettingId: async () => null }, readHead: async () => 10, readRevisions,
      collect: async () => ({ namespaces: [], cursor: 0 }), reauthorize: async () => ({ settings: true, preview: true }),
      createPreviewFeed, readPreview: () => null, isReservedPath: () => false, report: vi.fn(), headFailureText: "feed unavailable",
    });
    expect(resolveTimers).toHaveBeenCalledTimes(1);
    expect(createPreviewFeed).toHaveBeenCalledTimes(1);
    expect(createPreviewFeed.mock.calls[0]?.[1]).toEqual({ resumeRevision: "preview-revision" });
    await work[0]!();
    expect(readRevisions).toHaveBeenCalledWith({ workspaceId: "ws", sinceSeq: 3, limit: 200 });
    expect(frames.join("")).toContain("theme-preview-refresh");
    expect(frames.join("")).not.toContain("id:");
    expect(createPreviewFeed).toHaveBeenCalledTimes(1);
  });
});

it("the mounted feed delivers real preview markers without settings reads or ledger ids", async () => {
  type Registrar = Parameters<typeof registerSettingsEventsRoute>[0];
  const mount = vi.fn<Registrar["mount"]>();
  const work = new Map<number, () => void>();
  const closes: Array<() => void> = [];
  const frames: string[] = [];
  const readRevisions = vi.fn<Registrar["readRevisions"]>().mockResolvedValue([]);
  const reauthorize = vi.fn<Registrar["reauthorize"]>().mockResolvedValue({ settings: false, preview: true });
  let marker: NonNullable<ReturnType<Registrar["readPreview"]>> = { revision: "rev-2" };
  registerSettingsEventsRoute({
    mount, workspaceId: "garden", resolveTimers: () => ({
      schedule: ({ work: callback, ms }) => { work.set(ms, callback); return ms; },
      clear: ({ timer }) => { work.delete(Number(timer)); },
    }),
    settingsRepo: { findDefinitionBySettingId: async () => null },
    readHead: async () => 12, readRevisions,
    collect: async () => ({ namespaces: [], cursor: 0 }), reauthorize,
    createPreviewFeed: createThemePreviewFeed, readPreview: () => marker, isReservedPath: () => false,
    report: vi.fn(), headFailureText: "feed unavailable",
  });
  expect(mount).toHaveBeenCalledTimes(1);
  const binding = mount.mock.calls[0]?.[0];
  if (!binding) throw new Error("the settings feed did not mount");
  expect({ method: binding.method, path: binding.path }).toEqual({
    method: "get", path: "/api/admin/v1/workspaces/:workspaceId/settings/events",
  });
  const writeHead = vi.fn();
  const json = vi.fn();
  const firmTick = async (ms: number) => {
    const tick = work.get(ms);
    if (!tick) throw new Error(`no timer registered at ${ms}`);
    await tick();
  };
  await binding.handle({
    admission: { rejectForeignWorkspace: () => false, settingsReady: Promise.resolve(),
      principal: () => ({ id: "editor-2" }), report: vi.fn(), includePreview: () => true,
      authorize: async () => ({ settings: false, preview: true, reason: "settings denied" }), json,
    },
    request: { httpVersionMajor: () => 2, lastEventId: () => undefined, afterRevision: () => undefined,
      themeRevision: () => 47, writeHead, write: ({ frame }) => { frames.push(frame); },
      end: vi.fn(), onClose: ({ close }) => { closes.push(close); },
    },
  });
  expect(writeHead.mock.calls).toEqual([[200, {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
  }]]);
  expect(json).not.toHaveBeenCalled();
  await firmTick(1_000);
  marker = { revision: "rev-3", path: "/garden" };
  await firmTick(1_000);
  await firmTick(1_000);
  await firmTick(30_000);
  expect(frames).toEqual([": connected\n\n", 'event: theme-preview-refresh\ndata: {"revision":"rev-3","path":"/garden"}\n\n']);
  expect(readRevisions).not.toHaveBeenCalled();
  expect(reauthorize.mock.calls).toEqual([[{ workspaceId: "garden", principalId: "editor-2", includePreview: true }]]);
  const [close] = closes;
  if (!close) throw new Error("no close callback registered");
  close();
  expect(work.size).toBe(0);
});
