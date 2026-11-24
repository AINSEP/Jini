import { describe, expect, it } from "vitest";
import { mediaWhereUsedRoute } from "../where-used.js";
import { fakeMedia, PRINCIPAL, signal, WORKSPACE_ID } from "./helpers.js";

/** @file GET where a media asset is used: media.read on the `media` type (no entity id), the 404, the injected finder. */

function deps(log: string[] = [], found = true) {
  return {
    workspaceId: WORKSPACE_ID,
    mediaRepo: { findById: async ({ workspaceId, id }: { workspaceId: string; id: string }) => { log.push(`find:${workspaceId}:${id}`); return found ? fakeMedia({ id: "m-1", slug: "hero" }) : null; } },
    findWhereUsed: async (input: { workspaceId: string; mediaId: string; slug: string }) => { log.push(`where:${JSON.stringify(input)}`); return [{ kind: "post", id: "p-1" }]; },
  };
}

function verbatimAuthorize(deny = false) {
  const calls: unknown[] = [];
  return { calls, authorize: async (...args: unknown[]) => { calls.push(args); if (deny) throw new Error("denied media.read"); } };
}

describe("mediaWhereUsedRoute", () => {
  it("keeps the method, path and default status and reads the id with the `?? \"\"` fallback", () => {
    expect(mediaWhereUsedRoute.method).toBe("get");
    expect(mediaWhereUsedRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/media/:mediaId/where-used");
    expect(mediaWhereUsedRoute.successStatus).toBeUndefined();
    expect(mediaWhereUsedRoute.maxBodyBytes).toBeUndefined();
    expect(mediaWhereUsedRoute.parse({ body: {}, query: {}, params: { mediaId: "m-1" } })).toEqual({ ok: true, value: { mediaId: "m-1" } });
    expect(mediaWhereUsedRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: { mediaId: "" } });
  });

  it("asks media.read on the media type with no entity id, and a denial reads nothing", async () => {
    const log: string[] = [];
    const denied = verbatimAuthorize(true);
    await expect(mediaWhereUsedRoute.handle({ input: { mediaId: "m-1" }, deps: deps(log), context: PRINCIPAL, authorize: denied.authorize }, { signal })).rejects.toThrow("denied media.read");
    expect(denied.calls).toStrictEqual([[{ permission: "media.read", entityType: "media" }]]);
    expect(log).toEqual([]);
  });

  it("answers the flat 404 for an unknown asset, without asking the finder", async () => {
    const log: string[] = [];
    await expect(mediaWhereUsedRoute.handle({ input: { mediaId: "gone" }, deps: deps(log, false), context: PRINCIPAL, authorize: verbatimAuthorize().authorize }))
      .rejects.toMatchObject({ response: { status: 404, body: { error: "media was not found" } } });
    expect(log).toEqual([`find:${WORKSPACE_ID}:gone`]);
  });

  it("answers the asset id and the injected finder's usages for the stored id and slug", async () => {
    const log: string[] = [];
    const result = await mediaWhereUsedRoute.handle({ input: { mediaId: "hero" }, deps: deps(log), context: PRINCIPAL, authorize: verbatimAuthorize().authorize });
    expect(result).toEqual({ ok: true, value: { mediaId: "m-1", whereUsed: [{ kind: "post", id: "p-1" }] } });
    expect(log).toEqual([`find:${WORKSPACE_ID}:hero`, `where:${JSON.stringify({ workspaceId: WORKSPACE_ID, mediaId: "m-1", slug: "hero" })}`]);
  });

  it("fails closed on a mount without an authorizer (a wiring bug)", async () => {
    await expect(mediaWhereUsedRoute.handle({ input: { mediaId: "m-1" }, deps: deps(), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
