import { describe, expect, it } from "vitest";
import { postListRoute, type PostListRouteDeps } from "../list.js";
import { PRINCIPAL, raw, recordingAuthorize, WORKSPACE_ID } from "./helpers.js";

function deps(overrides: Partial<PostListRouteDeps> = {}): PostListRouteDeps & { reads: unknown[] } {
  const reads: unknown[] = [];
  return {
    reads, workspaceId: WORKSPACE_ID,
    listPostResponses: async (input) => { reads.push(input); return [{ post: { id: "p1" } }, { post: { id: "p2" } }]; },
    ...overrides,
  };
}

describe("postListRoute", () => {
  it("keeps the method and path and parses no input", () => {
    expect(postListRoute.method).toBe("get");
    expect(postListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/posts");
    expect(postListRoute.parse(raw({ workspaceId: WORKSPACE_ID }))).toEqual({ ok: true, value: {} });
  });

  it("authorizes content.read with no entity id, then answers { posts } in the host's list order", async () => {
    const { authorize, calls } = recordingAuthorize();
    const d = deps();
    const result = await postListRoute.handle({ input: {}, deps: d, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ permission: "content.read", entityType: "post" }]);
    expect(d.reads).toEqual([{ workspaceId: WORKSPACE_ID }]);
    expect(result).toEqual({ ok: true, value: { posts: [{ post: { id: "p1" } }, { post: { id: "p2" } }] } });
  });

  it("does not read posts when authorization refuses", async () => {
    const d = deps();
    await expect(postListRoute.handle({ input: {}, deps: d, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
    expect(d.reads).toEqual([]);
  });

  it("rethrows a read failure unchanged for the host's error port", async () => {
    const { authorize } = recordingAuthorize();
    const failure = new Error("private store failure");
    const d = deps({ listPostResponses: async () => { throw failure; } });
    await expect(postListRoute.handle({ input: {}, deps: d, context: PRINCIPAL, authorize })).rejects.toBe(failure);
  });
});
