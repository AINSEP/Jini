import { describe, expect, it } from "vitest";
import { MediaConflictError, MediaValidationError, type MediaRecord } from "../../../../media/types.js";
import { mediaUploadRoute, type MediaUploadInput } from "../upload.js";
import { fakeMedia, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file POST a new upload: body checks first (400s), then media.upload on the type, decode, store, record, report, describe. */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]).toString("base64");
const BODY = { filename: "a.png", contentType: "image/png", dataBase64: PNG };
const FIELDS = { kind: "media", filename: "a.png", contentType: "image/png", dataBase64: PNG, alt: undefined, caption: undefined, credit: undefined };

function deps(log: string[] = [], options: { fail?: unknown; stored?: MediaRecord } = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    outwardErrorMessage: ({ error }: { error: Error }) => error.message,
    storeUpload: async (input: MediaUploadInput) => {
      log.push(`store:${input.kind}:${input.filename}:${input.contentType}:${input.bytes.byteLength}:${input.alt}:${input.caption}:${input.credit}:${input.createdByPrincipal}`);
      if (options.fail !== undefined) throw options.fail;
      return { media: options.stored ?? fakeMedia({ id: "m-9" }) };
    },
    recordContentType: async ({ sha256, contentType }: { sha256: string; contentType: string }) => { log.push(`record:${sha256.slice(0, 2)}:${contentType}`); },
    onUploaded: ({ actorId, kind, contentType, byteLength }: { actorId: string; kind: string; contentType: string; byteLength: number }) => { log.push(`uploaded:${actorId}:${kind}:${contentType}:${byteLength}`); },
    describeStored: async (input: { media: MediaRecord; contentType: string; byteLength: number }) => {
      log.push(`describe:${input.media.id}:${input.contentType}:${input.byteLength}`);
      return { media: { id: input.media.id } } as never;
    },
  };
}

function parse(body: unknown) {
  return mediaUploadRoute.parse({ body, query: {}, params: {} });
}

function run(fields: unknown, d = deps(), authorize = recordingAuthorize().authorize) {
  return mediaUploadRoute.handle({ input: { fields } as never, deps: d, context: PRINCIPAL, authorize }, { signal });
}

describe("mediaUploadRoute", () => {
  it("keeps the method, path and 201", () => {
    expect(mediaUploadRoute.method).toBe("post");
    expect(mediaUploadRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/media");
    expect(mediaUploadRoute.successStatus).toBe(201);
  });

  it("parses the fields, with media as the default kind and null metadata as absent", () => {
    expect(parse(BODY)).toEqual({ ok: true, value: { fields: FIELDS } });
    expect(parse({ ...BODY, kind: "document", contentType: undefined, alt: null, caption: "c", credit: "d" })).toEqual({ ok: true, value: { fields: { ...FIELDS, kind: "document", contentType: "", alt: "", caption: "c", credit: "d" } } });
  });

  it.each([
    [undefined, "filename, contentType, and dataBase64 are required"],
    [{ ...BODY, filename: 3 }, "filename, contentType, and dataBase64 are required"],
    [{ ...BODY, contentType: "" }, "filename, contentType, and dataBase64 are required"],
    [{ ...BODY, dataBase64: "" }, "filename, contentType, and dataBase64 are required"],
    [{ ...BODY, kind: "video" }, "invalid media kind"],
    [{ ...BODY, alt: 5 }, "media.alt must be a string or null, got number"],
  ])("refuses body %j in parse with the flat 400", async (body, error) => {
    expect(await refusalOf(async () => { const parsed = parse(body); if (!parsed.ok) throw new Error("unexpected parse failure"); return mediaUploadRoute.handle({ input: parsed.value, deps: deps(), context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal }); })).toEqual({ status: 400, body: { error } });
  });

  it("asks media.upload on the media type (no entity id) before decoding; a denial stores nothing", async () => {
    const log: string[] = [];
    const recorder = recordingAuthorize(["media.upload"]);
    await expect(run({ ...FIELDS, dataBase64: "@@@" }, deps(log), recorder.authorize)).rejects.toThrow("denied media.upload");
    expect(recorder.calls).toStrictEqual([{ permission: "media.upload", entityType: "media" }]);
    expect(log).toEqual([]);
  });

  it("refuses invalid base64 and an over-long document payload with the flat 400 before storing", async () => {
    const log: string[] = [];
    expect(await refusalOf(() => run({ ...FIELDS, dataBase64: "@@@" }, deps(log)))).toEqual({ status: 400, body: { error: "dataBase64 is not valid base64" } });
    const huge = "A".repeat(4 * Math.ceil((50 * 1024 * 1024) / 3) + 4);
    expect(await refusalOf(() => run({ ...FIELDS, kind: "document", filename: "a.txt", dataBase64: huge }, deps(log)))).toEqual({ status: 400, body: { error: "document exceeds the 50 MiB limit" } });
    expect(log).toEqual([]);
  });

  it("stores the sniffed media type, records it, reports the upload and describes it", async () => {
    const log: string[] = [];
    expect(await run({ ...FIELDS, contentType: "image/jpeg", alt: "A" }, deps(log))).toEqual({ ok: true, value: { media: { id: "m-9" } } });
    expect(log).toEqual([
      `store:media:a.png:image/png:16:A:undefined:undefined:${PRINCIPAL.id}`, "record:ff:image/png",
      `uploaded:${PRINCIPAL.id}:media:image/png:16`, "describe:m-9:image/png:16",
    ]);
  });

  it("types a document by its filename and records no sniffed type", async () => {
    const log: string[] = [];
    const text = Buffer.from("# hi").toString("base64");
    await run({ ...FIELDS, kind: "document", filename: "notes.md", contentType: "", dataBase64: text }, deps(log));
    expect(log).toEqual([`store:document:notes.md:text/markdown:4:undefined:undefined:undefined:${PRINCIPAL.id}`, `uploaded:${PRINCIPAL.id}:document:text/markdown:4`, "describe:m-9:text/markdown:4"]);
  });

  it("maps a slug race to 409 and a validation error to 400 (own messages); anything else is rethrown", async () => {
    expect(await refusalOf(() => run(FIELDS, deps([], { fail: new MediaConflictError({ message: "slug taken" }) })))).toEqual({ status: 409, body: { error: "slug taken" } });
    expect(await refusalOf(() => run(FIELDS, deps([], { fail: new MediaValidationError({ message: "too big" }) })))).toEqual({ status: 400, body: { error: "too big" } });
    const boom = new Error("disk gone");
    await expect(run(FIELDS, deps([], { fail: boom }))).rejects.toBe(boom);
  });

  it("fails closed on a mount without an authorizer or principal (wiring bugs)", async () => {
    await expect(mediaUploadRoute.handle({ input: { fields: FIELDS } as never, deps: deps(), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    await expect(mediaUploadRoute.handle({ input: { fields: FIELDS } as never, deps: deps(), authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
  });
});
