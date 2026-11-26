import { expect, it, vi } from "vitest";
import { serveStorefrontProduct, storefrontProductRoute, resolveStorefrontProduct } from "../products.js";

it("missing detail performs no theme or checkout work and uses a point lookup", async () => {
  const find = vi.fn(async () => null);
  const renderPage = vi.fn(async () => "page");
  const decorateCheckout = vi.fn(async () => "checkout");
  const deps = { findProduct: ({ id }: { id: string }) => resolveStorefrontProduct({ id, find }), renderPage, decorateCheckout };
  expect(await storefrontProductRoute.handle({ raw: { params: { id: "beyond-grid" } }, deps })).toEqual({ kind: "missing" });
  expect(find).toHaveBeenCalledWith({ idOrSlug: "beyond-grid" }, {});
  expect(renderPage).not.toHaveBeenCalled();
  expect(decorateCheckout).not.toHaveBeenCalled();
});

it('renders before checkout and shares finalization while missing and already-handled replies stop', async () => {
  const order: string[] = [];
  const product = { id: 'id' } as import('../../../http/site/render-context.js').SiteProduct;
  const ports = { id: 'id', find: async () => product, readiness: () => undefined,
    context: { resolveRenderThemeId: async () => 'off', resolveSiteAssistantWidgetForRequest: async () => false, title: async () => 'title', noThemeId: 'off', resolveActiveTheme: () => 'off', missingTheme: () => { order.push('theme-missing'); } },
    renderSite: async () => { order.push('render'); return 'page'; }, decorateCheckout: async ({ html }: { html: string }) => { order.push('checkout'); return html + ':checkout'; },
    perVisitor: () => { order.push('visitor'); return {}; }, send: async ({ html }: { html: string }) => { order.push(html); },
    missing: () => { order.push('missing'); }, operation: 'detail', reportFault: () => ({ errorId: 'failure' }), faultHtml: () => 'fault', sendFault: () => { order.push('fault'); } };
  await serveStorefrontProduct(ports);
  expect(order).toEqual(['render', 'checkout', 'visitor', 'page:checkout']);
  order.length = 0;
  await serveStorefrontProduct({ ...ports, find: async () => null });
  expect(order).toEqual(['missing']);
  order.length = 0;
  await serveStorefrontProduct({ ...ports, context: { ...ports.context, resolveActiveTheme: () => null } });
  expect(order).toEqual(['theme-missing']);
});
