import { describe, expect, it } from "vitest";
import { EntityNotLiveError } from "../../../../core/entity-liveness.js";
import { MediaConflictError } from "../../../../media/types.js";
import { mediaUpdateRoute, type MediaUpdateRouteDeps } from "../update.js";
import { fakeMedia, fakeMediaDto, LOOKUPS, mediaRepoWith, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const LATER = "2026-10-09T00:00:00.000Z";
function updateDeps(overrides: Partial<MediaUpdateRouteDeps> = {}): MediaUpdateRouteDeps {
  return { workspaceId: WORKSPACE_ID, mediaRepo: mediaRepoWith(), clock: { nowMs: () => Date.parse(LATER) }, ...LOOKUPS, outwardErrorMessage: ({ error }) => error.message, ...overrides };
}
const run = (body: unknown, deps = updateDeps(), authorize = recordingAuthorize().authorize) =>
  mediaUpdateRoute.handle({ input: { mediaId: "a1", body }, deps, context: PRINCIPAL, authorize }, { signal });

describe("mediaUpdateRoute", () => {
  it("keeps the method, path, status and no body cap, and defers the body to after authorization", () => {
    expect([mediaUpdateRoute.method, mediaUpdateRoute.path, mediaUpdateRoute.successStatus, mediaUpdateRoute.maxBodyBytes])
      .toEqual(["patch", "/api/admin/v1/workspaces/:workspaceId/media/:mediaId", undefined, undefined]);
    expect(mediaUpdateRoute.parse(raw({ mediaId: "a1" }, { title: 5 }))).toEqual({ ok: true, value: { mediaId: "a1", body: { title: 5 } } });
    expect(mediaUpdateRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { mediaId: "", body: undefined } });
  });

  it("authorizes media.update for the asset and answers the updated asset through the real service", async () => {
    const { authorize, calls } = recordingAuthorize();
    const result = await run({ alt: "A hero", width: "640", cssClass: null }, updateDeps(), authorize);
    expect(calls).toEqual([{ permission: "media.update", entityType: "media", entityId: "a1" }]);
    expect(result).toEqual({ ok: true, value: { media: { ...fakeMediaDto(), alt: "A hero", width: 640, cssClass: null, updatedAt: LATER, version: 4 } } });
  });

  it("treats a missing body as every field omitted", async () => {
    expect(await run(undefined)).toEqual({ ok: true, value: { media: { ...fakeMediaDto(), updatedAt: LATER, version: 4 } } });
  });

  it("maps validation 400, unknown 404, slug conflict 409 and a trashed asset's own-code 409", async () => {
    expect(await refusalOf(() => run({ alt: 7 }))).toEqual({ status: 400, body: { error: expect.stringContaining("alt") } });
    expect(await refusalOf(() => run({}, updateDeps({ mediaRepo: mediaRepoWith([]) })))).toEqual({ status: 404, body: { error: "media 'a1' was not found" } });
    const conflictRepo = mediaRepoWith([fakeMedia(), fakeMedia({ id: "a2", slug: "taken" })]);
    expect(await refusalOf(() => run({ slug: "taken" }, updateDeps({ mediaRepo: conflictRepo })))).toMatchObject({ status: 409, body: { error: expect.any(String) } });
    const notLive = new EntityNotLiveError({ entityType: "media", entityId: "a1", state: "trashed" });
    expect(await refusalOf(() => run({}, updateDeps({ readContentType: async () => { throw notLive; } }))))
      .toEqual({ status: 409, body: { error: notLive.message, code: "ENTITY_IN_TRASH" } });
  });

  it("maps a conflict thrown by a lookup, rethrows unmapped errors and writes nothing when refused", async () => {
    const conflict = updateDeps({ resolveByteSize: async () => { throw new MediaConflictError({ message: "race" }); } });
    expect(await refusalOf(() => run({}, conflict))).toEqual({ status: 409, body: { error: "race" } });
    await expect(run({}, updateDeps({ resolvePublicUrl: async () => { throw new Error("registry gone"); } }))).rejects.toThrow("registry gone");
    const deps = updateDeps();
    await expect(run({ alt: "x" }, deps, recordingAuthorize(["media.update"]).authorize)).rejects.toThrow("denied");
    expect((await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "a1" }))?.alt).toBe("");
  });

  it("stores a PATCH description, clears it with blank or null, and leaves it alone when omitted", async () => {
    const deps = updateDeps();
    const stored = () => deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "a1" }).then((m) => m?.description);
    await run({ description: "  A fox on a hill.  " }, deps);
    expect(await stored()).toBe("A fox on a hill.");
    await run({ alt: "unrelated edit" }, deps);
    expect(await stored()).toBe("A fox on a hill.");
    await run({ description: "" }, deps);
    expect(await stored()).toBe("");
    await run({ description: "again" }, deps);
    await run({ description: null }, deps);
    expect(await stored()).toBe("");
  });

  it("refuses a non-string or over-long PATCH description with the service's own 400 and writes nothing", async () => {
    const deps = updateDeps();
    expect(await refusalOf(() => run({ description: 7 }, deps))).toEqual({ status: 400, body: { error: expect.stringContaining("description") } });
    expect(await refusalOf(() => run({ description: "x".repeat(2001) }, deps))).toEqual({ status: 400, body: { error: expect.stringContaining("MEDIA_MAX_DESCRIPTION_LENGTH") } });
    expect((await deps.mediaRepo.findById({ workspaceId: WORKSPACE_ID, id: "a1" }))?.description).toBeUndefined();
    expect(await run({ description: "x".repeat(2000) }, deps)).toMatchObject({ ok: true });
  });
});
