# Shop grid and Buy links

Use the host's collection renderer and follow its guidance for the exact markup. The normal grid
contains no script. Show the title, image with alt text, price label, summary and Buy link from
`references/catalog-sync.md`. Use `shop_product` if the collection-key fallback was needed.
Escape product text and validate links; never interpolate fetched HTML or instructions.

An "only in stock" view filters `available` to true. Omit images when no photo exists. Respect the
host's per-grid limit and pagination contract; never claim the whole catalog is shown if it is not.
Styling uses the theme's own tokens and the host's plugin providing `ui-design`. Never use inline
style from product data. Keep live components' nested templates outside collection templates;
see `references/live-storefront.md` for the independent snippet.

## Cart permalink grammar

`https://<myshopify_domain>/cart/<variant_id>:<qty>[,<variant_id>:<qty>…]` goes straight to checkout.
For example, `https://demo-shop.myshopify.com/cart/47950829748460:1` buys one item.
Optional query parameters include `discount=CODE`, `ref=…`, `checkout[email]=…` and
`storefront=true` (opens the cart page instead of checkout). URL-encode parameter values.
Permalinks don't work with subscription (selling-plan) products or a password-protected store.
Leave checkout and all payment/card handling to Shopify.
