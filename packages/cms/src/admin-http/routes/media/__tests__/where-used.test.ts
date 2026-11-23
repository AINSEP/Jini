import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { mediaWhereUsedRoute, type MediaWhereUsedRouteDeps } from "../where-used.js";
import { fakeMedia, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const USAGE = { count: 1, references: [{ sourceEntryId: "post-1" }] };

/** Fakes that record every asset lookup and usage query, so a refused request can prove it read nothing. */
function deps({ media = fakeMedia() }: { media?: ReturnType<typeof fakeMedia> | null } = {}): MediaWhereUsedRouteDeps & { lookups: unknown[]; queries: unknown[] } {
  const lookups: unknown[] = [];
  const queries: unknown[] = [];
  return {
    lookups, queries, workspaceId: WORKSPACE_ID,
    mediaRepo: { findById: async (input) => { lookups.push(input); return media; } },
    findWhereUsed: async (input) => { queries.push(input); return USAGE; },
  };
}

/** The refusal the host's authorize port throws for a denied permission (its full 403 body). */
const portForbidden = async () => {
  throw new RouteRefusalError({ status: 403, body: { error: "principal 'p' is not authorized for 'media.read' (no_role)", code: "FORBIDDEN", details: { permission: "media.read", reason: "no_role" } } });
};

describe("mediaWhereUsedRoute", () => {
  it("keeps the method and path and reads :mediaId, falling back to an empty id", () => {
    expect(mediaWhereUsedRoute.method).toBe("get");
    expect(mediaWhereUsedRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/media/:mediaId/where-used");
    expect(mediaWhereUsedRoute.parse(raw({ mediaId: "asset-1" }))).toEqual({ ok: true, value: { mediaId: "asset-1" } });
    expect(mediaWhereUsedRoute.parse(raw({}))).toEqual({ ok: true, value: { mediaId: "" } });
  });

  it("authorizes media.read id-free, then queries usage by the stored id and slug", async () => {
    const { authorize, calls } = recordingAuthorize();
    const d = deps({ media: fakeMedia({ id: "canonical-1", slug: "photo" }) });
    const result = await mediaWhereUsedRoute.handle({ input: { mediaId: "asset-1" }, deps: d, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "media.read", entityType: "media" }]);
    expect(d.lookups).toEqual([{ workspaceId: WORKSPACE_ID, id: "asset-1" }]);
    expect(d.queries).toEqual([{ workspaceId: WORKSPACE_ID, mediaId: "canonical-1", slug: "photo" }]);
    expect(result).toEqual({ ok: true, value: { mediaId: "canonical-1", whereUsed: USAGE } });
  });

  it("refuses an unknown asset with its own 404 body and never queries usage", async () => {
    const { authorize } = recordingAuthorize();
    const d = deps({ media: null });
    expect(await refusalOf(() => mediaWhereUsedRoute.handle({ input: { mediaId: "missing" }, deps: d, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "media was not found" },
    });
    expect(d.queries).toEqual([]);
  });

  it("answers a refused media.read with the route's own short 403 body, before any lookup", async () => {
    const d = deps();
    expect(await refusalOf(() => mediaWhereUsedRoute.handle({ input: { mediaId: "asset-1" }, deps: d, context: PRINCIPAL, authorize: portForbidden }))).toEqual({
      status: 403, body: { error: "media.read is required", code: "FORBIDDEN" },
    });
    expect(d.lookups).toEqual([]);
  });

  it("rethrows any other authorizer failure unchanged", async () => {
    const d = deps();
    await expect(mediaWhereUsedRoute.handle({ input: { mediaId: "asset-1" }, deps: d, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
    const notFound = async () => { throw new RouteRefusalError({ status: 404, body: { error: "workspace was not found" } }); };
    expect(await refusalOf(() => mediaWhereUsedRoute.handle({ input: { mediaId: "asset-1" }, deps: d, context: PRINCIPAL, authorize: notFound }))).toEqual({
      status: 404, body: { error: "workspace was not found" },
    });
    expect(d.lookups).toEqual([]);
  });
});
