---
name: commerce
description: Set up the site's one-time catalog, check commerce readiness, and explain member checkout and settlement.
---

Use the host's commerce setup and status tools. Installing this plugin does not enable it or its payment provider. Ask for payment credentials only through the host's secure settings flow, never in chat.

For a host application, set up checkout in this order:

1. Enable Commerce and the selected payment provider through the existing plugin activation controls. Use `provider status` to discover the provider plugin id. Open its secure settings card through the host. For Stripe, save the merchant `accountId` and the selected mode's `test_secretKey`/`test_webhookSecret` or `live_secretKey`/`live_webhookSecret` in that human form. Never put these keys in tool arguments, general settings or chat.
2. Use `inspect settings definitions` to inspect namespace `core.commerce`. Save its workspace `configuration` with `save the workspace setting`: `{"namespace":"core.commerce","key":"configuration","scope":"workspace","value":{"providerId":"stripe","accountId":"<matching merchant account id>","mode":"test","publicOrigin":"https://<deployed shop host>"}}`. `providerId` selects the payments provider; `accountId` must match its secure settings; `mode` is `test` or `live`; `publicOrigin` is an HTTPS origin without a path, query, credentials or fragment. Use the deployed shop origin, never the desktop address. Do not change this selection while original payments are draining.
3. Call `checkout status`. Its `checkout.webhookUrl`, when present, is the exact public URL the owner must register manually in the selected provider's webhook dashboard, using that mode's signing secret in the secure settings card. The host supplies the webhook URL; use the returned URL rather than guessing the site id. Webhook provisioning is manual. A ready status does not prove external reachability: verify delivery on the deployed site in provider test mode before live acceptance.
4. Call `create a checkout product({name:"Notebook",slug:"notebook"})`, then `create a checkout price({productId:"<returned product id>",amount:{minorUnits:123,currency:"JPY"}})`. Prices are immutable positive integer minor units; JPY has no decimal units. Setup activates the prepared catalog only when the plugin and provider configuration are usable. Check `checkout status` again and explain any unavailable reason before offering checkout.

For Stripe's one-time checkout, set the webhook endpoint API version to `2024-06-20`, matching the provider's pinned request version, and register `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. Keep test and live endpoint signing secrets in their corresponding secure fields. A completed session with an unpaid payment status must remain unpaid.

Checkout accepts one active one-time price for a signed-in member. Create a pending order first, then pay or resume that same order id. Never create another order merely to retry payment. The host supplies member, workspace, site, merchant account and test/live mode; do not accept those identities from a visitor.

On the deployed shop, authenticated members create orders with `POST /api/commerce/v1/workspaces/<workspaceId>/orders` and `{priceId,quantity?}`, then pay/resume with `POST .../orders/<orderId>/pay` and `{}`. The host's member session and same-origin checks apply. Use the returned payment intent's redirect/action; browser callbacks are `/commerce/return?orderId=<saved id>` and `/commerce/cancel?orderId=<saved id>`. Read an owned order with `GET .../orders/<orderId>`; callbacks and reads remain ledger-only when new purchases are disabled.

Payment acceptance requires the deployed site's HTTPS address. Desktop manages settings and catalog; it does not receive public payment callbacks. Return and cancel URLs only display stored payment state. A completed browser redirect does not prove payment: only verified ledger evidence marks the order paid.

Disabling Commerce stops new purchases. Already-started payments retain their data and continue the host's disclosed settlement drain. Subscriptions, refunds, inventory, taxes, location collection and custom fraud decisions are not provided by this plugin.
