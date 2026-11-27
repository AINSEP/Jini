import { injectFormAttemptTokens } from "../../../../../forms/form-controls.js";
import { expect, it, vi } from "vitest";
import { finalizePublicPageHtml, publicPageCache, resolveVisitorPagePolicy, sendPublicPage, addPluginExportHostsToResponse } from "../response.js";

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

it("writes cache and HTML type before finalization and overrides JSON batch type before one send", async () => {
  for (const format of ["json", "html"]) {
    const order: string[] = [];
    const unreachable = vi.fn(() => { throw new Error("document work reached for batch"); });
    await sendPublicPage({ html: "page", perVisitor: { result: undefined, cacheControl: "public" },
      preConsentCacheControl: ({ cacheControl }) => cacheControl, hasConsentGatedScripts: () => true,
      writer: { vary: name => { order.push(`vary:${name}`); }, set: (name, value) => { order.push(`${name}:${value}`); }, type: value => { order.push(`type:${value}`); }, send: html => { order.push(`send:${html}`); } },
      ports: { injectFormAttemptTokens, listingBatchBody: () => { order.push("batch"); return { format, body: "batch-body" }; }, assertListingPageServed: unreachable,
        pluginHead: unreachable, addPluginHosts: unreachable, widgetPartials: unreachable, hasWidgetPartials: unreachable,
        finishFormResult: unreachable, staticExport: unreachable, memberAuthScript: unreachable,
        workspaceId: "w", randomUUID: unreachable, nowMs: unreachable, formSubmissionAttempts: unreachable },
    });
    expect(order).toEqual(["vary:Cookie", "Cache-Control:public", "type:html", "batch", ...(format === "json" ? ["type:json"] : []), "send:batch-body"]);
    expect(unreachable).not.toHaveBeenCalled();
  }
});

it("assembles assets, conditionally expands widgets and issues tokens only for live documents", async () => {
  for (const staticExport of [true, false]) {
    const order: string[] = [];
    const issue = vi.fn((input: { workspaceId: string; slug: string; attemptToken: string; issuedAtMs: number }) => { order.push("issue"); expect(input).toEqual({ workspaceId: "w", slug: "contact", attemptToken: "token", issuedAtMs: 42 }); });
    const widgetPartials = vi.fn(async ({ html }: { html: string }) => { order.push("widget"); return html; });
    let sent = "";
    await sendPublicPage({ html: '<html><head></head><body><form data-form-slug="contact"></form></body></html>', perVisitor: { result: undefined, cacheControl: "private, no-store" },
      preConsentCacheControl: ({ cacheControl }) => cacheControl, hasConsentGatedScripts: () => false,
      writer: { vary: vi.fn(), set: vi.fn(), type: vi.fn(), send: html => { order.push("send"); sent = html; } },
      ports: { injectFormAttemptTokens, listingBatchBody: () => undefined, assertListingPageServed: () => { order.push("assert"); },
        pluginHead: () => { order.push("head"); return '<meta name="plugin">'; }, addPluginHosts: () => { order.push("hosts"); },
        hasWidgetPartials: () => !staticExport, widgetPartials,
        finishFormResult: ({ html }) => { order.push("form"); return html; }, staticExport: () => staticExport,
        memberAuthScript: ({ html }) => { order.push("member"); return html; }, workspaceId: "w",
        randomUUID: () => { order.push("uuid"); return "token"; }, nowMs: () => { order.push("clock"); return 42; }, formSubmissionAttempts: () => ({ issue }),
      },
    });
    expect(sent).toContain('<meta name="plugin">');
    if (staticExport) { expect(order).toEqual(["assert", "head", "hosts", "form", "send"]); expect(sent).not.toContain('name="_attempt"'); expect(issue).not.toHaveBeenCalled(); }
    else { expect(order).toEqual(["assert", "head", "hosts", "widget", "form", "uuid", "clock", "issue", "member", "send"]); expect(sent).toContain('name="_attempt" value="token"'); expect(issue).toHaveBeenCalledOnce(); }
  }
});

it("clears consumed flash and keeps the clearing response private even without a query result", () => {
  const clearFlash = vi.fn(); const memberCookiePresent = vi.fn();
  const flash = { slug: "contact", values: {} };
  expect(resolveVisitorPagePolicy({ queryResult: undefined, flash, clearFlash, memberCookiePresent, staticExport: () => false,
    cache: { form: "private, no-store", member: "member", staticExport: "export", public: "public" } })).toEqual({ result: undefined, cacheControl: "private, no-store" });
  expect(clearFlash).toHaveBeenCalledWith({}); expect(memberCookiePresent).not.toHaveBeenCalled();
});

it("keeps invalid consent with gated content private and member-cookie presence private without visible gating", () => {
  const preConsentCacheControl = vi.fn(() => "private, no-store");
  expect(publicPageCache({ html: "original", cacheControl: "public", preConsentCacheControl, hasConsentGatedScripts: () => true })).toEqual({ cacheControl: "private, no-store", varyCookie: false });
  expect(preConsentCacheControl).toHaveBeenCalledWith({ html: "original", cacheControl: "public" });
  const staticExport = vi.fn(() => false);
  expect(resolveVisitorPagePolicy({ queryResult: undefined, flash: undefined, clearFlash: () => {}, memberCookiePresent: () => true, staticExport, cache: { form: "form", member: "private, no-store", staticExport: "export", public: "public" } })).toEqual({ result: undefined, cacheControl: "private, no-store" });
  expect(staticExport).not.toHaveBeenCalled();
});

it.each([true, false])('uses the static-export cache policy only for a flagged request (%s)', (exporting) => {
  const staticExport = vi.fn(() => exporting);
  expect(resolveVisitorPagePolicy({
    queryResult: undefined, flash: undefined, clearFlash: vi.fn(), memberCookiePresent: () => false, staticExport,
    cache: { form: 'private, no-store', member: 'private', staticExport: 'no-store', public: 'public, max-age=60' },
  })).toEqual({ result: undefined, cacheControl: exporting ? 'no-store' : 'public, max-age=60' });
  expect(staticExport).toHaveBeenCalledExactlyOnceWith({});
});

it('adds plugin origins only to their directives in the existing report-only policy', () => {
  const header = 'Content-Security-Policy-Report-Only';
  const getHeader = vi.fn(() => "default-src 'self'; script-src 'self'; frame-src 'self'; connect-src 'self'");
  const setHeader = vi.fn();
  addPluginExportHostsToResponse({
    response: { getHeader, setHeader },
    hosts: { script: ['https://scripts.example'], frame: ['https://frames.example'], connect: ['https://api.example'] },
  });
  expect(getHeader).toHaveBeenCalledExactlyOnceWith(header);
  expect(setHeader).toHaveBeenCalledExactlyOnceWith(header,
    "default-src 'self'; script-src 'self' https://scripts.example; frame-src 'self' https://frames.example; connect-src 'self' https://api.example");
});

it.each([
  { label: 'missing', policy: undefined },
  { label: 'non-string', policy: ["script-src 'self'"] },
])('does not synthesize a report-only policy from a $label header', ({ policy }) => {
  const setHeader = vi.fn();
  addPluginExportHostsToResponse({
    response: { getHeader: () => policy, setHeader },
    hosts: { script: ['https://scripts.example'], frame: [], connect: [] },
  });
  expect(setHeader).not.toHaveBeenCalled();
});
