import { describe, expect, it } from "vitest";
import { postGetRoute, type PostGetRouteDeps } from "../get-by-id.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

class FakeNotFound extends Error {}

function deps(overrides: Partial<PostGetRouteDeps> = {}): PostGetRouteDeps & { reads: unknown[] } {
  const reads: unknown[] = [];
  return {
    reads, workspaceId: WORKSPACE_ID,
    readPost: async (input) => { reads.push(input); return { post: { id: "p1", slug: "home" }, everPublished: true }; },
    isPostNotFound: ({ err }) => err instanceof FakeNotFound,
    ...overrides,
  };
}

describe("postGetRoute", () => {
  it("keeps the method and path and reads :postId, falling back to an empty id", () => {
    expect(postGetRoute.method).toBe("get");
    expect(postGetRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/posts/:postId");
    expect(postGetRoute.parse(raw({ postId: "home" }))).toEqual({ ok: true, value: { idOrSlug: "home" } });
    expect(postGetRoute.parse(raw({}))).toEqual({ ok: true, value: { idOrSlug: "" } });
  });

  it("authorizes content.read without naming an entity, then answers the post with everPublished merged in", async () => {
    const { authorize, calls } = recordingAuthorize();
    const d = deps();
    const result = await postGetRoute.handle({ input: { idOrSlug: "home" }, deps: d, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ permission: "content.read", entityType: "post" }]);
    expect(d.reads).toEqual([{ workspaceId: WORKSPACE_ID, idOrSlug: "home" }]);
    expect(result).toEqual({ ok: true, value: { post: { id: "p1", slug: "home", everPublished: true } } });
  });

  it("refuses an unknown post with 404 and the domain's own message, no code", async () => {
    const { authorize } = recordingAuthorize();
    const d = deps({ readPost: async () => { throw new FakeNotFound("post 'missing' was not found"); } });
    expect(await refusalOf(() => postGetRoute.handle({ input: { idOrSlug: "missing" }, deps: d, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "post 'missing' was not found" },
    });
  });

  it("rethrows any other failure unchanged for the host's error port", async () => {
    const { authorize } = recordingAuthorize();
    const failure = new Error("private store failure");
    const d = deps({ readPost: async () => { throw failure; } });
    await expect(postGetRoute.handle({ input: { idOrSlug: "home" }, deps: d, context: PRINCIPAL, authorize })).rejects.toBe(failure);
  });

  it("does not read the post when authorization refuses", async () => {
    const d = deps();
    await expect(postGetRoute.handle({ input: { idOrSlug: "home" }, deps: d, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
    expect(d.reads).toEqual([]);
  });
});
