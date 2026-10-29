# `payments-stripe`

Implements commerce's canonical `PaymentProvider`: one-time hosted Checkout, signed webhooks and
session retrieval. Refunds, manual capture, voids, disputes and subscriptions are not supported.
The legacy Charges/Refunds adapter moved here on 2026-10-25 has been replaced (Phase 1, D1).

Install and load through `@jini-ai/plugins/host`, validate with `paymentsProviderContract`, then
initialize `payments/stripe` with `{}`. Register its guarded `leasedProviderItem` with explicit
`stripe: "payments-stripe"` bindings. Payments select one provider per account; never fan out.

Settings declare a public `accountId` and secret `test_secretKey`, `test_webhookSecret`,
`live_secretKey`, `live_webhookSecret` slots. The host resolves only the selected site's account
and mode into each call's `ProviderContext`, including its HTTP client, clock and URLs. No
environment lookup or credentials at initialization. One account per site/plugin and one webhook
endpoint per site/account/mode. Preserve exact raw webhook bytes for signature verification.

A lost Checkout response stays unknown: replay never creates a second session. Late evidence can
settle normally; unresolved payments require operator review. Never infer payment failure from a
missing response. Vendor-specific HTTP stays in this plugin so core consumers only import ports.
