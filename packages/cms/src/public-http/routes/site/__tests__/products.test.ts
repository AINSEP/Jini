import { expect, it, vi } from "vitest";
import { serveStorefrontProduct, storefrontProductRoute, resolveStorefrontProduct, serveStorefrontProducts, resolveStorefrontProducts } from "../products.js";

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

function catalogFixture() {
  const product = { id: 'prod-14', slug: 'mug', title: 'Stoneware mug', price: 2400 };
  const theme = { id: 'theme-shop' };
  const visitor = { cache: 'private' };
  const reportFault = vi.fn(() => ({ errorId: 'fault-7' }));
  const faultHtml = vi.fn(() => '<main>Incident fault-7</main>');
  const sendFault = vi.fn();
  const renderSite = vi.fn(async () => '<main>Catalog</main>');
  const send = vi.fn(async () => {});
  const missingTheme = vi.fn();
  const context = {
    resolveRenderThemeId: async () => 'theme-shop', resolveActiveTheme: () => theme,
    resolveSiteAssistantWidgetForRequest: async () => 'vanilla' as const, title: async () => 'Pottery',
    noThemeId: 'off', missingTheme,
  };
  return {
    product, theme, visitor, renderSite, send, reportFault, faultHtml, sendFault, missingTheme,
    ports: { readiness: () => undefined, context, renderSite, perVisitor: () => visitor, send,
      operation: 'storefront', reportFault, faultHtml, sendFault },
  };
}

it('renders and sends the bounded catalog with the active theme and visitor policy', async () => {
  const { ports, product, theme, visitor, renderSite, send } = catalogFixture();
  const list = vi.fn(async () => [product]);
  await serveStorefrontProducts({ ...ports, list });
  expect(list).toHaveBeenCalledExactlyOnceWith({}, { readiness: undefined });
  expect(renderSite).toHaveBeenCalledExactlyOnceWith({
    theme, route: 'products', siteTitle: 'Pottery', posts: [], products: [product], siteAssistantEnabled: 'vanilla',
  });
  expect(send).toHaveBeenCalledExactlyOnceWith({ html: '<main>Catalog</main>', perVisitor: visitor });
});

it('exposes no products without a commerce adapter', async () => {
  expect(await resolveStorefrontProducts({ list: undefined })).toEqual([]);
  expect(await resolveStorefrontProduct({ id: 'mug', find: undefined })).toBeNull();
});

it('leaves the unavailable-theme response alone instead of sending a second catalog page', async () => {
  const { ports, renderSite, send, missingTheme } = catalogFixture();
  await serveStorefrontProducts({ ...ports, list: undefined, context: { ...ports.context, resolveActiveTheme: () => null } });
  expect(missingTheme).toHaveBeenCalledExactlyOnceWith();
  expect(renderSite).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it.each(['catalog', 'detail'] as const)('sends a diagnostic with the reported error ID after a %s read fails', async (surface) => {
  const { ports, reportFault, faultHtml, sendFault, send, renderSite } = catalogFixture();
  const error = new Error('product store offline');
  const fail = async () => { throw error; };
  if (surface === 'catalog') await serveStorefrontProducts({ ...ports, list: fail });
  else await serveStorefrontProduct({ ...ports, id: 'mug', find: fail, decorateCheckout: vi.fn(), missing: vi.fn() });
  expect(reportFault).toHaveBeenCalledExactlyOnceWith({ error, operation: 'storefront' });
  expect(faultHtml).toHaveBeenCalledExactlyOnceWith({ errorId: 'fault-7' });
  expect(sendFault).toHaveBeenCalledExactlyOnceWith('<main>Incident fault-7</main>');
  expect(send).not.toHaveBeenCalled();
  expect(renderSite).not.toHaveBeenCalled();
});

it('treats an absent detail parameter as an empty lookup rather than the string undefined', async () => {
  const findProduct = vi.fn(async () => null);
  const renderPage = vi.fn(async () => 'page');
  const decorateCheckout = vi.fn(async () => 'checkout');
  expect(await storefrontProductRoute.handle({ raw: { params: {} }, deps: { findProduct, renderPage, decorateCheckout } })).toEqual({ kind: 'missing' });
  expect(findProduct).toHaveBeenCalledExactlyOnceWith({ id: '' });
  expect(renderPage).not.toHaveBeenCalled();
  expect(decorateCheckout).not.toHaveBeenCalled();
});
