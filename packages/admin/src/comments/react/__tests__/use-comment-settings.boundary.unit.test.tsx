import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import type { AdminCommentsPort, CommentsSettings } from "../../../core/ports/comments.js";
import type { CommentsSessionPort } from "../../ports.js";
import { CommentsPortsContext } from "../hooks/CommentsPorts.hooks.js";
import { useCommentSettings, useWiredCommentSettings, type CommentSettingsController } from "../hooks/use-comment-settings.hooks.js";

const SETTINGS: CommentsSettings = { enabled: true, requireModeration: true, maxDepth: 3,
  closeAfterDays: null, spamAutoRejectScore: 0.05, maxPerIpPerHour: 10 };
const SESSION: CommentsSessionPort = { me: () => Promise.reject(new Error("settings never read the session")) };

function fakeApi(): AdminCommentsPort {
  return {
    listCommentsQueue: vi.fn(() => Promise.reject(new Error("unused"))),
    moderateComment: vi.fn(() => Promise.reject(new Error("unused"))),
    purgeComment: vi.fn(() => Promise.reject(new Error("unused"))),
    getCommentsSettings: vi.fn(async () => SETTINGS),
    putCommentsSettings: vi.fn(async () => SETTINGS),
  };
}
function wrapper({ children }: { children: ReactNode }) {
  return <FetchQueryProvider>{children}</FetchQueryProvider>;
}
function form(): FormData {
  const data = new FormData();
  data.set("enabled", "on");
  data.set("requireModeration", "on");
  data.set("maxDepth", "4");
  data.set("closeAfterDays", "");
  data.set("spamAutoRejectScore", "0.05");
  data.set("maxPerIpPerHour", "10");
  return data;
}

describe("useCommentSettings before the controller is created", () => {
  it("renders the controller's initial state and an inert save", async () => {
    const api = fakeApi();
    const renders: CommentSettingsController[] = [];
    renderHook(() => {
      const settings = useCommentSettings({ api, canConfigure: true });
      renders.push(settings);
      return settings;
    }, { wrapper });
    const first = renders[0]!;
    expect(first).toMatchObject({ settings: null, error: null, saving: false, notice: null });
    await first.save(form());
    expect(api.putCommentsSettings).not.toHaveBeenCalled();
  });
});

describe("useCommentSettings grants", () => {
  it("saves when canConfigure grants comments.configure", async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useCommentSettings({ api, canConfigure: true }), { wrapper });
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    await result.current.save(form());
    expect(api.putCommentsSettings).toHaveBeenCalledWith({}, { maxDepth: 4 });
  });

  it("neither reads nor saves when canConfigure is false", async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useCommentSettings({ api, canConfigure: false }), { wrapper });
    await result.current.save(form());
    expect(api.getCommentsSettings).not.toHaveBeenCalled();
    expect(api.putCommentsSettings).not.toHaveBeenCalled();
  });

  it("starts saving after canConfigure flips to true", async () => {
    const api = fakeApi();
    const { result, rerender } = renderHook(({ canConfigure }) => useCommentSettings({ api, canConfigure }), { wrapper, initialProps: { canConfigure: false } });
    rerender({ canConfigure: true });
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    await result.current.save(form());
    expect(api.putCommentsSettings).toHaveBeenCalledTimes(1);
  });
});

describe("useWiredCommentSettings", () => {
  it("reads the API from the ports context", async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useWiredCommentSettings({ canConfigure: true }), { wrapper: ({ children }) => (
      <CommentsPortsContext.Provider value={{ commentsApi: api, commentsSession: SESSION }}>{wrapper({ children })}</CommentsPortsContext.Provider>
    ) });
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
  });
});
