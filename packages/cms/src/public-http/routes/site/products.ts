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
