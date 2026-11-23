import { ToolInputError } from "@jini-ai/core";
import { describe, expect, it } from "vitest";
import { commentsModerationQueueRoute } from "../moderation-queue.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

function queueDeps() {
  const reads: unknown[] = [];
  return { reads, deps: { workspaceId: WORKSPACE_ID, commentRepo: { listModerationQueue: async (input: { cursor?: string | null }) => {
    reads.push(input);
    if (input.cursor === "unknown") throw new ToolInputError({ message: "invalid cursor" });
    return { items: [], nextCursor: null };
  } } } };
}

const call = (query: Record<string, unknown>, deps: ReturnType<typeof queueDeps>["deps"], authorize = recordingAuthorize().authorize) =>
  commentsModerationQueueRoute.handle({ input: { query }, deps, context: PRINCIPAL, authorize }, { signal });

describe("commentsModerationQueueRoute", () => {
  it("keeps the path and passes the raw query through parse", () => {
    expect([commentsModerationQueueRoute.method, commentsModerationQueueRoute.path]).toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/comments/queue"]);
    expect(commentsModerationQueueRoute.parse(raw({ query: { status: "spam" } }))).toEqual({ ok: true, value: { query: { status: "spam" } } });
  });

  it("authorizes comments.read, then defaults status/limit and caps the limit at 100", async () => {
    const { deps, reads } = queueDeps();
    const { authorize, calls } = recordingAuthorize();
    expect(await call({}, deps, authorize)).toEqual({ ok: true, value: { items: [], nextCursor: null } });
    await call({ status: "spam", limit: "500", cursor: "c-1" }, deps);
    expect(calls).toEqual([{ permission: "comments.read", entityType: "comment" }]);
    expect(reads).toEqual([
      { workspaceId: WORKSPACE_ID, status: "pending", limit: 20, cursor: null },
      { workspaceId: WORKSPACE_ID, status: "spam", limit: 100, cursor: "c-1" },
    ]);
  });

  it("refuses an off-enum status, a malformed limit, a repeated cursor and an unknown cursor with VALIDATION_ERROR", async () => {
    const { deps } = queueDeps();
    for (const query of [{ status: "nope" }, { limit: "abc" }, { cursor: ["a", "b"] }, { cursor: "unknown" }]) {
      expect(await refusalOf(() => call(query, deps))).toMatchObject({ status: 400, body: { code: "VALIDATION_ERROR" } });
    }
    expect(await refusalOf(() => call({ cursor: "unknown" }, deps))).toEqual({ status: 400, body: { error: "invalid cursor", code: "VALIDATION_ERROR" } });
  });

  it("checks authorization before the query (a denied caller never sees the 400) and passes other failures through", async () => {
    const { deps, reads } = queueDeps();
    await expect(call({ status: "nope" }, deps, recordingAuthorize({ deny: "comments.read" }).authorize)).rejects.toThrow("denied comments.read");
    expect(reads).toEqual([]);
    const broken = { workspaceId: WORKSPACE_ID, commentRepo: { listModerationQueue: async () => { throw new Error("db down"); } } };
    await expect(call({}, broken)).rejects.toThrow("db down");
  });
});
