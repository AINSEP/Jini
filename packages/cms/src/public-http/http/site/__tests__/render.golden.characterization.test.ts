import { expect, it } from 'vitest';
import { renderSite, type RenderSiteRequired } from '../render-site.js';

it('transforms managed bodies before collecting assets and bypasses the shell for complete static home', async () => {
  const order: string[] = [];
  const required: RenderSiteRequired = {
    theme: null, route: 'home', siteTitle: 'Site', posts: [], footerCredit: 'credit', renderScriptAssets: () => '',
    resolveTemplateId: () => undefined, resolveLiquidTemplateId: () => undefined, resolveHandlebarsTemplateId: () => undefined,
    loadLiquidSandbox: async () => ({ renderLiquidInSandbox: async () => '' }), loadHandlebarsSandbox: async () => ({ renderHandlebarsInSandbox: async () => '' }), renderBlock: () => '',
    renderStaticPage: () => '<!doctype html><html><head></head><body>static</body></html>',
    injectSiteAssistantIntoStaticPage: ({ html }) => html,
    entryContent: () => '', entryList: () => 'body', productEntryContent: () => '', productEntryList: () => '',
    pageShell: ({ body, documentAssets }) => { order.push('shell'); return `${body}${documentAssets.head}`; },
    transformBody: async ({ html }) => { order.push('transform'); return html + ' transformed'; },
    renderAssets: async () => { order.push('assets'); return { head: '<meta name="asset">', body: '' }; },
  };
  expect(await renderSite(required)).toContain('body');
  expect(order).toEqual(['transform', 'assets', 'shell']);
  order.length = 0;
  required.theme = { manifest: { name: 'Static', tier: 'static' }, templates: {}, liquidTemplates: {}, handlebarsTemplates: {} };
  expect(await renderSite(required)).toBe('<!doctype html><html><head><meta name="asset"></head><body>static</body></html>');
  expect(order).toEqual(['assets']);
});
