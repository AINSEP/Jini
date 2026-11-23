import { describe, expect, it } from "vitest";

import { postAutosaveDeleteRoute, postAutosaveGetRoute, type PostAutosaveReadAndClearRouteDeps } from "../autosave.js";
import { PRINCIPAL, raw, recordingAuthorize, signal, WORKSPACE_ID } from "./write-helpers.js";

class FakePostNotFound extends Error {}

const SNAPSHOT = { bodyFormat: "doc", title: "Parked", slug: "parked", baseVersion: 3, bodyJson: { type: "doc" } };

/** Recording deps: `findPostId` resolves `my-slug` to `p1`, misses with the host's not-found error otherwise
 *  (or throws `lookupError` when given), and the store calls record the id they were asked for. */
function makeDeps(optional: { lookupError?: Error } = {}) {
  const reads: unknown[] = [];
  const clears: unknown[] = [];
  const deps: PostAutosaveReadAndClearRouteDeps = {
    workspaceId: WORKSPACE_ID,
    findPostId: async ({ workspaceId, idOrSlug }) => {
      if (optional.lookupError) throw optional.lookupError;
      if (workspaceId === WORKSPACE_ID && idOrSlug === "my-slug") return "p1";
      throw new FakePostNotFound(`post '${idOrSlug}' not found`);
    },
    isPostNotFound: ({ err }) => err instanceof FakePostNotFound,
    readAutosave: async (input) => { reads.push(input); return input.id === "p1" ? SNAPSHOT : null; },
    clearAutosave: async (input) => { clears.push(input); },
  };
  return { deps, reads, clears };
}

const PATH = "/api/admin/v1/workspaces/:workspaceId/posts/:postId/autosave";

describe("postAutosaveGetRoute / postAutosaveDeleteRoute", () => {
  it("keeps the methods, the shared path, no body cap and the default 200", () => {
    expect([postAutosaveGetRoute.method, postAutosaveDeleteRoute.method]).toEqual(["get", "delete"]);
    for (const route of [postAutosaveGetRoute, postAutosaveDeleteRoute]) {
      expect(route.path).toBe(PATH);
      expect(route.maxBodyBytes).toBeUndefined();
      expect(route.successStatus).toBeUndefined();
    }
  });

  it("parses :postId, falling back to an empty segment", () => {
    for (const route of [postAutosaveGetRoute, postAutosaveDeleteRoute]) {
      expect(route.parse(raw({ workspaceId: WORKSPACE_ID, postId: "my-slug" }))).toEqual({ ok: true, value: { postId: "my-slug" } });
      expect(route.parse(raw({}))).toEqual({ ok: true, value: { postId: "" } });
    }
  });

  it("GET authorizes content.write on posts naming no entity, resolves the slug and answers the parked snapshot", async () => {
    const { deps, reads } = makeDeps();
    const { authorize, calls } = recordingAuthorize();
    const result = await postAutosaveGetRoute.handle({ input: { postId: "my-slug" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "content.write", entityType: "post" }]);
    expect(reads).toEqual([{ workspaceId: WORKSPACE_ID, id: "p1" }]);
    expect(result).toEqual({ ok: true, value: { autosave: SNAPSHOT } });
  });

  it("DELETE authorizes the same way, clears the resolved id and answers { ok: true }", async () => {
    const { deps, clears } = makeDeps();
    const { authorize, calls } = recordingAuthorize();
    const result = await postAutosaveDeleteRoute.handle({ input: { postId: "my-slug" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "content.write", entityType: "post" }]);
    expect(clears).toEqual([{ workspaceId: WORKSPACE_ID, id: "p1" }]);
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it("a missing post falls back to the raw segment: GET null, DELETE ok — never a 404", async () => {
    const { deps, reads, clears } = makeDeps();
    const { authorize } = recordingAuthorize();
    expect(await postAutosaveGetRoute.handle({ input: { postId: "ghost" }, deps, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { autosave: null } });
    expect(await postAutosaveDeleteRoute.handle({ input: { postId: "ghost" }, deps, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { ok: true } });
    expect(reads).toEqual([{ workspaceId: WORKSPACE_ID, id: "ghost" }]);
    expect(clears).toEqual([{ workspaceId: WORKSPACE_ID, id: "ghost" }]);
  });

  it("any other lookup failure is rethrown unchanged (the host's redacted 500), touching no store", async () => {
    const { deps, reads, clears } = makeDeps({ lookupError: new Error("db down") });
    const { authorize } = recordingAuthorize();
    await expect(postAutosaveGetRoute.handle({ input: { postId: "my-slug" }, deps, context: PRINCIPAL, authorize })).rejects.toThrow("db down");
    await expect(postAutosaveDeleteRoute.handle({ input: { postId: "my-slug" }, deps, context: PRINCIPAL, authorize })).rejects.toThrow("db down");
    expect([reads, clears]).toEqual([[], []]);
  });

  it("an authorization refusal stops before any lookup, read or clear; no authorizer fails closed", async () => {
    let lookups = 0;
    const { deps, reads, clears } = makeDeps();
    const counted = { ...deps, findPostId: async (input: { workspaceId: string; idOrSlug: string }) => { lookups += 1; return deps.findPostId(input); } };
    for (const route of [postAutosaveGetRoute, postAutosaveDeleteRoute]) {
      await expect(route.handle({ input: { postId: "my-slug" }, deps: counted, context: PRINCIPAL, authorize: recordingAuthorize(["content.write"]).authorize })).rejects.toThrow("denied content.write");
      await expect(route.handle({ input: { postId: "my-slug" }, deps: counted, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    }
    expect([lookups, reads, clears]).toEqual([0, [], []]);
  });
});
