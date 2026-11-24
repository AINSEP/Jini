import { describe, expect, it } from "vitest";
import type { MediaRecord } from "../../../../media/types.js";
import { MediaValidationError } from "../../../../media/types.js";
import { mediaReplaceRoute } from "../replace.js";
import { fakeMedia, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file POST a replacement file: media.update on the asset, the 404/409/503 lookups before any decode, the body checks, the conflict. */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]).toString("base64");
const BODY = { filename: "new.png", contentType: "image/png", dataBase64: PNG };

function deps(log: string[] = [], options: { row?: MediaRecord | null; capable?: boolean; saved?: MediaRecord | null; maxUploadBytes?: number; fail?: unknown } = {}) {
  const row = options.row === undefined ? fakeMedia({ id: "m-1" }) : options.row;
  const capable = options.capable ?? true;
  return {
    workspaceId: WORKSPACE_ID,
    outwardErrorMessage: ({ error }: { error: Error }) => error.message,
    maxUploadBytes: options.maxUploadBytes ?? 50 * 1024 * 1024,
    mediaRepo: {
      findById: async ({ workspaceId, id }: { workspaceId: string; id: string }) => { log.push(`find:${workspaceId}:${id}`); return row; },
      ...(capable ? { replaceFileIfVersion: async () => null, saveRenditionIfSource: async () => null } : {}),
    },
    replaceFile: async (input: { media: MediaRecord; bytes: Uint8Array; contentType: string; principalId: string; provenance: unknown }) => {
      log.push(`replace:${input.media.id}:${input.contentType}:${input.bytes.byteLength}:${input.principalId}:${JSON.stringify(input.provenance)}`);
      if (options.fail !== undefined) throw options.fail;
      return options.saved === undefined ? fakeMedia({ id: "m-1", version: 4 }) : options.saved;
    },
    describeStored: async (input: { media: MediaRecord; contentType: string; byteLength: number }) => {
      log.push(`describe:${input.media.version}:${input.contentType}:${input.byteLength}`);
      return { media: { id: input.media.id } } as never;
    },
  };
}

function run(body: unknown, d = deps(), authorize = recordingAuthorize().authorize, mediaId = "m-1") {
  return mediaReplaceRoute.handle({ input: { mediaId, body }, deps: d, context: PRINCIPAL, authorize }, { signal });
}

describe("mediaReplaceRoute", () => {
  it("keeps the method, path and default status, and carries the id and body through parse", () => {
    expect(mediaReplaceRoute.method).toBe("post");
    expect(mediaReplaceRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/media/:mediaId/replace");
    expect(mediaReplaceRoute.successStatus).toBeUndefined();
    expect(mediaReplaceRoute.parse({ body: BODY, query: {}, params: { mediaId: "m-1" } })).toEqual({ ok: true, value: { mediaId: "m-1", body: BODY } });
    expect(mediaReplaceRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: { mediaId: "", body: {} } });
  });

  it("asks media.update on the asset first; a denial reads nothing", async () => {
    const log: string[] = [];
    const recorder = recordingAuthorize(["media.update"]);
    await expect(run({}, deps(log), recorder.authorize)).rejects.toThrow("denied media.update");
    expect(recorder.calls).toStrictEqual([{ permission: "media.update", entityType: "media", entityId: "m-1" }]);
    expect(log).toEqual([]);
  });

  it("answers 404, 409 trashed and 503 unavailable before the body is checked", async () => {
    expect(await refusalOf(() => run({}, deps([], { row: null }), undefined, "gone"))).toEqual({ status: 404, body: { error: "media 'gone' was not found" } });
    expect(await refusalOf(() => run({}, deps([], { row: fakeMedia({ status: "trashed" }) })))).toEqual({ status: 409, body: { error: "trashed media cannot be replaced", code: "ENTITY_IN_TRASH" } });
    expect(await refusalOf(() => run({}, deps([], { capable: false })))).toEqual({ status: 503, body: { error: "media file replacement is unavailable", code: "MEDIA_REPLACE_UNAVAILABLE" } });
  });

  it.each([
    [{}, "filename, contentType, and dataBase64 are required"],
    [{ ...BODY, filename: "  " }, "filename, contentType, and dataBase64 are required"],
    [{ ...BODY, contentType: "" }, "filename, contentType, and dataBase64 are required"],
    [{ ...BODY, dataBase64: 7 }, "filename, contentType, and dataBase64 are required"],
    [{ ...BODY, dataBase64: "@@@" }, "dataBase64 is not valid base64"],
    [{ ...BODY, dataBase64: Buffer.from("<html><body>x</body></html>").toString("base64") }, "the file's content (text/html) is not an allowed media type"],
    [{ ...BODY, contentType: "text/html" }, "content type 'text/html' is not allowed for upload"],
  ])("refuses body %j with the flat 400 and never replaces", async (body, error) => {
    const log: string[] = [];
    expect(await refusalOf(() => run(body, deps(log)))).toEqual({ status: 400, body: { error } });
    expect(log).toEqual([`find:${WORKSPACE_ID}:m-1`]);
  });

  it("refuses bytes over the injected cap with its MB copy", async () => {
    expect(await refusalOf(() => run(BODY, deps([], { maxUploadBytes: 1024 * 1024 * 0.00001 })))).toEqual({ status: 400, body: { error: `uploaded file exceeds the ${0.00001} MB size cap` } });
  });

  it("replaces with the sniffed type and upload provenance, then describes the stored asset", async () => {
    const log: string[] = [];
    expect(await run(BODY, deps(log))).toEqual({ ok: true, value: { media: { id: "m-1" } } });
    expect(log).toEqual([`find:${WORKSPACE_ID}:m-1`, `replace:m-1:image/png:16:${PRINCIPAL.id}:{"kind":"upload","path":"new.png"}`, "describe:4:image/png:16"]);
  });

  it("answers 409 MEDIA_REPLACE_CONFLICT when the version moved, a validation error is 400, anything else is rethrown", async () => {
    expect(await refusalOf(() => run(BODY, deps([], { saved: null })))).toEqual({ status: 409, body: { error: "media changed while replacing its file", code: "MEDIA_REPLACE_CONFLICT" } });
    expect(await refusalOf(() => run(BODY, deps([], { fail: new MediaValidationError({ message: "document file replacement is unavailable" }) })))).toEqual({ status: 400, body: { error: "document file replacement is unavailable" } });
    const boom = new Error("disk gone");
    await expect(run(BODY, deps([], { fail: boom }))).rejects.toBe(boom);
  });

  it("fails closed on a mount without an authorizer or principal (wiring bugs)", async () => {
    await expect(mediaReplaceRoute.handle({ input: { mediaId: "m-1", body: BODY }, deps: deps(), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    await expect(mediaReplaceRoute.handle({ input: { mediaId: "m-1", body: BODY }, deps: deps(), authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
  });
});
