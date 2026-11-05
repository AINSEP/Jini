---
name: commerce
description: Set up the site's one-time catalog, check commerce readiness, and explain member checkout and settlement.
---

Use the host's commerce setup and status tools. Installing this plugin does not enable it or its payment provider. Ask for payment credentials only through the host's secure settings flow, never in chat.

Checkout accepts one active one-time price for a signed-in member. Create a pending order first, then pay or resume that same order id. Never create another order merely to retry payment. The host supplies member, workspace, site, merchant account and test/live mode; do not accept those identities from a visitor.

Payment acceptance requires the deployed site's HTTPS address. Desktop manages settings and catalog; it does not receive public payment callbacks. Return and cancel URLs only display stored payment state. A completed browser redirect does not prove payment: only verified ledger evidence marks the order paid.

Disabling Commerce stops new purchases. Already-started payments retain their data and continue the host's disclosed settlement drain. Subscriptions, refunds, inventory, taxes, location collection and custom fraud decisions are not provided by this plugin.
