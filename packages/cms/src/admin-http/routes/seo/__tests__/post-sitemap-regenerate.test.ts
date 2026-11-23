import { describe, expect, it } from "vitest";
import { seoPostSitemapRegenerateRoute } from "../post-sitemap-regenerate.js";
import { denyingAuthorize, PRINCIPAL, recordingAuthorize, signal, WORKSPACE_ID } from "./helpers.js";

function makeDeps() {
  const regenerated: string[] = [];
  return { regenerated, deps: { workspaceId: WORKSPACE_ID, seoReady: Promise.resolve(), sitemapService: {
    regenerateSitemapCache: async ({ workspaceId }: { workspaceId: string }) => { regenerated.push(workspaceId); },
  } } };
}

describe("seoPostSitemapRegenerateRoute", () => {
  it("keeps the path, answers 202 and needs no input", () => {
    expect(seoPostSitemapRegenerateRoute.method).toBe("post");
    expect(seoPostSitemapRegenerateRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/seo/sitemap/regenerate");
    expect(seoPostSitemapRegenerateRoute.successStatus).toBe(202);
    expect(seoPostSitemapRegenerateRoute.parse({ body: { ignored: true }, query: {}, params: {} })).toEqual({ ok: true, value: {} });
  });

  it("authorizes admin.seo.manage on the sitemap (no entity id) and rebuilds this workspace's cache", async () => {
    const { authorize, calls } = recordingAuthorize();
    const { deps, regenerated } = makeDeps();
    const result = await seoPostSitemapRegenerateRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.seo.manage", entityType: "seo-sitemap" }]);
    expect(regenerated).toEqual([WORKSPACE_ID]);
    expect(result).toEqual({ ok: true, value: { data: { accepted: true } } });
  });

  it("does not rebuild when authorization refuses, and rethrows a rebuild failure for the host", async () => {
    const { deps, regenerated } = makeDeps();
    await expect(seoPostSitemapRegenerateRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: denyingAuthorize })).rejects.toThrow("denied");
    expect(regenerated).toEqual([]);
    const failing = { ...deps, sitemapService: { regenerateSitemapCache: async () => { throw new Error("boom"); } } };
    await expect(seoPostSitemapRegenerateRoute.handle({ input: {}, deps: failing, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("boom");
  });
});
