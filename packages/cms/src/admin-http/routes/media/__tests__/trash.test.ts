import { describe, expect, it } from "vitest";
import type { MediaRecord } from "../../../../media/types.js";
import { mediaTrashRoute, type MediaTrashRouteDeps } from "../trash.js";
import { fakeMedia, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const NOW = "2026-11-23T00:00:00.000Z";

/** Fakes whose repo answers `reads` in order (the pre-flip read, then the re-read). */
function deps({ reads = [fakeMedia(), fakeMedia({ status: "trashed", version: 4 } as Partial<MediaRecord>)], removed = { ok: true as const } }: {
  reads?: Array<MediaRecord | null>; removed?: { ok: true } | { ok: false; reason: string };
} = {}): MediaTrashRouteDeps & { removals: unknown[]; lookups: unknown[] } {
  const removals: unknown[] = [];
  const lookups: unknown[] = [];
  const queue = [...reads];
  return {
    removals, lookups, workspaceId: WORKSPACE_ID,
    mediaRepo: { findById: async (input) => { lookups.push(input); return queue.shift() ?? null; } },
    removeMedia: async (input) => { removals.push(input); return removed; },
    clock: { nowIso: () => NOW },
    toMediaResponse: async ({ media }) => ({ id: media.id, version: media.version, shaped: true }),
  };
}

describe("mediaTrashRoute", () => {
  it("keeps the method and path and reads :mediaId, falling back to an empty id", () => {
    expect(mediaTrashRoute.method).toBe("post");
    expect(mediaTrashRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/media/:mediaId/trash");
    expect(mediaTrashRoute.parse(raw({ mediaId: "asset-1" }))).toEqual({ ok: true, value: { mediaId: "asset-1" } });
    expect(mediaTrashRoute.parse(raw({}))).toEqual({ ok: true, value: { mediaId: "" } });
  });

  it("authorizes media.delete for the asset, flips the marker with a column-only snapshot and answers the re-read", async () => {
    const { authorize, calls } = recordingAuthorize();
    const d = deps();
    const result = await mediaTrashRoute.handle({ input: { mediaId: "asset-1" }, deps: d, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "media.delete", entityType: "media", entityId: "asset-1" }]);
    expect(d.removals).toEqual([{
      workspaceId: WORKSPACE_ID, id: "asset-1", display: { title: "Sunset", subtitle: "sunset" }, at: NOW, expectedVersion: 3, actor: { principalId: PRINCIPAL.id },
    }]);
    expect(d.lookups).toEqual([{ workspaceId: WORKSPACE_ID, id: "asset-1" }, { workspaceId: WORKSPACE_ID, id: "asset-1" }]);
    expect(result).toEqual({ ok: true, value: { media: { id: "asset-1", version: 4, shaped: true } } });
  });

  it("refuses an unknown asset with 404 before any flip", async () => {
    const { authorize } = recordingAuthorize();
    const d = deps({ reads: [null] });
    expect(await refusalOf(() => mediaTrashRoute.handle({ input: { mediaId: "missing" }, deps: d, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "media 'missing' was not found" },
    });
    expect(d.removals).toEqual([]);
  });

  it("maps a not-found flip to 404 and any other refused flip to 409", async () => {
    const { authorize } = recordingAuthorize();
    const gone = deps({ removed: { ok: false, reason: "not-found" } });
    expect(await refusalOf(() => mediaTrashRoute.handle({ input: { mediaId: "asset-1" }, deps: gone, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "media 'asset-1' was not found" },
    });
    const raced = deps({ removed: { ok: false, reason: "version-changed" } });
    expect(await refusalOf(() => mediaTrashRoute.handle({ input: { mediaId: "asset-1" }, deps: raced, context: PRINCIPAL, authorize }))).toEqual({
      status: 409, body: { error: "media 'asset-1' changed while it was being trashed" },
    });
  });

  it("refuses with 404 when the asset vanished between the flip and the re-read", async () => {
    const { authorize } = recordingAuthorize();
    const d = deps({ reads: [fakeMedia(), null] });
    expect(await refusalOf(() => mediaTrashRoute.handle({ input: { mediaId: "asset-1" }, deps: d, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "media 'asset-1' was not found" },
    });
  });

  it("does not read or flip when authorization refuses", async () => {
    const d = deps();
    await expect(mediaTrashRoute.handle({ input: { mediaId: "asset-1" }, deps: d, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
    expect(d.lookups).toEqual([]);
    expect(d.removals).toEqual([]);
  });

  it("refuses to run without an authenticated principal", async () => {
    const { authorize } = recordingAuthorize();
    await expect(mediaTrashRoute.handle({ input: { mediaId: "asset-1" }, deps: deps(), authorize })).rejects.toThrow("media admin route has no authenticated principal");
  });
});
