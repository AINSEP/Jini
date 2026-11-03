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

# @jini-ai/provider-plugins/payments-stripe

Self-contained Stripe hosted Checkout provider artifact for the commerce kernel. Registers `payments/stripe` (contract version 1).

Resolve `@jini-ai/provider-plugins/package.json` with the host's Node package resolver,
discover the versioned artifact beneath `plugins/payments-stripe/<package-version>`,
and pass it through the existing Jini plugin installer and provider artifact loader.
Installation alone does not enable or configure the provider. The artifact has no runtime npm dependencies and contains only this provider's prebuilt payload
and retained licenses.

Sources remain in `packages/provider-plugins/src/payments-stripe`. The distribution’s `build` and `prepack`
call the existing single-plugin builder; the generated `plugins/` payload is not source.
The npm version supplies the artifact version; SDK ranges and provider identities are preserved.

Preserves commerce Phase 1 hosted Checkout/evidence behavior. See NOTICE for the
Open SaaS source commit and complete MIT attribution retained in the artifact.
