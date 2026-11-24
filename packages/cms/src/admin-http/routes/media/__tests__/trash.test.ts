import { describe, expect, it } from "vitest";
import { mediaTrashRoute, type MediaRemoveFn, type MediaTrashRouteDeps } from "../trash.js";
import { fakeMedia, fakeMediaDto, LOOKUPS, mediaRepoWith, NOW, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

function trashDeps(overrides: Partial<MediaTrashRouteDeps> = {}): MediaTrashRouteDeps & { removed: unknown[] } {
  const removed: unknown[] = [];
  return {
    removed, workspaceId: WORKSPACE_ID, mediaRepo: mediaRepoWith(), clock: { nowIso: () => NOW }, ...LOOKUPS,
    removeMedia: async (input) => { removed.push(input); return { ok: true }; },
    ...overrides,
  };
}

describe("mediaTrashRoute", () => {
  it("keeps the method, path, status and no body cap, and reads :mediaId with the empty fallback", () => {
    expect([mediaTrashRoute.method, mediaTrashRoute.path, mediaTrashRoute.successStatus, mediaTrashRoute.maxBodyBytes])
      .toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/media/:mediaId/trash", undefined, undefined]);
    expect(mediaTrashRoute.parse(raw({ mediaId: "a1" }))).toEqual({ ok: true, value: { mediaId: "a1" } });
    expect(mediaTrashRoute.parse(raw({}))).toEqual({ ok: true, value: { mediaId: "" } });
  });

  it("authorizes media.delete for the asset, flips the marker as the principal and answers the re-read asset", async () => {
    const deps = trashDeps();
    const { authorize, calls } = recordingAuthorize();
    const result = await mediaTrashRoute.handle({ input: { mediaId: "a1" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "media.delete", entityType: "media", entityId: "a1" }]);
    expect(deps.removed).toEqual([{ workspaceId: WORKSPACE_ID, id: "a1", display: { title: "Hero", subtitle: "hero" }, at: NOW, expectedVersion: 3, actor: { principalId: PRINCIPAL.id } }]);
    expect(result).toEqual({ ok: true, value: { media: fakeMediaDto() } });
  });

  it("answers 404 for an unknown asset, a vanished row, and a re-read miss; 409 for a lost race", async () => {
    const { authorize } = recordingAuthorize();
    const call = (deps: MediaTrashRouteDeps) => refusalOf(() => mediaTrashRoute.handle({ input: { mediaId: "a1" }, deps, context: PRINCIPAL, authorize }));
    const notFound = { status: 404, body: { error: "media 'a1' was not found" } };
    expect(await call(trashDeps({ mediaRepo: mediaRepoWith([]) }))).toEqual(notFound);
    const refuse = (reason: string): MediaRemoveFn => async () => ({ ok: false, reason });
    expect(await call(trashDeps({ removeMedia: refuse("not-found") }))).toEqual(notFound);
    expect(await call(trashDeps({ removeMedia: refuse("version-conflict") }))).toEqual({ status: 409, body: { error: "media 'a1' changed while it was being trashed" } });
    let reads = 0;
    const flaky = { findById: async () => (reads++ === 0 ? fakeMedia() : null) };
    expect(await call(trashDeps({ mediaRepo: flaky }))).toEqual(notFound);
  });

  it("touches nothing when authorization refuses, rethrows unmapped errors, and fails closed without principal/authorizer", async () => {
    const deps = trashDeps();
    await expect(mediaTrashRoute.handle({ input: { mediaId: "a1" }, deps, context: PRINCIPAL, authorize: recordingAuthorize(["media.delete"]).authorize })).rejects.toThrow("denied");
    expect(deps.removed).toEqual([]);
    const boom = trashDeps({ removeMedia: async () => { throw new Error("disk gone"); } });
    await expect(mediaTrashRoute.handle({ input: { mediaId: "a1" }, deps: boom, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("disk gone");
    await expect(mediaTrashRoute.handle({ input: { mediaId: "a1" }, deps, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
    await expect(mediaTrashRoute.handle({ input: { mediaId: "a1" }, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
