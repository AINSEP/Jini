import { describe, expect, it } from "vitest";
import { seoGetEntryRoute } from "../get-entry.js";
import { denyingAuthorize, ENTRY_ID, makeSeoRouteDeps, PRINCIPAL, recordingAuthorize, refusalOf, seedEntry, signal } from "./helpers.js";

const raw = (params: Record<string, string>) => ({ body: {}, query: {}, params });
const MANAGE_ENTRY = (entityId: string) => ({ permission: "admin.seo.manage", entityType: "seo-entry", entityId });

describe("seoGetEntryRoute", () => {
  it("keeps the path and reads :entryId, falling back to an empty id", () => {
    expect(seoGetEntryRoute.method).toBe("get");
    expect(seoGetEntryRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/seo/entries/:entryId");
    expect(seoGetEntryRoute.parse(raw({ entryId: ENTRY_ID }))).toEqual({ ok: true, value: { entryId: ENTRY_ID } });
    expect(seoGetEntryRoute.parse(raw({}))).toEqual({ ok: true, value: { entryId: "" } });
  });

  it("authorizes admin.seo.manage on the entry and answers its meta in the data envelope", async () => {
    const { authorize, calls } = recordingAuthorize();
    const deps = makeSeoRouteDeps([seedEntry({ seoExtJson: JSON.stringify({ title: "Custom" }) })]);
    const result = await seoGetEntryRoute.handle({ input: { entryId: ENTRY_ID }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([MANAGE_ENTRY(ENTRY_ID)]);
    expect(result.ok).toBe(true);
    const data = (result as { value: { data: { title: string } } }).value.data;
    expect(data.title).toBe("Custom");
  });

  it("refuses an unknown entry with 404 SEO_ENTRY_NOT_FOUND", async () => {
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => seoGetEntryRoute.handle({ input: { entryId: "nope" }, deps: makeSeoRouteDeps(), context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "entry 'nope' was not found", code: "SEO_ENTRY_NOT_FOUND" },
    });
  });

  it("waits for SEO readiness and does not read the entry when authorization refuses", async () => {
    let reads = 0;
    const deps = makeSeoRouteDeps();
    const findById = deps.seoDeps.postRepo.findById.bind(deps.seoDeps.postRepo);
    deps.seoDeps.postRepo.findById = async (input) => { reads += 1; return findById(input); };
    await expect(seoGetEntryRoute.handle({ input: { entryId: ENTRY_ID }, deps: { ...deps, seoReady: Promise.reject(new Error("not ready")) }, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("not ready");
    await expect(seoGetEntryRoute.handle({ input: { entryId: ENTRY_ID }, deps, context: PRINCIPAL, authorize: denyingAuthorize })).rejects.toThrow("denied");
    expect(reads).toBe(0);
  });

  it("rethrows an unexpected read failure for the host's error port", async () => {
    const deps = makeSeoRouteDeps();
    deps.seoDeps.postRepo.findById = async () => { throw new Error("boom"); };
    await expect(seoGetEntryRoute.handle({ input: { entryId: ENTRY_ID }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("boom");
  });
});
