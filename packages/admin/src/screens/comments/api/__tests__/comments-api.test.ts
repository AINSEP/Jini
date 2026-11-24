import { describe, expect, it } from "vitest";
import { createCommentsApi } from "../comments-api.js";

describe("createCommentsApi", () => {
  it("reads the queue through the injected request, scoped to the injected workspace", async () => {
    const calls: unknown[] = [];
    const api = createCommentsApi({ request: async <T>(required: { method: string; path: string }): Promise<T> => { calls.push(required); return {} as T; }, workspaceId: "ws-3" });
    await api.listCommentsQueue();
    await api.listCommentsQueue({ status: "pending" as never, cursor: "c 1", limit: 5 });
    expect(calls).toEqual([
      { method: "GET", path: "/workspaces/ws-3/comments/queue" },
      { method: "GET", path: "/workspaces/ws-3/comments/queue?status=pending&cursor=c+1&limit=5" },
    ]);
  });
});
