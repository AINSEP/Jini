import { describe, expect, it } from "vitest";
import type { MediaGridTab } from "@jini-ai/core/contracts/site/cms-admin-media";

import type { MediaRecord } from "../../../../media/types.js";
import { mediaGridRoute, parseMediaGridInput, type MediaGridRouteDeps } from "../grid.js";
import { fakeMedia, fakeMediaDto, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const COUNTS: Record<MediaGridTab, number> = { all: 7, images: 5, videos: 1, trash: 2 };

/** Seven rows in a fixed order, as a host page query would return them. */
const ROWS: MediaRecord[] = Array.from({ length: 7 }, (_, index) =>
  fakeMedia({ id: `m${index}`, title: `Title ${index}`, slug: `s${index}`, createdAt: `2026-10-0${7 - index}T00:00:00.000Z` }),
);

type Recorded = { pages: unknown[]; lookups: unknown[]; enriched: string[][] };

/** Host fakes that record every page read, exact lookup and enrichment, so a refusal can prove nothing was read. */
function deps({ workspaceId = WORKSPACE_ID, rows = ROWS }: { workspaceId?: string; rows?: MediaRecord[] } = {}): MediaGridRouteDeps & Recorded {
  const recorded: Recorded = { pages: [], lookups: [], enriched: [] };
  return {
    ...recorded,
    workspaceId,
    readPage: async (required, optional = {}) => {
      recorded.pages.push({ ...required, ...optional });
      const start = optional.after ? rows.findIndex((row) => row.id === optional.after?.id) + 1 : 0;
      // The host returns one lookahead row past the page when more rows follow.
      return { rows: rows.slice(start, start + required.limit + 1), counts: COUNTS, hasUntypedActive: true };
    },
    findItem: async (required) => {
      recorded.lookups.push(required);
      return { row: rows.find((row) => row.id === required.id) ?? null, counts: COUNTS, hasUntypedActive: false };
    },
    enrichMedia: async ({ media }) => {
      recorded.enriched.push(media.map((row) => row.id));
      return {
        contentTypesBySha256: new Map(media.map((row) => [row.source.sha256, "image/test+ff"])),
        publicUrlsById: new Map(media.map((row) => [row.id, `/m/${row.slug}/public`])),
        byteSizesBySha256: new Map(media.map((row) => [row.source.sha256, 1234])),
      };
    },
  };
}

/** Runs the route the way the host adapter would: parse the raw request, then handle it. */
async function call(d: MediaGridRouteDeps, query: Record<string, unknown>, { workspaceId = WORKSPACE_ID, denied = [] as string[] } = {}) {
  const parsed = mediaGridRoute.parse({ body: {}, query, params: { workspaceId } });
  if (!parsed.ok) throw new Error("parse failed");
  const { authorize, calls } = recordingAuthorize(denied);
  const result = await mediaGridRoute.handle({ input: parsed.value, deps: d, context: PRINCIPAL, authorize }, { signal });
  if (!result.ok) throw new Error("handle failed");
  return { page: result.value, calls };
}

describe("mediaGridRoute", () => {
  it("keeps the method and path", () => {
    expect(mediaGridRoute.method).toBe("get");
    expect(mediaGridRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/media/grid");
  });

  it("refuses a foreign workspace before any page read", async () => {
    const d = deps();
    expect(await refusalOf(() => call(d, { tab: "all", orderBy: "created" }, { workspaceId: "ws-foreign" }))).toEqual({
      status: 404, body: { error: "workspace was not found" },
    });
    expect(await refusalOf(() => call(d, { tab: "all", orderBy: "created", itemId: "m1" }, { workspaceId: "ws-foreign" }))).toEqual({
      status: 404, body: { error: "workspace was not found" },
    });
    expect(d.pages).toEqual([]);
    expect(d.lookups).toEqual([]);
  });

  it("authorizes media.read before reading, and a denied read reads nothing", async () => {
    const d = deps();
    const { calls } = await call(d, { tab: "all", orderBy: "created" });
    expect(calls).toEqual([{ permission: "media.read", entityType: "media" }]);
    const denied = deps();
    await expect(call(denied, { tab: "all", orderBy: "created" }, { denied: ["media.read"] })).rejects.toThrow("denied media.read");
    expect(denied.pages).toEqual([]);
  });

  it("a cursor from another tab or order is refused before storage", async () => {
    const source = await call(deps(), { tab: "images", orderBy: "created", limit: "2" });
    const cursor = source.page.nextCursor;
    expect(typeof cursor).toBe("string");
    const foreign = await call(deps({ workspaceId: "ws-2" }), { tab: "images", orderBy: "created", limit: "2" }, { workspaceId: "ws-2" });
    const d = deps();
    const refusal = { status: 400, body: { error: "the cursor does not belong to this media view" } };
    expect(await refusalOf(() => call(d, { tab: "videos", orderBy: "created", cursor }))).toEqual(refusal);
    expect(await refusalOf(() => call(d, { tab: "images", orderBy: "alphabetical", cursor }))).toEqual(refusal);
    expect(await refusalOf(() => call(d, { tab: "images", orderBy: "created", cursor: foreign.page.nextCursor }))).toEqual(refusal);
    expect(d.pages).toEqual([]);
  });

  it("only the returned page is enriched", async () => {
    const d = deps();
    const first = await call(d, { tab: "all", orderBy: "created", limit: "3" });
    expect(d.pages).toEqual([{ workspaceId: WORKSPACE_ID, tab: "all", orderBy: "created", limit: 3 }]);
    expect(d.enriched).toEqual([["m0", "m1", "m2"]]);
    expect(first.page).toEqual({
      media: ["m0", "m1", "m2"].map((id, index) => fakeMediaDto({ id, title: `Title ${index}`, slug: `s${index}`, createdAt: `2026-10-0${7 - index}T00:00:00.000Z` })),
      nextCursor: expect.any(String), counts: COUNTS, hasUntypedActive: true,
    });
    const second = await call(d, { tab: "all", orderBy: "created", limit: "3", cursor: first.page.nextCursor });
    expect(d.pages[1]).toEqual({ workspaceId: WORKSPACE_ID, tab: "all", orderBy: "created", limit: 3, after: { sortValue: "2026-10-05T00:00:00.000Z", id: "m2" } });
    expect(second.page.media.map((row) => row.id)).toEqual(["m3", "m4", "m5"]);
    const last = await call(d, { tab: "all", orderBy: "created", limit: "3", cursor: second.page.nextCursor });
    expect(last.page.media.map((row) => row.id)).toEqual(["m6"]);
    expect(last.page.nextCursor).toBeNull();
    expect(d.enriched).toEqual([["m0", "m1", "m2"], ["m3", "m4", "m5"], ["m6"]]);
  });

  it("an alphabetical cursor names the last title and id, so it survives deletion of that row", async () => {
    const d = deps();
    const first = await call(d, { tab: "all", orderBy: "alphabetical", limit: "2" });
    const afterDeletion = deps({ rows: ROWS.filter((row) => row.id !== "m1") });
    await call(afterDeletion, { tab: "all", orderBy: "alphabetical", limit: "2", cursor: first.page.nextCursor });
    expect(afterDeletion.pages).toEqual([{ workspaceId: WORKSPACE_ID, tab: "all", orderBy: "alphabetical", limit: 2, after: { sortValue: "Title 1", id: "m1" } }]);
    expect(afterDeletion.lookups).toEqual([]);
  });

  it("exact lookup by itemId reads one asset without a page read", async () => {
    const d = deps();
    const { page } = await call(d, { tab: "images", orderBy: "created", itemId: "m4" });
    expect(d.pages).toEqual([]);
    expect(d.lookups).toEqual([{ workspaceId: WORKSPACE_ID, tab: "images", id: "m4" }]);
    expect(d.enriched).toEqual([["m4"]]);
    expect(page).toEqual({ media: [expect.objectContaining({ id: "m4" })], nextCursor: null, counts: COUNTS, hasUntypedActive: false });
    expect(await refusalOf(() => call(d, { tab: "images", orderBy: "created", itemId: "missing" }))).toEqual({ status: 404, body: { error: "media was not found" } });
    expect(d.enriched).toEqual([["m4"]]);
  });
});

describe("parseMediaGridInput", () => {
  it("defaults the limit to 50 and bounds it to 1..100", () => {
    expect(parseMediaGridInput({ query: { tab: "all", orderBy: "created" } })).toEqual({ tab: "all", orderBy: "created", limit: 50 });
    expect(parseMediaGridInput({ query: { tab: "trash", orderBy: "alphabetical", limit: "0" } }).limit).toBe(1);
    expect(parseMediaGridInput({ query: { tab: "videos", orderBy: "created", limit: "500" } }).limit).toBe(100);
    expect(parseMediaGridInput({ query: { tab: "images", orderBy: "created", limit: "7" } }).limit).toBe(7);
  });

  it.each([
    [{ tab: "docs", orderBy: "created" }, "tab must be all, images, videos or trash"],
    [{ tab: "all" }, "orderBy must be created or alphabetical"],
    [{ tab: ["all", "trash"], orderBy: "created" }, "tab must be all, images, videos or trash"],
    [{ tab: "all", orderBy: "created", limit: "ten" }, "limit must be a whole number"],
    [{ tab: "all", orderBy: "created", limit: "1.5" }, "limit must be a whole number"],
    [{ tab: "all", orderBy: "created", cursor: "not a cursor" }, "the cursor is not valid"],
    [{ tab: "all", orderBy: "created", cursor: Buffer.from("{\"v\":1}").toString("base64url") }, "the cursor is not valid"],
    [{ tab: "all", orderBy: "created", cursor: Buffer.from("[1").toString("base64url") }, "the cursor is not valid"],
    [{ tab: "all", orderBy: "created", cursor: "a".repeat(2000) }, "the cursor is not valid"],
    [{ tab: "all", orderBy: "created", itemId: "" }, "itemId must not be empty"],
  ])("refuses %j with a plain 400", async (query, error) => {
    expect(await refusalOf(() => parseMediaGridInput({ query }))).toEqual({ status: 400, body: { error } });
  });

  it("refuses an exact lookup combined with a cursor", async () => {
    const { page } = await call(deps(), { tab: "all", orderBy: "created", limit: "1" });
    expect(await refusalOf(() => parseMediaGridInput({ query: { tab: "all", orderBy: "created", itemId: "m1", cursor: page.nextCursor } }))).toEqual({
      status: 400, body: { error: "itemId cannot be combined with a cursor" },
    });
  });
});
