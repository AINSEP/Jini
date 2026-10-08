/**
 * Slice 8 of the `RouteDeps` god-object decomposition (2026-08-18) — the optional,
 * storefront-adjacent seams (the sample Tier-3 store plugin, the real commerce catalog read ports,
 * and the lipay payments plugin), extracted verbatim (fields + doc comments unchanged) from where
 * they lived inline in `RouteDeps` below.
 *
 * No route module has its own narrow deps type for any of these today (`routes/site/products.ts`/
 * `routes/site/payments-webhook.ts` both take full `RouteDeps`). Grouped here on the fields' own
 * cross-referencing doc comments — `commerceProductRepo`'s says "Optional, matching `store?:`
 * above's precedent" and `lipay`'s says "wired only by a composition root that has a real SQLite
 * handle, exactly like `store` above" — all four are optional, composition-root-gated,
 * storefront-facing seams that fall back gracefully when unset.
 */
export interface CommerceCatalogDeps {
  /** SPIKE: seam for the sample Tier-3 store plugin (data lives in plugin-owned `p_store__*`
   * tables). Optional — only the SQLite runtime wires it (see `index.ts`). */
  store?: {
    /** `slug` (readable-slugs S7): the product-detail link key — the plugin's `Product.slug`. */
    listProducts(): Promise<{ id: string; slug: string; title: string; price: number; stock: number; version: number }[]>;
    checkout(
      productId: string,
      qty: number
    ): Promise<
      | { ok: true; orderId: string; remainingStock: number; retries: number }
      | { ok: false; reason: "not-found" | "out-of-stock" | "conflict" | "invalid-quantity"; retries: number }
    >;
  };
  /**
   * Commerce catalog read ports (2026-08-12: wiring products into template render data).
   * Optional, matching `store?:` above's precedent — the real running server's composition root
   * (`server/deps.ts`) wires both against the SAME `content.db` every other repo already uses (no
   * `declareDataModule()`/plugin bootstrap needed, unlike `store`/`lipay`); the hermetic
   * `server/app.ts` test composition leaves them unset, and `routes/site/products.ts` falls back
   * to `store?.listProducts()` when absent — never a hard dependency a test has to fake.
   */
  commerceProductRepo?: CommerceProductRepoPort;
  commercePriceRepo?: CommercePriceRepoPort;
  /**
   * The lipay payments framework plugin's composed API (`features/plugins/lipay`). Optional and
   * wired only by a composition root that has a real SQLite handle, exactly like `store` above —
   * lipay's tables come from `declareDataModule()`, which the in-memory composition has no
   * counterpart for. `routes/site/payments-webhook.ts` reads this lazily per request, so its route
   * can be registered ahead of the blanket body parser while activation still happens later.
   */
  lipay?: LipayApi;
}


Historical production catalog wiring (removed while commerce stays off):

```ts
    // 2026-08-12: wiring products into template render data. Plain Drizzle repos over the SAME
    // `db` every other adapter above already shares — no plugin/`declareDataModule()` bootstrap
    // needed (unlike `store`/`lipay`), so this is as cheap as `mediaRepo` above, not a `store`-
    // style special case.
    commerceProductRepo: new SqliteCommerceProductRepo(kernel),
    commercePriceRepo: new SqliteCommercePriceRepo(kernel),
```

Historical raw-body registration order (same why retained in the moved HTTP handler):

```ts
  // MUST stay ahead of the blanket `express.json()` immediately below. Payment webhooks are
  // HMAC-signed over the exact received bytes, and the blanket parser destroys them — so this one
  // route registers its own `express.raw()` first and terminates the response before the JSON
  // parser layer is ever reached. See `routes/site/payments-webhook.ts`'s file header for why
  // registration order is the fix and why the API is resolved per request rather than captured
  // here. This is the only route in the app that inverts the parser/route registration order.
  registerPaymentsWebhookRoute(app, { resolveLipay: () => routeDeps.lipay ?? null });
```

Historical status registration:

```ts
  // ADR-001 bounded operational read: provider discovery reflects only the optional composed
  // payment runtime; configuration and downstream Commerce capabilities remain explicitly absent.
  mountRoutes(app, createCommerceModule(routeDeps));
```

Historical CMS route ordering:

```ts
  // SPIKE: sample Tier-3 store page — must precede the site `/:slug` catch-all.
  registerStoreRoutes(app, routeDeps);
  // `/products`/`/products/:id` — theme-rendered product grid/detail over the same store data.
  // Must also precede the site `/:slug` catch-all.
  registerProductRoutes(app, routeDeps);
```
