import { describe, expect, it } from "vitest";
import { MediaNotFoundError, MediaStillReferencedError } from "../../../../media/types.js";
import { mediaDeleteRoute, type MediaDeleteRouteDeps } from "../delete.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

function deleteDeps(overrides: Partial<MediaDeleteRouteDeps> = {}): MediaDeleteRouteDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls, workspaceId: WORKSPACE_ID, outwardErrorMessage: ({ error }) => error.message,
    purgeMedia: async ({ workspaceId, id }) => { calls.push(`purge ${workspaceId}/${id}`); return { purged: true }; },
    forgetRemovedMedia: async ({ workspaceId, id }) => { calls.push(`forget ${workspaceId}/${id}`); },
    ...overrides,
  };
}

describe("mediaDeleteRoute", () => {
  it("keeps the method, path, status and no body cap, and reads :mediaId with the empty fallback", () => {
    expect([mediaDeleteRoute.method, mediaDeleteRoute.path, mediaDeleteRoute.successStatus, mediaDeleteRoute.maxBodyBytes])
      .toEqual(["delete", "/api/admin/v1/workspaces/:workspaceId/media/:mediaId", undefined, undefined]);
    expect(mediaDeleteRoute.parse(raw({ mediaId: "a1" }))).toEqual({ ok: true, value: { mediaId: "a1" } });
    expect(mediaDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { mediaId: "" } });
  });

  it("authorizes media.delete.force for the asset, purges, then forgets the Trash row", async () => {
    const deps = deleteDeps();
    const { authorize, calls } = recordingAuthorize();
    const result = await mediaDeleteRoute.handle({ input: { mediaId: "a1" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "media.delete.force", entityType: "media", entityId: "a1" }]);
    expect(deps.calls).toEqual([`purge ${WORKSPACE_ID}/a1`, `forget ${WORKSPACE_ID}/a1`]);
    expect(result).toEqual({ ok: true, value: { purged: true } });
  });

  it("maps a still-referenced asset to 409 with the list (before the conflict superclass) and an unknown one to 404", async () => {
    const { authorize } = recordingAuthorize();
    const failWith = (error: Error) => deleteDeps({ purgeMedia: async () => { throw error; } });
    const call = (deps: MediaDeleteRouteDeps) => refusalOf(() => mediaDeleteRoute.handle({ input: { mediaId: "a1" }, deps, context: PRINCIPAL, authorize }));
    expect(await call(failWith(new MediaStillReferencedError({ message: "still used", referencing: ["e1:body"] }))))
      .toEqual({ status: 409, body: { error: "still used", referencing: ["e1:body"] } });
    expect(await call(failWith(new MediaNotFoundError({ message: "media 'a1' was not found" })))).toEqual({ status: 404, body: { error: "media 'a1' was not found" } });
  });

  it("words the 409 and 404 refusals through the host's outwardErrorMessage, never the raw error text", async () => {
    const { authorize } = recordingAuthorize();
    const outwardErrorMessage: MediaDeleteRouteDeps["outwardErrorMessage"] = ({ error }) => `outward:${error.constructor.name}`;
    const failWith = (error: Error) => deleteDeps({ outwardErrorMessage, purgeMedia: async () => { throw error; } });
    const call = (deps: MediaDeleteRouteDeps) => refusalOf(() => mediaDeleteRoute.handle({ input: { mediaId: "a1" }, deps, context: PRINCIPAL, authorize }));
    expect(await call(failWith(new MediaStillReferencedError({ message: "stored text", referencing: ["e1:body"] }))))
      .toEqual({ status: 409, body: { error: "outward:MediaStillReferencedError", referencing: ["e1:body"] } });
    expect(await call(failWith(new MediaNotFoundError({ message: "stored text" })))).toEqual({ status: 404, body: { error: "outward:MediaNotFoundError" } });
  });

  it("purges nothing when authorization refuses and rethrows unmapped errors", async () => {
    const deps = deleteDeps();
    await expect(mediaDeleteRoute.handle({ input: { mediaId: "a1" }, deps, context: PRINCIPAL, authorize: recordingAuthorize(["media.delete.force"]).authorize })).rejects.toThrow("denied");
    expect(deps.calls).toEqual([]);
    const boom = deleteDeps({ forgetRemovedMedia: async () => { throw new Error("index gone"); } });
    await expect(mediaDeleteRoute.handle({ input: { mediaId: "a1" }, deps: boom, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("index gone");
    await expect(mediaDeleteRoute.handle({ input: { mediaId: "a1" }, deps })).rejects.toThrow(/no authorizer/);
  });
});
