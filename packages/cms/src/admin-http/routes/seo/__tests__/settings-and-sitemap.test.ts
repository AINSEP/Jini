import { describe, expect, it } from "vitest";

import { SeoSettingsValidationError } from "../../../../seo/errors.js";
import type { SeoSettings } from "../../../../seo/types.js";
import { seoGetSettingsRoute } from "../get-settings.js";
import { seoPostSitemapRegenerateRoute } from "../post-sitemap-regenerate.js";
import { seoPutSettingsRoute } from "../put-settings.js";
import { gate, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file The id-free SEO specs: settings read/write and the sitemap regenerate trigger. */

const SETTINGS = { titleTemplate: "{title} | Site" } as unknown as SeoSettings;
const ready = Promise.resolve();

describe("seoGetSettingsRoute", () => {
  it("keeps the method, path, success status and no body cap", () => {
    expect(seoGetSettingsRoute.method).toBe("get");
    expect(seoGetSettingsRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/seo/settings");
    expect(seoGetSettingsRoute.successStatus).toBeUndefined();
    expect(seoGetSettingsRoute.maxBodyBytes).toBeUndefined();
    expect(seoGetSettingsRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
  });

  it("authorizes admin.seo.manage on seo-settings with no entity id and answers the injected reader's settings", async () => {
    const { authorize, calls } = recordingAuthorize();
    const reads: unknown[] = [];
    const readSeoSettings = async (input: { workspaceId: string }) => { reads.push(input); return SETTINGS; };
    const result = await seoGetSettingsRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, seoReady: ready, readSeoSettings }, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ permission: "admin.seo.manage", entityType: "seo-settings" }]);
    expect(reads).toEqual([{ workspaceId: WORKSPACE_ID }]);
    expect(result).toEqual({ ok: true, value: { data: SETTINGS } });
  });

  it("waits for the SEO readiness gate before authorizing", async () => {
    const { authorize, calls } = recordingAuthorize();
    const { ready: seoReady, open } = gate();
    const pending = seoGetSettingsRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, seoReady, readSeoSettings: async () => SETTINGS }, context: PRINCIPAL, authorize });
    await Promise.resolve();
    expect(calls).toEqual([]);
    open();
    await pending;
    expect(calls).toHaveLength(1);
  });

  it("does not read when authorization refuses, and fails closed without an authorizer", async () => {
    let reads = 0;
    const deps = { workspaceId: WORKSPACE_ID, seoReady: ready, readSeoSettings: async () => { reads += 1; return SETTINGS; } };
    await expect(seoGetSettingsRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize(["admin.seo.manage"]).authorize })).rejects.toThrow("denied admin.seo.manage");
    await expect(seoGetSettingsRoute.handle({ input: {}, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(reads).toBe(0);
  });
});

describe("seoPutSettingsRoute", () => {
  it("keeps the method and path and passes the body (or {}) through as the patch", () => {
    expect(seoPutSettingsRoute.method).toBe("put");
    expect(seoPutSettingsRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/seo/settings");
    expect(seoPutSettingsRoute.maxBodyBytes).toBeUndefined();
    expect(seoPutSettingsRoute.parse(raw({}, { noindex: true }))).toEqual({ ok: true, value: { patch: { noindex: true } } });
    expect(seoPutSettingsRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { patch: {} } });
  });

  it("authorizes, then writes through the injected writer as the caller", async () => {
    const { authorize, calls } = recordingAuthorize();
    const writes: unknown[] = [];
    const writeSeoSettings = async (input: unknown) => { writes.push(input); return SETTINGS; };
    const result = await seoPutSettingsRoute.handle({ input: { patch: { noindex: true } }, deps: { workspaceId: WORKSPACE_ID, seoReady: ready, writeSeoSettings }, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ permission: "admin.seo.manage", entityType: "seo-settings" }]);
    expect(writes).toEqual([{ workspaceId: WORKSPACE_ID, patch: { noindex: true }, callerPrincipalId: PRINCIPAL.id }]);
    expect(result).toEqual({ ok: true, value: { data: SETTINGS } });
  });

  it("maps a refused patch to 400 SEO_SETTINGS_VALIDATION_ERROR and rethrows anything else", async () => {
    const { authorize } = recordingAuthorize();
    const refuse = async () => { throw new SeoSettingsValidationError("titleTemplate is too long"); };
    expect(await refusalOf(() => seoPutSettingsRoute.handle({ input: { patch: {} }, deps: { workspaceId: WORKSPACE_ID, seoReady: ready, writeSeoSettings: refuse }, context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "titleTemplate is too long", code: "SEO_SETTINGS_VALIDATION_ERROR" },
    });
    const boom = async () => { throw new Error("ledger offline"); };
    await expect(seoPutSettingsRoute.handle({ input: { patch: {} }, deps: { workspaceId: WORKSPACE_ID, seoReady: ready, writeSeoSettings: boom }, context: PRINCIPAL, authorize })).rejects.toThrow("ledger offline");
  });

  it("writes nothing when authorization refuses, and fails closed without a principal", async () => {
    let writes = 0;
    const deps = { workspaceId: WORKSPACE_ID, seoReady: ready, writeSeoSettings: async () => { writes += 1; return SETTINGS; } };
    await expect(seoPutSettingsRoute.handle({ input: { patch: {} }, deps, context: PRINCIPAL, authorize: recordingAuthorize(["admin.seo.manage"]).authorize })).rejects.toThrow("denied");
    await expect(seoPutSettingsRoute.handle({ input: { patch: {} }, deps, context: undefined, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
    expect(writes).toBe(0);
  });
});

describe("seoPostSitemapRegenerateRoute", () => {
  it("keeps the method, path and the 202 success status", () => {
    expect(seoPostSitemapRegenerateRoute.method).toBe("post");
    expect(seoPostSitemapRegenerateRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/seo/sitemap/regenerate");
    expect(seoPostSitemapRegenerateRoute.successStatus).toBe(202);
    expect(seoPostSitemapRegenerateRoute.maxBodyBytes).toBeUndefined();
  });

  it("authorizes seo-sitemap, regenerates this workspace's cache and accepts", async () => {
    const { authorize, calls } = recordingAuthorize();
    const regenerated: unknown[] = [];
    const sitemapService = { regenerateSitemapCache: async (input: { workspaceId: string }) => { regenerated.push(input); } };
    const result = await seoPostSitemapRegenerateRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, seoReady: ready, sitemapService } as never, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ permission: "admin.seo.manage", entityType: "seo-sitemap" }]);
    expect(regenerated).toEqual([{ workspaceId: WORKSPACE_ID }]);
    expect(result).toEqual({ ok: true, value: { data: { accepted: true } } });
  });

  it("does not regenerate when authorization refuses", async () => {
    let regenerated = 0;
    const sitemapService = { regenerateSitemapCache: async () => { regenerated += 1; } };
    await expect(seoPostSitemapRegenerateRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, seoReady: ready, sitemapService } as never, context: PRINCIPAL, authorize: recordingAuthorize(["admin.seo.manage"]).authorize })).rejects.toThrow("denied");
    expect(regenerated).toBe(0);
  });
});
