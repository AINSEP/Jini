import { describe, expect, it } from "vitest";

import { MediaImportValidationError } from "../../../../media/import/fetch-image.js";
import { MediaValidationError, type MediaRecord } from "../../../../media/types.js";
import { mediaImportUrlRoute, type MediaImportUrlRouteDeps } from "../import-url.js";
import { fakeMedia, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file POST import-url: media.upload on the `media` type first, then input validation, the injected
 *  guarded fetch, upload, recorded type and public URL; the egress / validation refusal ladder. */

const PNG = new Uint8Array([137, 80, 78, 71]);
const SOURCE = new URL("https://cdn.example/photos/Sunset%20View.png");

class FakeEgressRefusal extends Error {}

/** The raw input the host hands `parse`; built here because the shared helper defaults an absent body to `{}`. */
const raw = (params: Record<string, string>, body: unknown) => ({ body, query: {}, params });

function deps(log: unknown[] = [], overrides: Partial<MediaImportUrlRouteDeps> = {}): MediaImportUrlRouteDeps {
  return {
    workspaceId: WORKSPACE_ID,
    fetchImage: async ({ url }) => { log.push(["fetch", url]); return { bytes: PNG, contentType: "image/png", url: SOURCE }; },
    uploadMedia: async (input) => { log.push(["upload", input]); return { media: fakeMedia({ id: "m-9", slug: "sunset-view", title: "Sunset" }) as MediaRecord }; },
    recordContentType: async (input) => { log.push(["record", input]); },
    resolvePublicUrl: async ({ media }) => { log.push(["url", media.id]); return `/m/${media.slug}/public`; },
    egressRefusalMessage: ({ error }) => (error instanceof FakeEgressRefusal ? "Target is not public" : undefined),
    ...overrides,
  };
}

const handle = (body: unknown, d: MediaImportUrlRouteDeps, authorize = recordingAuthorize().authorize) =>
  mediaImportUrlRoute.handle({ input: mediaImportUrlParsed(body), deps: d, context: PRINCIPAL, authorize }, { signal });

function mediaImportUrlParsed(body: unknown) {
  const parsed = mediaImportUrlRoute.parse(raw({ workspaceId: WORKSPACE_ID }, body));
  if (!parsed.ok) throw new Error("parse must defer validation until after authorization");
  return parsed.value;
}

describe("mediaImportUrlRoute", () => {
  it("keeps the method, path and 201, and parse defers every body check (no refusal before authorization)", () => {
    expect(mediaImportUrlRoute.method).toBe("post");
    expect(mediaImportUrlRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/media/import-url");
    expect(mediaImportUrlRoute.successStatus).toBe(201);
    expect(mediaImportUrlRoute.maxBodyBytes).toBeUndefined();
    for (const body of [undefined, null, [], "x", { url: 1 }]) expect(mediaImportUrlRoute.parse(raw({}, body))).toEqual({ ok: true, value: { body } });
  });

  it("asks media.upload on the media type with no entity id, and a denial fetches nothing", async () => {
    const log: unknown[] = [];
    const denied = recordingAuthorize(["media.upload"]);
    await expect(handle({ url: "https://cdn.example/a.png" }, deps(log), denied.authorize)).rejects.toThrow("denied media.upload");
    expect(denied.calls).toStrictEqual([{ permission: "media.upload", entityType: "media" }]);
    expect(log).toEqual([]);
  });

  it("refuses a malformed body with the flat `url is required` 400 before any fetch", async () => {
    for (const body of [undefined, null, [], "https://example.com/a.png", {}, { url: " " }, { url: 1 }]) {
      const log: unknown[] = [];
      expect(await refusalOf(() => handle(body, deps(log)))).toEqual({ status: 400, body: { error: "url is required" } });
      expect(log).toEqual([]);
    }
  });

  it("refuses a non-string metadata field with the validation message (400), before any fetch", async () => {
    const log: unknown[] = [];
    expect(await refusalOf(() => handle({ url: "https://cdn.example/a.png", alt: 42 }, deps(log))))
      .toEqual({ status: 400, body: { error: "media.alt must be a string or null, got number" } });
    expect(log).toEqual([]);
  });

  it("fetches the trimmed URL, uploads the bytes with the derived filename, records the sniffed type, answers the DTO", async () => {
    const log: unknown[] = [];
    const result = await handle({ url: "  https://cdn.example/photos/a.png ", alt: "A fox", caption: null, credit: "Me" }, deps(log));
    expect(log).toEqual([
      ["fetch", "https://cdn.example/photos/a.png"],
      ["upload", { bytes: PNG, contentType: "image/png", filename: "Sunset-View.png", alt: "A fox", caption: "", credit: "Me", createdByPrincipal: PRINCIPAL.id }],
      ["record", { sha256: "f".repeat(64), contentType: "image/png" }],
      ["url", "m-9"],
    ]);
    expect(result).toMatchObject({ ok: true, value: { media: { id: "m-9", contentType: "image/png", publicUrl: "/m/sunset-view/public", byteSize: PNG.byteLength } } });
  });

  it("an explicit filename overrides the URL's last segment; an absent one passes no metadata keys' values", async () => {
    const log: unknown[] = [];
    await handle({ url: "https://cdn.example/a.png", filename: "My Photo.jpg" }, deps(log));
    expect(log[1]).toEqual(["upload", { bytes: PNG, contentType: "image/png", filename: "My-Photo.png", alt: undefined, caption: undefined, credit: undefined, createdByPrincipal: PRINCIPAL.id }]);
  });

  it("answers an egress refusal with only the host's caller-safe message, and persists nothing", async () => {
    const log: unknown[] = [];
    const refusing = deps(log, { fetchImage: async () => { throw new FakeEgressRefusal("DNS 10.0.0.1"); } });
    const refusal = await refusalOf(() => handle({ url: "https://internal.example/a.png" }, refusing));
    expect(refusal).toEqual({ status: 400, body: { error: "Target is not public" } });
    expect(log).toEqual([]);
  });

  it("answers the import and upload validation errors with their own message (400)", async () => {
    for (const thrown of [new MediaImportValidationError({ message: "not an image" }), new MediaValidationError({ message: "too large" })]) {
      const failing = deps([], { uploadMedia: async () => { throw thrown; } });
      expect(await refusalOf(() => handle({ url: "https://cdn.example/a.png" }, failing))).toEqual({ status: 400, body: { error: thrown.message } });
    }
  });

  it("rethrows anything else unchanged for the host's redacted 500, and a failed type record is not a success", async () => {
    const boom = new Error("private fetch failure");
    await expect(handle({ url: "https://cdn.example/a.png" }, deps([], { fetchImage: async () => { throw boom; } }))).rejects.toBe(boom);
    const recordFailure = new Error("store down");
    await expect(handle({ url: "https://cdn.example/a.png" }, deps([], { recordContentType: async () => { throw recordFailure; } }))).rejects.toBe(recordFailure);
  });

  it("fails closed on a mount without an authorizer or principal (wiring bugs)", async () => {
    await expect(mediaImportUrlRoute.handle({ input: { body: {} }, deps: deps(), context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
    await expect(mediaImportUrlRoute.handle({ input: { body: {} }, deps: deps(), context: undefined, authorize: recordingAuthorize().authorize }, { signal })).rejects.toThrow(/no authenticated principal/);
  });
});
