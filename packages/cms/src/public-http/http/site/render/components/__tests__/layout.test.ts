import { describe, expect, it } from "vitest";
import { siteFooter } from "../layout.js";
import type { SiteRenderContext } from "../../../render-context.js";

const ctx = (over: Partial<SiteRenderContext> = {}): SiteRenderContext => ({
  siteTitle: "Acme & Co", route: "home", posts: [], products: [], themeName: "Fresh",
  widgetRegions: {}, widgetInlineResolved: new Map(), mediaTransformVersions: new Map(),
  mediaAssetMetadata: new Map(), assignedTerms: [], ...over,
});

describe("siteFooter host credit", () => {
  it("renders the host-supplied credit after the escaped site title, byte-for-byte", () => {
    expect(siteFooter(ctx(), { creditText: "powered by Host" })).toBe(
      '<footer class="site-footer"><div class="wrap"><span>Acme &amp; Co — powered by Host</span><span class="theme-badge">theme: Fresh</span></div></footer>',
    );
  });
  it("shows the site title alone when the host supplies no credit", () => {
    expect(siteFooter(ctx())).toBe(
      '<footer class="site-footer"><div class="wrap"><span>Acme &amp; Co</span><span class="theme-badge">theme: Fresh</span></div></footer>',
    );
  });
  it("escapes the credit and drops the badge when the theme is off", () => {
    expect(siteFooter(ctx({ themeName: null }), { creditText: "<b>x</b>" })).toContain("<span>Acme &amp; Co — &lt;b&gt;x&lt;/b&gt;</span></div>");
  });
});
