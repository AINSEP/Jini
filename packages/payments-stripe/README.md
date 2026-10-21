# @jini-ai/payments-stripe

Stripe payment provider for the `@jini-ai/commerce` payments kernel, shipped as a bundled agent
plugin. The package root is the plugin root: `plugin.json` declares
`extensions["ai.jini.commerce"].provider = "./dist/index.js"`, and that module's default export is
the provider. Hosts register it through the trusted contribution loader
(`defineExecutablePluginContribution(paymentProviderContributionSpec({}))` +
`createPluginContributionLoader`), then `createKernelProviderRegistry`.

- **API:** PaymentIntents (`/v1/payment_intents`, `/capture`, `/cancel`), Refunds (`/v1/refunds`),
  Disputes (`/v1/disputes`). The `Stripe-Version` header is pinned (default `2024-06-20`).
- **Capabilities:** partial refunds, manual capture, void, disputes, `retrieve` with refunds,
  correlation echo (`metadata[jini_payment_id]`, `metadata[jini_refund_id]`), any currency.
- **Credentials** (resolved per call by the host into `ctx.credentials`): `secretKey`,
  `webhookSecret`, `webhookSecretPrevious` (rotation; an empty slot is ignored).
- **Transport:** every call goes through `ctx.httpClient` (the host's egress-guarded
  `HttpClientPort`). There is no dependency on the `stripe` npm SDK and no direct `fetch`.
- **Idempotency:** the kernel's `idempotencyKey` is sent as `Idempotency-Key` on every mutation.
- **Outcomes:** network errors, timeouts, 5xx, a 409 concurrency conflict, an unexpected status and
  an unreadable 2xx are `unknown` (money may have moved; reconcile with `retrieve`). Only
  responses that prove Stripe did not act are `rejected`: 402 → `DECLINED`, 400/404 →
  `INVALID_REQUEST`, 401/403 → `PROVIDER_ERROR`, 429 → retryable `PROVIDER_ERROR`, an idempotency
  parameter mismatch → `IDEMPOTENCY_CONFLICT`.
- **Webhooks:** `Stripe-Signature` HMAC-SHA256 over `${t}.${rawBody}`, constant-time compare,
  any `v1` against any active secret, 300 s replay window (`toleranceSec`), `livemode` checked
  against the account mode. Facts are keyed by the PaymentIntent id.
- **Currencies:** ISK and UGX are sent as two-decimal values (×100), per Stripe's documented
  special cases.

```ts
import stripe, { createStripeProvider } from "@jini-ai/payments-stripe";
const custom = createStripeProvider({}, { toleranceSec: 120 });
```

Test fixtures under `src/__tests__/fixtures/` are synthetic, built from Stripe's documented
object shapes. They still need to be replaced with sandbox recordings before live use.
