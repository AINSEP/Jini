import { describe, expect, it } from "vitest";
import { DocumentTextExtractionError } from "../../../../media/document-text.js";
import { MediaNotFoundError, MediaValidationError } from "../../../../media/types.js";
import { mediaTextRoute } from "../text.js";
import { PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file GET a document's text page: media.read on the asset (by id), then the offset check, then the injected reader's ladder. */

function deps(log: string[] = [], fail?: unknown) {
  return {
    workspaceId: WORKSPACE_ID,
    outwardErrorMessage: ({ error }: { error: Error }) => error.message,
    readText: async (input: { workspaceId: string; id: string; offset: number }) => {
      log.push(JSON.stringify(input));
      if (fail !== undefined) throw fail;
      return { text: "hello", offset: input.offset, nextOffset: null };
    },
  };
}

function run(input: { mediaId: string; rawOffset: unknown }, d = deps(), authorize = recordingAuthorize().authorize) {
  return mediaTextRoute.handle({ input, deps: d, context: PRINCIPAL, authorize }, { signal });
}

describe("mediaTextRoute", () => {
  it("keeps the method, path and default status, and carries the id and the raw offset through parse", () => {
    expect(mediaTextRoute.method).toBe("get");
    expect(mediaTextRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/media/:mediaId/text");
    expect(mediaTextRoute.successStatus).toBeUndefined();
    expect(mediaTextRoute.responseHeaders).toStrictEqual({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    expect(mediaTextRoute.parse({ body: {}, query: { offset: "12" }, params: { mediaId: "m-1" } })).toEqual({ ok: true, value: { mediaId: "m-1", rawOffset: "12" } });
    expect(mediaTextRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: { mediaId: "", rawOffset: undefined } });
  });

  it("asks media.read on the asset before the offset check, and a denial reads nothing", async () => {
    const log: string[] = [];
    const recorder = recordingAuthorize(["media.read"]);
    await expect(run({ mediaId: "m-1", rawOffset: "nope" }, deps(log), recorder.authorize)).rejects.toThrow("denied media.read");
    expect(recorder.calls).toStrictEqual([{ permission: "media.read", entityType: "media", entityId: "m-1" }]);
    expect(log).toEqual([]);
  });

  it("pages from byte 0 when the offset is omitted and passes a decimal offset through as a number", async () => {
    const log: string[] = [];
    expect(await run({ mediaId: "m-1", rawOffset: undefined }, deps(log))).toEqual({ ok: true, value: { text: "hello", offset: 0, nextOffset: null } });
    await run({ mediaId: "m-1", rawOffset: "65536" }, deps(log));
    expect(log).toEqual([JSON.stringify({ workspaceId: WORKSPACE_ID, id: "m-1", offset: 0 }), JSON.stringify({ workspaceId: WORKSPACE_ID, id: "m-1", offset: 65536 })]);
  });

  it.each([["-1"], ["1.5"], [""], [["1", "2"]], ["0x10"]])("refuses offset %j with the flat 400 before any read", async (rawOffset) => {
    const log: string[] = [];
    expect(await refusalOf(() => run({ mediaId: "m-1", rawOffset }, deps(log)))).toEqual({ status: 400, body: { error: "offset must be a non-negative byte offset" } });
    expect(log).toEqual([]);
  });

  it("maps the reader's refusals: extraction 400 with its code, missing 404, validation 400; anything else is rethrown", async () => {
    const extraction = new DocumentTextExtractionError({ code: "DOCUMENT_TEXT_UNAVAILABLE", message: "extraction unavailable" });
    expect(await refusalOf(() => run({ mediaId: "m-1", rawOffset: undefined }, deps([], extraction)))).toEqual({ status: 400, body: { error: "extraction unavailable", code: "DOCUMENT_TEXT_UNAVAILABLE" } });
    expect(await refusalOf(() => run({ mediaId: "m-1", rawOffset: undefined }, deps([], new MediaNotFoundError({ message: "media 'm-1' was not found" }))))).toEqual({ status: 404, body: { error: "media 'm-1' was not found" } });
    expect(await refusalOf(() => run({ mediaId: "m-1", rawOffset: undefined }, deps([], new MediaValidationError({ message: "download only" }))))).toEqual({ status: 400, body: { error: "download only" } });
    const boom = new Error("disk gone");
    await expect(run({ mediaId: "m-1", rawOffset: undefined }, deps([], boom))).rejects.toBe(boom);
  });

  it("fails closed on a mount without an authorizer (a wiring bug)", async () => {
    await expect(mediaTextRoute.handle({ input: { mediaId: "m-1", rawOffset: undefined }, deps: deps(), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
