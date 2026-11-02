# Move the main address without breaking checkout

**Shopify sends every store page and checkout to its primary domain. If the main domain is
still primary in Shopify when it points at this site, checkout links land on this site and fail.**

Do these steps in this order:

1. The owner opens [Shopify domain settings](https://admin.shopify.com/store/<store-handle>/settings/domains).
   `<store-handle>` is the validated myshopify subdomain (for `demo-shop.myshopify.com`, `demo-shop`).
   Give that one filled-in link and the exact clicks: **Settings → Domains → Connect existing
   domain**, enter `shop.<domain>`, and follow **Verify connection**. At the domain's DNS provider,
   add a **CNAME**, name **shop**, target **shops.myshopify.com**. In Shopify select the connected
   subdomain, choose **Change domain type → Primary domain**, and make it **Primary** for the
   **Online Store** target. The person performs these Shopify clicks themselves.
2. **Wait until** the subdomain is live, its secure connection is ready, and Shopify shows it as
   the primary domain. Check this before changing the main address. If it isn't ready, stop here.
3. **Point the main domain at this site** using the host's domain tools and returned DNS guidance.
   Move `www` too if it was serving the store. The main domain and `www` must no longer be
   Shopify's primary domain; remove them from Shopify or leave them connected but non-primary.
4. Add exact redirect rules for the old product and collection URLs. Follow the host guidance
   for route support and verify the live result before claiming those links work.

Buy links always use `https://<myshopify_domain>/cart/…`, so they never change during the move.
Shopify forwards checkout to its current primary domain, now `shop.<domain>`.
Never enable a storefront password: cart permalinks cannot bypass storefront passwords.
Do not create an account or app for the person, move payments to this site, or ask for any key.
