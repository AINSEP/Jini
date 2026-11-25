import { expect, it, vi } from "vitest";
import { finalizePublicPageHtml, publicPageCache, resolveVisitorPagePolicy } from "../response.js";

it("does not run document hooks for a listing batch and keeps the finalization order for a full document", async () => {
  const order: string[] = [];
  const ports = {
    listingBatchBody: () => ({ format: "json", body: "{}" }),
    assertListingPageServed: () => { order.push("assert"); },
    pluginHead: () => { order.push("head"); return "<meta name=plugin>"; },
    addPluginHosts: () => { order.push("hosts"); },
    widgetPartials: async ({ html }: { html: string }) => { expect(html).toContain("<meta name=plugin>"); expect(html).toContain("data-jini-see-more-script"); order.push("partials"); return html; },
    finishFormResult: ({ html }: { html: string }) => { order.push("form"); return html; },
    staticExport: () => { order.push("static"); return false; },
    formAttemptTokens: ({ html }: { html: string }) => { order.push("tokens"); return html; },
    memberAuthScript: ({ html }: { html: string }) => { order.push("member"); return html; },
  };
  expect(await finalizePublicPageHtml({ html: "<html><head></head><body><button data-jini-more='1'></button></body></html>", formResult: undefined, ports })).toEqual({ html: "{}", contentType: "json" });
  expect(order).toEqual([]);
  await finalizePublicPageHtml({ html: "<html><head></head><body><button data-jini-more='1'></button></body></html>", formResult: undefined, ports: { ...ports, listingBatchBody: () => undefined } });
  expect(order).toEqual(["assert", "head", "hosts", "partials", "form", "static", "tokens", "member"]);
});

it("keeps invalid consent with gated content private and member-cookie presence private without visible gating", () => {
  const preConsentCacheControl = vi.fn(() => "private, no-store");
  expect(publicPageCache({ html: "original", cacheControl: "public", preConsentCacheControl, hasConsentGatedScripts: () => true })).toEqual({ cacheControl: "private, no-store", varyCookie: false });
  expect(preConsentCacheControl).toHaveBeenCalledWith({ html: "original", cacheControl: "public" });
  const staticExport = vi.fn(() => false);
  expect(resolveVisitorPagePolicy({ queryResult: undefined, flash: undefined, clearFlash: () => {}, memberCookiePresent: () => true, staticExport, cache: { form: "form", member: "private, no-store", staticExport: "export", public: "public" } })).toEqual({ result: undefined, cacheControl: "private, no-store" });
  expect(staticExport).not.toHaveBeenCalled();
});
