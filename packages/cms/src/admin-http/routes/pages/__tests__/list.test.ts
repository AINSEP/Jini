import { describe, expect, it } from "vitest";
import { pageListRoute, type PageListRouteDeps } from "../list.js";
import { PRINCIPAL, raw, recordingAuthorize, WORKSPACE_ID } from "./helpers.js";

function deps(overrides: Partial<PageListRouteDeps> = {}): PageListRouteDeps & { reads: unknown[] } {
  const reads: unknown[] = [];
  return {
    reads, workspaceId: WORKSPACE_ID,
    listPageResponses: async (input) => { reads.push(input); return [{ id: "about", kind: "page" }]; },
    ...overrides,
  };
}

describe("pageListRoute", () => {
  it("keeps the method, path and default success status, declares no body cap, and parses nothing", () => {
    expect(pageListRoute.method).toBe("get");
    expect(pageListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/pages");
    expect(pageListRoute.successStatus).toBeUndefined();
    expect(pageListRoute.maxBodyBytes).toBeUndefined();
    expect(pageListRoute.parse(raw({ workspaceId: WORKSPACE_ID }))).toEqual({ ok: true, value: {} });
  });

  it("authorizes content.read on posts without naming an entity, then answers the host's page DTOs under `posts`", async () => {
    const { authorize, calls } = recordingAuthorize();
    const d = deps();
    const result = await pageListRoute.handle({ input: {}, deps: d, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ permission: "content.read", entityType: "post" }]);
    expect(d.reads).toEqual([{ workspaceId: WORKSPACE_ID }]);
    expect(result).toEqual({ ok: true, value: { posts: [{ id: "about", kind: "page" }] } });
  });

  it("does not list when authorization refuses", async () => {
    const d = deps();
    await expect(pageListRoute.handle({ input: {}, deps: d, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
    expect(d.reads).toEqual([]);
  });

  it("rethrows a listing failure unchanged for the host's error port", async () => {
    const failure = new Error("private store failure");
    const d = deps({ listPageResponses: async () => { throw failure; } });
    await expect(pageListRoute.handle({ input: {}, deps: d, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toBe(failure);
  });

  it("fails closed when mounted without an authorizer", async () => {
    const d = deps();
    await expect(pageListRoute.handle({ input: {}, deps: d, context: PRINCIPAL, authorize: undefined as never })).rejects.toThrow(/no authorizer/);
    expect(d.reads).toEqual([]);
  });
});
