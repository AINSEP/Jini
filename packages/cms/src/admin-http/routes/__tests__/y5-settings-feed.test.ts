import { describe, expect, it, vi } from "vitest";
import { openSettingsEventsRequest } from "../settings/events.js";

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
