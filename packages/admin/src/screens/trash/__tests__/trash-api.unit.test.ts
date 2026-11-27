import { describe, expect, it } from "vitest";

import { createTrashApi } from "../api/trash-api.js";

type Request = { path: string; method: string; body?: unknown };

/** Records every request the client names and answers with a canned value, so each test proves the exact path/method/body. */
function recordingRequest(answer: unknown = { ok: true }) {
  const calls: Request[] = [];
  const authenticatedAdminRequest = async <T,>(request: Request): Promise<T> => {
    calls.push(request);
    return answer as T;
  };
  return { calls, authenticatedAdminRequest };
}

describe("createTrashApi", () => {
  it("lists page 1 with no query string when no paging options are given", async () => {
    const page = { items: [], nextCursor: null, retentionDays: 30 };
    const { calls, authenticatedAdminRequest } = recordingRequest(page);
    const api = createTrashApi({ authenticatedAdminRequest, workspaceId: "ws-1" });

    await expect(api.listTrash()).resolves.toBe(page);
    expect(calls).toEqual([{ method: "GET", path: "/workspaces/ws-1/trash" }]);
  });

  it("encodes cursor, limit and the comma-joined entity filter into the query", async () => {
    const { calls, authenticatedAdminRequest } = recordingRequest();
    const api = createTrashApi({ authenticatedAdminRequest, workspaceId: "ws-2" });

    await api.listTrash({ cursor: "c/1", limit: 25, entityTypes: ["post", "comment"] });
    expect(calls).toEqual([{ method: "GET", path: "/workspaces/ws-2/trash?cursor=c%2F1&limit=25&entityTypes=post%2Ccomment" }]);
  });

  it("omits an empty entity filter, a zero limit and an empty cursor instead of sending blank params", async () => {
    const { calls, authenticatedAdminRequest } = recordingRequest();
    const api = createTrashApi({ authenticatedAdminRequest, workspaceId: "ws-3" });

    await api.listTrash({ cursor: "", limit: 0, entityTypes: [] });
    expect(calls).toEqual([{ method: "GET", path: "/workspaces/ws-3/trash" }]);
  });

  it("restores by entity identity and purges by trash row id", async () => {
    const { calls, authenticatedAdminRequest } = recordingRequest();
    const api = createTrashApi({ authenticatedAdminRequest, workspaceId: "ws-4" });

    await api.restoreTrashItems({ items: [{ entityType: "post", entityId: "p1" }] });
    await api.purgeTrashItems({ ids: ["row-1", "row-2"] });
    expect(calls).toEqual([
      { method: "POST", path: "/workspaces/ws-4/trash/restore", body: { items: [{ entityType: "post", entityId: "p1" }] } },
      { method: "POST", path: "/workspaces/ws-4/trash/purge", body: { ids: ["row-1", "row-2"] } },
    ]);
  });

  it("moves one item to the trash through the generic items endpoint and returns the server answer", async () => {
    const { calls, authenticatedAdminRequest } = recordingRequest({ ok: true, version: 7 });
    const api = createTrashApi({ authenticatedAdminRequest, workspaceId: "ws-5" });

    await expect(api.trash({ type: "form", id: "f1" })).resolves.toEqual({ ok: true, version: 7 });
    expect(calls).toEqual([{ method: "POST", path: "/workspaces/ws-5/trash/items", body: { type: "form", id: "f1" } }]);
  });
});
