import { resolvePageRouteTheme } from "./pages/page-route-context.js";
import type { SiteProduct } from '../../http/site/render-context.js';
import type { ProductCheckoutReadiness } from './product-checkout.js';

/** Shared by live routes and static export: one bounded projection, no per-product price reads.
 * An absent commerce plugin exposes no products. @complexity O(24) response rows, <=2 DB reads. */
export async function resolveStorefrontProducts({ list }: {
  list: ((required: Record<string, never>, optional?: { readiness?: ProductCheckoutReadiness | undefined }) => Promise<SiteProduct[]>) | undefined;
}, optional: { readiness?: ProductCheckoutReadiness | undefined } = {}): Promise<SiteProduct[]> {
  return (await list?.({}, optional)) ?? [];
}

/** Missing adapters expose no product, while registered adapters keep the scoped point lookup. */
export async function resolveStorefrontProduct({ id, find }: {
  id: string; find: ((required: { idOrSlug: string }, optional?: { readiness?: ProductCheckoutReadiness | undefined }) => Promise<SiteProduct | null>) | undefined;
}, optional: { readiness?: ProductCheckoutReadiness | undefined } = {}): Promise<SiteProduct | null> {
  return await find?.({ idOrSlug: id }, optional) ?? null;
}

export const storefrontProductsRoute = {
  method: 'get' as const, path: '/products',
  async handle({ raw, deps }: {
    raw: unknown;
    deps: {
      readCatalog(required: Record<string, never>): Promise<SiteProduct[]>;
      renderPage(required: { products: SiteProduct[] }): Promise<string | null>;
    };
  }, _optional = {}): Promise<{ kind: 'page'; html: string } | { kind: 'missing' } | { kind: 'handled' }> {
    const products = await deps.readCatalog({});
    const html = await deps.renderPage({ products });
    if (html === null) return { kind: 'handled' };
    return { kind: 'page', html };
  },
};

export const storefrontProductRoute = {
  method: 'get' as const, path: '/products/:id',
  async handle({ raw, deps }: {
    raw: { params: Readonly<Record<string, string | undefined>> };
    deps: {
      findProduct(required: { id: string }): Promise<SiteProduct | null>;
      renderPage(required: { products: SiteProduct[]; product: SiteProduct }): Promise<string | null>;
      decorateCheckout(required: { html: string; product: SiteProduct }): Promise<string>;
    };
  }, _optional = {}): Promise<{ kind: 'page'; html: string } | { kind: 'missing' } | { kind: 'handled' }> {
    const id = String(raw.params.id ?? '');
    // The database point lookup reaches products beyond the bounded grid; id wins over slug.
    const product = await deps.findProduct({ id });
    if (!product) return { kind: 'missing' };
    const page = await deps.renderPage({ products: [product], product });
    if (page === null) return { kind: 'handled' };
    const html = await deps.decorateCheckout({ html: page, product });
    return { kind: 'page', html };
  },
};

async function resolveStorefrontPage<TTheme extends object>(required: {
  resolveRenderThemeId: () => Promise<string>;
  resolveSiteAssistantWidgetForRequest: () => Promise<boolean | 'react' | 'vanilla'>;
  title: () => Promise<string>; resolveActiveTheme: (required: { activeThemeId: string }) => TTheme | string | null;
  noThemeId: string; missingTheme: () => void;
}, _optional = {}) {
  const [activeThemeId, siteAssistantEnabled, siteTitle] = await Promise.all([
    required.resolveRenderThemeId(), required.resolveSiteAssistantWidgetForRequest(), required.title(),
  ]);
  const resolved = resolvePageRouteTheme({ resolved: required.resolveActiveTheme({ activeThemeId }), noThemeId: required.noThemeId });
  if (resolved.kind === 'missing') { required.missingTheme(); return null; }
  return { theme: resolved.theme, siteAssistantEnabled, siteTitle };
}

export async function serveStorefrontProducts<TTheme extends object, TVisitor>(required: {
  list: Parameters<typeof resolveStorefrontProducts>[0]['list']; readiness: () => ProductCheckoutReadiness | undefined;
  context: Parameters<typeof resolveStorefrontPage<TTheme>>[0];
  renderSite: (required: { theme: TTheme | null; route: 'products' | 'product'; siteTitle: string; posts: []; products: SiteProduct[]; product?: SiteProduct; siteAssistantEnabled: boolean | 'react' | 'vanilla' }) => Promise<string>;
  perVisitor: () => TVisitor; send: (required: { html: string; perVisitor: TVisitor }) => Promise<void>;
  operation: string; reportFault: (required: { error: unknown; operation: string }) => { errorId: string };
  faultHtml: (required: { errorId: string }) => string; sendFault: (html: string) => void;
}, _optional = {}): Promise<void> {
  try {
    const reply = await storefrontProductsRoute.handle({ raw: undefined, deps: {
      readCatalog: () => resolveStorefrontProducts({ list: required.list }, { readiness: required.readiness() }),
      renderPage: async ({ products }) => {
        const page = await resolveStorefrontPage(required.context);
        if (page === null) return null;
        return required.renderSite({ ...page, route: 'products', posts: [], products });
      },
    } });
    if (reply.kind === 'page') await required.send({ html: reply.html, perVisitor: required.perVisitor() });
  } catch (error) {
    const { errorId } = required.reportFault({ error, operation: required.operation });
    required.sendFault(required.faultHtml({ errorId }));
  }
}

export async function serveStorefrontProduct<TTheme extends object, TVisitor>(required: Omit<Parameters<typeof serveStorefrontProducts<TTheme, TVisitor>>[0], 'list'> & {
  id: string; find: Parameters<typeof resolveStorefrontProduct>[0]['find'];
  decorateCheckout: (required: { html: string; product: SiteProduct }) => Promise<string>; missing: () => void;
}, _optional = {}): Promise<void> {
  try {
    const reply = await storefrontProductRoute.handle({ raw: { params: { id: required.id } }, deps: {
      findProduct: ({ id }) => resolveStorefrontProduct({ id, find: required.find }, { readiness: required.readiness() }),
      renderPage: async ({ products, product }) => {
        const page = await resolveStorefrontPage(required.context);
        if (page === null) return null;
        return required.renderSite({ ...page, route: 'product', posts: [], products, product });
      },
      decorateCheckout: required.decorateCheckout,
    } });
    if (reply.kind === 'missing') { required.missing(); return; }
    if (reply.kind === 'page') await required.send({ html: reply.html, perVisitor: required.perVisitor() });
  } catch (error) {
    const { errorId } = required.reportFault({ error, operation: required.operation });
    required.sendFault(required.faultHtml({ errorId }));
  }
}
