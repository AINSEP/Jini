import { describe, expect, it } from "vitest";
import { seoGetEntryAnalyzeRoute } from "../get-entry-analyze.js";
import { denyingAuthorize, ENTRY_ID, makeSeoRouteDeps, PRINCIPAL, recordingAuthorize, refusalOf, signal } from "./helpers.js";

const raw = (params: Record<string, string>) => ({ body: {}, query: {}, params });

describe("seoGetEntryAnalyzeRoute", () => {
  it("keeps the path and reads :entryId, falling back to an empty id", () => {
    expect(seoGetEntryAnalyzeRoute.method).toBe("get");
    expect(seoGetEntryAnalyzeRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/seo/entries/:entryId/analyze");
    expect(seoGetEntryAnalyzeRoute.parse(raw({ entryId: ENTRY_ID }))).toEqual({ ok: true, value: { entryId: ENTRY_ID } });
    expect(seoGetEntryAnalyzeRoute.parse(raw({}))).toEqual({ ok: true, value: { entryId: "" } });
  });

  it("authorizes admin.seo.manage on the entry and answers the score and issues in the data envelope", async () => {
    const { authorize, calls } = recordingAuthorize();
    const result = await seoGetEntryAnalyzeRoute.handle({ input: { entryId: ENTRY_ID }, deps: makeSeoRouteDeps(), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.seo.manage", entityType: "seo-entry", entityId: ENTRY_ID }]);
    const data = (result as { ok: true; value: { data: { score: number; issues: unknown[] } } }).value.data;
    expect(typeof data.score).toBe("number");
    expect(Array.isArray(data.issues)).toBe(true);
  });

  it("refuses an unknown entry with 404 SEO_ENTRY_NOT_FOUND", async () => {
    expect(await refusalOf(() => seoGetEntryAnalyzeRoute.handle({ input: { entryId: "" }, deps: makeSeoRouteDeps(), context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({
      status: 404, body: { error: "entry '' was not found", code: "SEO_ENTRY_NOT_FOUND" },
    });
  });

  it("does not read the entry when authorization refuses", async () => {
    let reads = 0;
    const deps = makeSeoRouteDeps();
    deps.seoDeps.postRepo.findById = async () => { reads += 1; return null; };
    await expect(seoGetEntryAnalyzeRoute.handle({ input: { entryId: ENTRY_ID }, deps, context: PRINCIPAL, authorize: denyingAuthorize })).rejects.toThrow("denied");
    expect(reads).toBe(0);
  });
});
