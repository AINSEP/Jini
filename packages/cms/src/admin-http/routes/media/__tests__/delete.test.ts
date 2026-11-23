import { describe, expect, it } from "vitest";
import { MediaNotFoundError, MediaStillReferencedError } from "../../../../media/types.js";
import { mediaDeleteRoute, type MediaDeleteRouteDeps } from "../delete.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

function deps(overrides: Partial<MediaDeleteRouteDeps> = {}): MediaDeleteRouteDeps & { purges: unknown[]; forgets: unknown[] } {
  const purges: unknown[] = [];
  const forgets: unknown[] = [];
  return {
    purges, forgets, workspaceId: WORKSPACE_ID,
    purgeMedia: async (input) => { purges.push(input); return { purged: true }; },
    forgetRemovedMedia: async (input) => { forgets.push(input); },
    ...overrides,
  };
}

describe("mediaDeleteRoute", () => {
  it("keeps the method and path and reads :mediaId, falling back to an empty id", () => {
    expect(mediaDeleteRoute.method).toBe("delete");
    expect(mediaDeleteRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/media/:mediaId");
    expect(mediaDeleteRoute.parse(raw({ mediaId: "asset-1" }))).toEqual({ ok: true, value: { mediaId: "asset-1" } });
    expect(mediaDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { mediaId: "" } });
  });

  it("authorizes media.delete.force for the asset, purges it and forgets its Trash row", async () => {
    const { authorize, calls } = recordingAuthorize();
    const d = deps();
    const result = await mediaDeleteRoute.handle({ input: { mediaId: "asset-1" }, deps: d, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "media.delete.force", entityType: "media", entityId: "asset-1" }]);
    expect(d.purges).toEqual([{ workspaceId: WORKSPACE_ID, id: "asset-1" }]);
    expect(d.forgets).toEqual([{ workspaceId: WORKSPACE_ID, id: "asset-1" }]);
    expect(result).toEqual({ ok: true, value: { purged: true } });
  });

  it("refuses a still-referenced asset with 409 and the referencing list, forgetting nothing", async () => {
    const { authorize } = recordingAuthorize();
    const d = deps({ purgeMedia: async () => { throw new MediaStillReferencedError({ message: "media 'asset-1' must be trashed before it can be purged", referencing: ["media 'asset-1' is still active"] }); } });
    expect(await refusalOf(() => mediaDeleteRoute.handle({ input: { mediaId: "asset-1" }, deps: d, context: PRINCIPAL, authorize }))).toEqual({
      status: 409, body: { error: "media 'asset-1' must be trashed before it can be purged", referencing: ["media 'asset-1' is still active"] },
    });
    expect(d.forgets).toEqual([]);
  });

  it("refuses an unknown asset with 404 and the domain message", async () => {
    const { authorize } = recordingAuthorize();
    const d = deps({ purgeMedia: async () => { throw new MediaNotFoundError({ message: "media 'missing' was not found" }); } });
    expect(await refusalOf(() => mediaDeleteRoute.handle({ input: { mediaId: "missing" }, deps: d, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "media 'missing' was not found" },
    });
  });

  it("rethrows any other failure unchanged for the host's error port", async () => {
    const { authorize } = recordingAuthorize();
    const failure = new Error("private store failure");
    const d = deps({ forgetRemovedMedia: async () => { throw failure; } });
    await expect(mediaDeleteRoute.handle({ input: { mediaId: "asset-1" }, deps: d, context: PRINCIPAL, authorize })).rejects.toBe(failure);
  });

  it("does not purge when authorization refuses", async () => {
    const d = deps();
    await expect(mediaDeleteRoute.handle({ input: { mediaId: "asset-1" }, deps: d, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
    expect(d.purges).toEqual([]);
  });
});
