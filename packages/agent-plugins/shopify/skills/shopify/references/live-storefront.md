# Optional live prices, stock and cart

Use Shopify Storefront Web Components only when the owner wants live prices or a cart drawer.
This content-only option uses the host's theme tools; no host changes or new remote server.
It works without a token for product prices, availability, cart and Buy now.

Place this independent snippet in the host's supported **theme partial** or equivalent script-capable
surface. Follow the host guidance for placement and script policy. Substitute the validated `myshopify_domain`
and the chosen product's handle; don't paste unchecked fetched text into attributes or scripts.
Use one store and cart per page; product contexts may repeat with different handles.

```html
<script src="https://cdn.shopify.com/storefront/web-components.js"></script>
<shopify-store id="shopify-store" store-domain="https://<myshopify_domain>" country="US" language="en"></shopify-store>
<shopify-context type="product" handle="<product_handle>">
  <template>
    <shopify-money query="product.selectedOrFirstAvailableVariant.price" format="money_with_currency"></shopify-money>
    <button onclick="getElementById('shopify-cart').addLine(event).showModal();" shopify-attr--disabled="!product.selectedOrFirstAvailableVariant.availableForSale">Add to cart</button>
    <button onclick="getElementById('shopify-store').buyNow(event);" shopify-attr--disabled="!product.selectedOrFirstAvailableVariant.availableForSale">Buy now</button>
  </template>
</shopify-context>
<shopify-cart id="shopify-cart"></shopify-cart>
```

Keep the component's nested `<template>` outside any host collection template. Follow the host's
renderer guidance; the normal collection grid remains the script-free option.

A Storefront **public** token (Headless channel) is needed only for inventory counts and metafields.
It's public by design and sits in page HTML as `public-access-token`. It doesn't go in the vault.
Availability (`availableForSale`) needs no token. Never ask the person for a private key here.

Check the host's content security policy before using the CDN script. Follow its guidance;
never add vendor-specific policy rules to core. Use the domain order in `domains.md`;
checkout stays on Shopify.
