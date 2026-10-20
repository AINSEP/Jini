import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import type { AdminComment, AdminCommentsPort } from "../../../core/ports/comments.js";
import type { CommentsEventsPort, CommentsSessionPort } from "../../ports.js";
import { CommentsPortsContext } from "../hooks/CommentsPorts.hooks.js";
import { CommentQueueScopeProvider, useCommentQueue, useWiredCommentQueue, type CommentQueueController } from "../hooks/use-comment-queue.hooks.js";

const GRANTS = ["comments.moderate", "comments.delete", "comments.delete.force"];
const SCOPE = { workspaceId: "w1", principalId: "operator" };
const COMMENT: AdminComment = { id: "c1", entryId: "e1", parentId: null, threadRootId: "c1",
  depth: 0, status: "pending", authorPrincipalId: null, authorName: "Reader", authorEmail: null,
  authorUrl: null, authorIpHash: null, bodyText: "Hello", spamScore: null, spamProvider: null,
  createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", version: 1 };
const SESSION: CommentsSessionPort = { me: () => Promise.reject(new Error("the queue never reads the session")) };

function fakeApi(_required: Record<string, never>, _optional: Record<string, never> = {}): AdminCommentsPort {
  return {
    listCommentsQueue: vi.fn(async () => ({ items: [COMMENT], nextCursor: null })),
    moderateComment: vi.fn(async () => undefined),
    purgeComment: vi.fn(async () => undefined),
    getCommentsSettings: vi.fn(() => Promise.reject(new Error("unused"))),
    putCommentsSettings: vi.fn(() => Promise.reject(new Error("unused"))),
  };
}
function wrapper({ children }: { children: ReactNode }) {
  return <FetchQueryProvider>{children}</FetchQueryProvider>;
}
/** Records every render so a test can use the very first one, before the controller exists. */
function renderQueue({ api }: { api: AdminCommentsPort }, _optional: Record<string, never> = {}) {
  const renders: CommentQueueController[] = [];
  const hook = renderHook(() => {
    const queue = useCommentQueue({ api, scope: SCOPE, permissions: GRANTS });
    renders.push(queue);
    return queue;
  }, { wrapper });
  return { ...hook, first: renders[0]! };
}

describe("useCommentQueue before the controller is created", () => {
  it("renders the controller's initial state", () => {
    const { first } = renderQueue({ api: fakeApi({}) });
    expect(first).toMatchObject({ status: "pending", items: null, nextCursor: null, error: null, loadingMore: false, pendingPurge: null });
  });

  it("reports an empty row state", () => {
    expect(renderQueue({ api: fakeApi({}) }).first.stateFor("c1")).toEqual({ busy: false, error: null });
  });

  it("ignores setStatus and setPendingPurge", async () => {
    const { first, result } = renderQueue({ api: fakeApi({}) });
    act(() => { first.setStatus("spam"); first.setPendingPurge(COMMENT); });
    await waitFor(() => expect(result.current.items).not.toBeNull());
    expect(result.current).toMatchObject({ status: "pending", pendingPurge: null });
  });

  it("resolves the actions without calling the API", async () => {
    const api = fakeApi({});
    const { first } = renderQueue({ api });
    first.loadMore();
    await first.onModerate(COMMENT, "approve");
    await first.onPurge();
    expect(api.moderateComment).not.toHaveBeenCalled();
    expect(api.purgeComment).not.toHaveBeenCalled();
  });
});

describe("useCommentQueue state updaters", () => {
  it("accepts a function updater for the status", async () => {
    const { result } = renderQueue({ api: fakeApi({}) });
    await waitFor(() => expect(result.current.items).not.toBeNull());
    act(() => result.current.setStatus(previous => (previous === "pending" ? "trash" : "spam")));
    expect(result.current.status).toBe("trash");
  });

  it("accepts a function updater for the pending purge", async () => {
    const { result } = renderQueue({ api: fakeApi({}) });
    await waitFor(() => expect(result.current.items).not.toBeNull());
    act(() => result.current.setPendingPurge(previous => previous ?? COMMENT));
    expect(result.current.pendingPurge).toEqual(COMMENT);
  });
});

describe("useCommentQueue cursor pages", () => {
  it("keys an in-flight cursor read by status, so another status with the same cursor still reads", async () => {
    const api = fakeApi({});
    vi.mocked(api.listCommentsQueue).mockImplementation(async (_required, options = {}) =>
      (options.cursor ? new Promise(() => {}) : { items: [{ ...COMMENT, status: options.status ?? "pending" }], nextCursor: "k1" }));
    const { result } = renderQueue({ api });
    await waitFor(() => expect(result.current.nextCursor).toBe("k1"));
    act(() => { result.current.loadMore(); });
    act(() => result.current.setStatus("spam"));
    await waitFor(() => expect(result.current.nextCursor).toBe("k1"));
    act(() => { result.current.loadMore(); });
    await waitFor(() => expect(api.listCommentsQueue).toHaveBeenCalledWith({}, { status: "spam", cursor: "k1" }));
  });
});

describe("useWiredCommentQueue", () => {
  it("rejects a missing workspace/principal scope before reading the queue", () => {
    const api = fakeApi({});
    expect(() => renderHook(() => useWiredCommentQueue({ permissions: GRANTS }), { wrapper: ({ children }) => (
      <CommentsPortsContext.Provider value={{ commentsApi: api, commentsSession: SESSION }}>{wrapper({ children })}</CommentsPortsContext.Provider>
    ) })).toThrow("Comment queue requires an explicit workspace/principal scope");
    expect(api.listCommentsQueue).not.toHaveBeenCalled();
  });

  it("reads the API from the ports context without an events port", async () => {
    const api = fakeApi({});
    const { result } = renderHook(() => useWiredCommentQueue({ permissions: GRANTS }), { wrapper: ({ children }) => (
      <CommentQueueScopeProvider scope={SCOPE}>
        <CommentsPortsContext.Provider value={{ commentsApi: api, commentsSession: SESSION }}>{wrapper({ children })}</CommentsPortsContext.Provider>
      </CommentQueueScopeProvider>
    ) });
    await waitFor(() => expect(result.current.items).toEqual([COMMENT]));
  });

  it("subscribes the context events port and unsubscribes on unmount", async () => {
    const api = fakeApi({});
    const unsubscribe = vi.fn();
    const events: CommentsEventsPort = { subscribe: vi.fn(() => unsubscribe) };
    const { unmount } = renderHook(() => useWiredCommentQueue({ permissions: GRANTS }), { wrapper: ({ children }) => (
      <CommentQueueScopeProvider scope={SCOPE}>
        <CommentsPortsContext.Provider value={{ commentsApi: api, commentsSession: SESSION, commentsEvents: events }}>{wrapper({ children })}</CommentsPortsContext.Provider>
      </CommentQueueScopeProvider>
    ) });
    expect(events.subscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
