import { expect, it } from "vitest";
import { appendProductCheckout, productCheckoutWhenReady } from "../product-checkout.js";

it("purchase markup uses trusted workspace scope and exact escaped price, an external script, and accessible status", () => {
  const html = appendProductCheckout({ html: "<html><body><main>Product</main></body></html>", workspaceId: "site/foreign", priceId: 'price"><script>bad</script>' });
  expect(html).toMatch(/data-orders-url="\/api\/commerce\/v1\/workspaces\/site%2Fforeign\/orders"/);
  expect(html).toMatch(/data-price-id="price&quot;&gt;&lt;script&gt;bad&lt;\/script&gt;"/);
  expect(html).toMatch(/aria-live="polite"/);
  expect(html).toMatch(/<script src="\/commerce\/checkout.js" defer><\/script><\/main>/);
  expect(html).not.toMatch(/<script>bad|onclick=|window\./);
});
it("checkout markup fits theme layouts without a main element and fragment renders", () => {
  for (const source of ["<body>Product</body>", "Product"]) {
    const html = appendProductCheckout({ html: source, workspaceId: "site", priceId: "price" }, {});
    expect(html).toMatch(/Buy now/); expect((html.match(/data-commerce-checkout/g) ?? []).length).toBe(1);
  }
});

it("the host only displays purchase controls for an active, ready commerce plugin and exact price", async () => {
  for (const status of [{ active: false, ready: false }, { active: false, ready: true }, { active: true, ready: false }]) {
    expect(await productCheckoutWhenReady({ html: "Product", workspaceId: "site", productSlug: "book", currentOrigin: "https://shop.test", priceId: "price", commerce: { checkoutOrigin: async () => "https://shop.test", status: async () => status } })).toBe("Product");
  }
  const html = await productCheckoutWhenReady({ html: "Product", workspaceId: "site", productSlug: "book", currentOrigin: "https://shop.test", priceId: "price", commerce: { checkoutOrigin: async () => "https://shop.test", status: async () => ({ active: true, ready: true }) } });
  expect(html).toMatch(/Buy now/);
  let reads = 0;
  expect(await productCheckoutWhenReady({ html: "Product", workspaceId: "site", productSlug: "book", currentOrigin: "https://shop.test", priceId: undefined, commerce: { checkoutOrigin: async () => "https://shop.test", status: async () => { reads++; return { active: true, ready: true }; } } })).toBe("Product");
  expect(reads).toBe(0);
  expect(await productCheckoutWhenReady({ html: "Product", workspaceId: "site", productSlug: "book", currentOrigin: "https://shop.test", priceId: "price", commerce: undefined }, {})).toBe("Product");
});

it("desktop management links to the deployed shop and never includes a local purchase form", async () => {
  const html = await productCheckoutWhenReady({ html: "Product", workspaceId: "site", productSlug: "book/one", currentOrigin: "http://localhost:3000", priceId: "price", commerce: { status: async () => ({ active: true, ready: true }), checkoutOrigin: async () => "https://shop.test" } });
  expect(html).toMatch(/href="https:\/\/shop.test\/products\/book%2Fone"/);
  expect(html).toMatch(/Open shop to buy/); expect(html).not.toMatch(/data-commerce-checkout|checkout.js|Buy now/);
});
it("invalid or unavailable configured shop origins never produce payment controls or unsafe links", async () => {
  for (const origin of [null, "http://shop.test", "javascript:alert(1)", "https://user:secret@shop.test", "https://shop.test/path"]) {
    expect(await productCheckoutWhenReady({ html: "Product", workspaceId: "site", productSlug: "book", currentOrigin: "http://localhost", priceId: "price", commerce: { status: async () => ({ active: true, ready: true }), checkoutOrigin: async () => origin } })).toBe("Product");
  }
});

it('request readiness reuses the trusted checkout origin without settings or credential rereads', async () => {
  let reads = 0;
  const commerce = { status: async () => { reads++; throw new Error('readiness already resolved'); },
    checkoutOrigin: async () => { reads++; throw new Error('origin already resolved'); } };
  const html = await productCheckoutWhenReady({ html: 'Product', workspaceId: 'site', productSlug: 'book',
    currentOrigin: 'https://shop.test', priceId: 'price', commerce }, { readiness: { active: true, ready: true, checkoutOrigin: 'https://shop.test' } } as never);
  expect(html).toMatch(/Buy now/); expect(reads).toBe(0);
  const off = await productCheckoutWhenReady({ html: 'Product', workspaceId: 'site', productSlug: 'book',
    currentOrigin: 'https://shop.test', priceId: 'price', commerce }, { readiness: { active: false, ready: false, checkoutOrigin: 'https://shop.test' } } as never);
  expect(off).toBe('Product'); expect(reads).toBe(0);
});
