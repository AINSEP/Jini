import { siteHeader, siteFooter } from "../render/components/layout.js";
import { EMPTY_INLINE_RESOLVED, EMPTY_MEDIA_TRANSFORM_VERSIONS, EMPTY_MEDIA_ASSET_METADATA } from "../render/doc/doc-nodes.js";
import { expect, it, vi } from 'vitest';
import { renderSite, type RenderSiteRequired } from '../render-site.js';

it('transforms managed bodies before collecting assets and bypasses the shell for complete static home', async () => {
  const order: string[] = [];
  const required: RenderSiteRequired = {
    siteHeader, siteFooter, EMPTY_INLINE_RESOLVED, EMPTY_MEDIA_TRANSFORM_VERSIONS, EMPTY_MEDIA_ASSET_METADATA,
    theme: null, route: 'home', siteTitle: 'Site', posts: [], footerCredit: 'credit', renderScriptAssets: () => '',
    resolveTemplateId: () => null, resolveLiquidTemplateId: () => null, resolveHandlebarsTemplateId: () => null,
    loadLiquidSandbox: async () => ({ renderLiquidInSandbox: async () => '' }), loadHandlebarsSandbox: async () => ({ renderHandlebarsInSandbox: async () => '' }), renderBlock: () => '',
    renderStaticPage: () => '<!doctype html><html><head></head><body>static</body></html>',
    injectSiteAssistantIntoStaticPage: ({ html }) => html,
    entryContent: () => '', entryList: () => 'body', productEntryContent: () => '', productEntryList: () => '',
    pageShell: ({ body, documentAssets }) => { order.push('shell'); return `${body}${documentAssets.head}`; },
    transformBody: async ({ html }) => { order.push('transform'); return html + ' transformed'; },
    renderAssets: async () => { order.push('assets'); return { head: '<meta name="asset">', body: '' }; },
  };
  const managed = await renderSite(required);
  expect(managed).toContain('body');
  expect(managed).toMatch(/ transformed<meta name="asset">$/);
  expect(order).toEqual(['transform', 'assets', 'shell']);
  order.length = 0;
  required.theme = { manifest: { name: 'Static', tier: 'static' }, templates: {}, liquidTemplates: {}, handlebarsTemplates: {} };
  expect(await renderSite(required)).toBe('<!doctype html><html><head><meta name="asset"></head><body>static</body></html>');
  expect(order).toEqual(['assets']);
});

function themed(tier: string): RenderSiteRequired {
  return {
    siteHeader, siteFooter, EMPTY_INLINE_RESOLVED, EMPTY_MEDIA_TRANSFORM_VERSIONS, EMPTY_MEDIA_ASSET_METADATA,
    theme: { manifest: { tier, name: "Theme" }, templates: { post: { component: "block" } },
      liquidTemplates: { post: "live liquid", preview: "preview liquid" }, handlebarsTemplates: { post: "live hbs" } },
    route: "post", siteTitle: "Site", posts: [], footerCredit: "credit", renderScriptAssets: () => "asset head",
    post: { id: "p", workspaceId: "ws", title: "Article", slug: "article", kind: "post", status: "published",
      bodyFormat: "doc", bodyHtml: null, bodyJson: {}, version: 1, updatedAt: "2026-11-26" },
    resolveTemplateId: ({ route, templates }) => route in templates ? route : undefined,
    resolveLiquidTemplateId: ({ route, liquidTemplates }) => route in liquidTemplates ? route : undefined,
    resolveHandlebarsTemplateId: ({ route, handlebarsTemplates }) => route in handlebarsTemplates ? route : undefined,
    loadLiquidSandbox: async () => ({ renderLiquidInSandbox: async ({ source, ctx }) => `Liquid: ${source} / ${ctx.post?.id}` }),
    loadHandlebarsSandbox: async () => ({ renderHandlebarsInSandbox: async ({ source, ctx }) => `Handlebars: ${source} / ${ctx.post?.id}` }),
    renderBlock: ({ node, ctx }) => `Blocks: ${JSON.stringify(node)} / ${ctx.post?.id}`,
    renderStaticPage: () => undefined, injectSiteAssistantIntoStaticPage: ({ html }) => html,
    entryContent: () => '<main>Fallback article</main>', entryList: () => '<main>Fallback list</main>',
    productEntryContent: () => '', productEntryList: () => '',
    pageShell: ({ title, body, documentAssets }) => `<title>${title}</title>${documentAssets.head}|${body}`,
  };
}

it("resolves live Liquid but uses the explicitly requested preview template instead when supplied", async () => {
  const required = themed("templated");
  expect(await renderSite(required)).toBe("<title>Article — Site</title>asset head|Liquid: live liquid / p");
  expect(await renderSite({ ...required, liquidTemplateIdOverride: "preview" }))
    .toBe("<title>Article — Site</title>asset head|Liquid: preview liquid / p");
  const missing = await renderSite({ ...required, liquidTemplateIdOverride: "missing" });
  expect(missing).toContain("<main>Fallback article</main>");
  expect(missing).not.toContain("Liquid:");
});

it("renders a Handlebars template and safely falls back for missing templates and sandbox errors", async () => {
  const required = themed("handlebars");
  expect(await renderSite(required)).toBe("<title>Article — Site</title>asset head|Handlebars: live hbs / p");
  const missing = await renderSite({ ...required, resolveHandlebarsTemplateId: () => null });
  expect(missing).toContain("<main>Fallback article</main>");
  expect(missing).not.toContain("Handlebars:");
  for (const tier of ["handlebars", "templated"]) {
    const unavailable = async () => { throw new Error("renderer <offline>"); };
    const html = await renderSite({ ...themed(tier), loadHandlebarsSandbox: unavailable, loadLiquidSandbox: unavailable });
    expect(html).toContain("<!-- theme render error: renderer &lt;offline&gt; -->");
    expect(html).toContain("<main>Fallback article</main>");
  }
});

it("renders a declarative block with the route context and falls back for a missing block", async () => {
  const required = themed("declarative");
  expect(await renderSite(required)).toBe('<title>Article — Site</title>asset head|Blocks: {"component":"block"} / p');
  const missing = await renderSite({ ...required, resolveTemplateId: () => null });
  expect(missing).toContain("<main>Fallback article</main>");
  expect(missing).not.toContain("Blocks:");
});

it("merges theme and host scripts in order without leaking consent-managed scripts into the default asset renderer", async () => {
  const required = themed("declarative");
  const theme = required.theme!;
  const renderScriptAssets = vi.fn<RenderSiteRequired["renderScriptAssets"]>(({ scripts }) =>
    scripts.map(({ src }) => `<script src="${src}"></script>`).join(""));
  const html = await renderSite({ ...required, theme: { ...theme, manifest: { ...theme.manifest,
    scripts: [{ src: "/theme.js" }, { src: "/analytics.js", consent: ["analytics"] }] } },
    scripts: [{ src: "/host.js" }, { src: "/ads.js", consent: ["marketing"] }], renderScriptAssets });
  expect(renderScriptAssets).toHaveBeenCalledExactlyOnceWith({ scripts: [{ src: "/theme.js" }, { src: "/host.js" }] });
  expect(html).toBe('<title>Article — Site</title><script src="/theme.js"></script><script src="/host.js"></script>|Blocks: {"component":"block"} / p');
});
