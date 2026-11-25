import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { MediaImportValidationError } from "../../../../media/import/fetch-image.js";
import { MediaValidationError, type MediaRecord } from "../../../../media/types.js";
import { mediaImportUrlRoute, type MediaImportUrlRouteDeps } from "../import-url.js";
import { fakeMedia, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const BYTES = new Uint8Array([1, 2, 3, 4]);
const STORED = fakeMedia({ id: "asset-1", source: { sha256: "sha-1" } } as Partial<MediaRecord>);

/** Fakes that record every outbound fetch, upload and content-type write, so a refusal can prove nothing ran. */
function deps({ fetchFails, uploadFails, egress }: { fetchFails?: unknown; uploadFails?: unknown; egress?: string } = {}): MediaImportUrlRouteDeps & {
  fetches: unknown[]; uploads: unknown[]; recorded: unknown[];
} {
  const fetches: unknown[] = [];
  const uploads: unknown[] = [];
  const recorded: unknown[] = [];
  return {
    fetches, uploads, recorded, workspaceId: WORKSPACE_ID,
    fetchImage: async (input) => {
      fetches.push(input);
      if (fetchFails) throw fetchFails;
      return { bytes: BYTES, contentType: "image/png", url: new URL("https://cdn.example/final/Sunset%20Photo.jpeg") };
    },
    uploadMedia: async (input) => { uploads.push(input); if (uploadFails) throw uploadFails; return { media: STORED }; },
    mediaContentTypeStore: { set: async (input) => { recorded.push(input); } },
    outwardErrorMessage: ({ error }) => error.message,
    egressRefusalMessage: ({ error }) => (error instanceof Error && error.message === "egress" ? egress : undefined),
    toMediaResponse: async ({ media, contentType, byteSize }) => ({ id: media.id, contentType, byteSize }),
  };
}

const handle = (d: MediaImportUrlRouteDeps, body: unknown, authorize = recordingAuthorize().authorize) =>
  mediaImportUrlRoute.handle({ input: { body }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("mediaImportUrlRoute", () => {
  it("URL import returns 201 with the original media and the same notice", async () => {
    const d = { ...deps(), uploadMedia: async () => ({ media: STORED, conversionNotice: "web-copy-unavailable" as const }) };
    expect(mediaImportUrlRoute.successStatus).toBe(201);
    expect(await handle(d, { url: "https://cdn.example/a" })).toStrictEqual({
      ok: true, value: { media: { id: STORED.id, contentType: "image/png", byteSize: 4 }, conversionNotice: "web-copy-unavailable" },
    });
  });

  it("omits an arbitrary conversion notice without changing the projected media", async () => {
    const d = { ...deps(), uploadMedia: async () => ({ media: STORED, conversionNotice: "/tmp/x provider said …" as never }) };
    const result = await handle(d, { url: "https://cdn.example/a" });
    expect(result).toStrictEqual({ ok: true, value: { media: { id: STORED.id, contentType: "image/png", byteSize: 4 } } });
    if (!result.ok) throw new Error("expected import success");
    expect(result.value).not.toHaveProperty("conversionNotice");
  });

  it("keeps the method, path and 201, and passes the raw body through for validation after authorization", () => {
    expect(mediaImportUrlRoute.method).toBe("post");
    expect(mediaImportUrlRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/media/import-url");
    expect(mediaImportUrlRoute.successStatus).toBe(201);
    expect(mediaImportUrlRoute.parse({ ...raw({}), body: "not-an-object" })).toEqual({ ok: true, value: { body: "not-an-object" } });
  });

  it("authorizes media.upload id-free, fetches the trimmed URL, uploads with the last hop's filename and records the sniffed type", async () => {
    const { authorize, calls } = recordingAuthorize();
    const d = deps();
    const result = await handle(d, { url: "  https://cdn.example/a  ", alt: "A fox", caption: "Photo", credit: "Photographer" }, authorize);
    expect(calls).toEqual([{ permission: "media.upload", entityType: "media" }]);
    expect(d.fetches).toEqual([{ url: "https://cdn.example/a" }]);
    expect(d.uploads).toEqual([{
      workspaceId: WORKSPACE_ID, bytes: BYTES, contentType: "image/png", filename: "Sunset-Photo.png",
      alt: "A fox", caption: "Photo", credit: "Photographer", createdByPrincipal: PRINCIPAL.id,
    }]);
    expect(d.recorded).toEqual([{ workspaceId: WORKSPACE_ID, sha256: "sha-1", contentType: "image/png" }]);
    expect(result).toEqual({ ok: true, value: { media: { id: "asset-1", contentType: "image/png", byteSize: 4 } } });
  });

  it("names the upload from an explicit filename override", async () => {
    const d = deps();
    await handle(d, { url: "https://cdn.example/a", filename: "My Holiday.gif" });
    expect((d.uploads[0] as { filename: string }).filename).toBe("My-Holiday.png");
  });

  for (const body of [undefined, null, [], "https://example.com/a.png", {}, { url: " " }, { url: 1 }]) {
    it(`refuses malformed input ${JSON.stringify(body)} with 400 before any outbound request`, async () => {
      const d = deps();
      expect(await refusalOf(() => handle(d, body))).toEqual({ status: 400, body: { error: "url is required" } });
      expect(d.fetches).toEqual([]);
    });
  }

  it("refuses non-string metadata with 400 before any outbound request", async () => {
    const d = deps();
    expect((await refusalOf(() => handle(d, { url: "https://cdn.example/a", alt: 42 }))).status).toBe(400);
    expect(d.fetches).toEqual([]);
  });

  it("answers a denied media.upload with the route's own 403 body, keeping the port's details, before any fetch", async () => {
    const d = deps();
    const denied = async () => {
      throw new RouteRefusalError({ status: 403, body: { error: "principal 'p' is not authorized", code: "FORBIDDEN", details: { permission: "media.upload", reason: "no_role" } } });
    };
    expect(await refusalOf(() => handle(d, { url: "https://cdn.example/a" }, denied))).toEqual({
      status: 403, body: { error: "not authorized for media.upload", code: "FORBIDDEN", details: { permission: "media.upload", reason: "no_role" } },
    });
    expect(d.fetches).toEqual([]);
  });

  it("maps an egress refusal to 400 with only the host's caller-safe message, and persists nothing", async () => {
    const d = deps({ fetchFails: new Error("egress"), egress: "Target is not public" });
    expect(await refusalOf(() => handle(d, { url: "https://cdn.example/a" }))).toEqual({ status: 400, body: { error: "Target is not public" } });
    expect(d.uploads).toEqual([]);
  });

  it("words a validation failure through the host's outwardErrorMessage, never the raw error text", async () => {
    const d = { ...deps({ fetchFails: new MediaImportValidationError({ message: "stored text" }) }), outwardErrorMessage: () => "outward copy" };
    expect(await refusalOf(() => handle(d, { url: "https://cdn.example/a" }))).toEqual({ status: 400, body: { error: "outward copy" } });
  });

  it("maps fetch and upload validation failures to 400 with their message", async () => {
    const fetchRefused = deps({ fetchFails: new MediaImportValidationError({ message: "not an image" }) });
    expect(await refusalOf(() => handle(fetchRefused, { url: "https://cdn.example/a" }))).toEqual({ status: 400, body: { error: "not an image" } });
    const uploadRefused = deps({ uploadFails: new MediaValidationError({ message: "too large" }) });
    expect(await refusalOf(() => handle(uploadRefused, { url: "https://cdn.example/a" }))).toEqual({ status: 400, body: { error: "too large" } });
    expect(uploadRefused.recorded).toEqual([]);
  });

  it("rethrows any other failure unchanged for the host's error port", async () => {
    const d = deps({ fetchFails: new Error("private fetch failure") });
    await expect(handle(d, { url: "https://cdn.example/a" })).rejects.toThrow("private fetch failure");
  });
});
