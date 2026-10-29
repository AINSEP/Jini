# `@jini-ai/commerce` — Phase 1 plan: one-time purchases through a real provider

Plan only; no code changed. Written 2026-10-29 on top of `32226f0e` (branch
`cloud/commerce-opensaas-1029`). Row numbers (#N) refer to `REPORT-opensaas-gap.md`.
Paths are relative to `packages/commerce/` unless they start with `packages/` or `open-saas/`.

**Phase 1 goal.** A member buys one active one-time price, is redirected to a real Stripe-hosted
checkout, pays, and the order becomes `paid`, using only mechanisms that already exist:
`checkout()` → `PaymentsPort.createIntent` → `NextAction` → webhook receiver → inbox worker →
single writer → outbox → order projection.

```
checkout()  ──order──▶  payOrder()  ──createIntent(reference=order.id, line)──▶  PaymentsPort
                                                                                  │ provider.createIntent
browser ◀── NextAction{redirect} ◀── PaymentView.next ◀─────────────────────────── Stripe plugin
Stripe ──webhook──▶ receive (verify → facts | ignored) ──▶ inbox ──▶ worker ──▶ single writer
                                                                                  │ outbox payment.succeeded{reference}
                                               order projector ◀── host bus ◀──── outbox relay
                                               orders.markPaid(order.id)
```

---

## 0. Plugin model (owner requirement, 2026-10-29)

> Every payment vendor (Stripe now; PayPal, Lemon Squeezy, Paddle and Polar later) is a
> **self-contained, attachable plugin** that implements the core commerce `PaymentProvider`
> contract. Core keeps only the vendor-neutral contract plus the default provider. A site turns a
> vendor on by attaching its plugin, never by changing code in core. Phase 1 **extends the existing
> `payments-stripe` plugin**; it does not create a second one.

### 0.1 Where the plugin lives

`packages/provider-plugins/src/payments-stripe/`, inside the existing `@jini-ai/provider-plugins`
distribution. That distribution's build (`scripts/build.ts`) emits one self-contained,
digest-pinned folder per plugin, listed in `catalog.json`. The plugin keeps its id
`payments-stripe` and its manifest `jini.plugin.json`. The legacy `stripe.ts` adapter inside it is
rewritten in place against the commerce contract (§2.12). Later vendors are siblings in the same
distribution, each self-contained: `payments-paypal/`, `payments-lemonsqueezy/`,
`payments-paddle/`, `payments-polar/`. Core never imports any of them, and they import only
**types** from `@jini-ai/commerce` plus its testkit (devDependency).

### 0.2 How a host attaches and registers it

This uses the mechanism that already exists (`src/payments/plugin-contribution.ts`,
`src/payments/provider-registry.ts`). No new registry is added.

1. The plugin's `jini.plugin.json` declares
   `"extensions": { "ai.jini.commerce": { "provider": "./provider.js" } }`. The default export of
   `provider.js` is the `PaymentProvider` object.
2. The host installs or attaches the plugin folder and passes commerce's
   `PaymentProviderContributionSpec` to `@jini-ai/agent-plugins`'
   `defineExecutablePluginContribution` / `createPluginContributionLoader`. That loader owns trust:
   activation, shipped-digest verification and module containment. Commerce's `validate` runs
   `paymentProviderModuleProblem` on the export, so a malformed plugin is refused, never half-loaded.
3. The loaded items go into the kernel provider registry. It refuses duplicate ids and binds the
   id `stripe` to the plugin `payments-stripe`, so a second plugin cannot claim `stripe` and receive
   its webhooks (`provider-registry.ts:7-8`).
4. A site **selects** the vendor per scope: the `PaymentScope.providerId` / `providerAccountId` /
   `mode` it configures, and the webhook endpoint it registers
   (`POST …/payments/webhooks/:siteId/stripe/:endpointId`). Turning Stripe off means detaching the
   plugin or removing the scope. Core code never changes.

The legacy `setup(sdk) { sdk.providers.register({ contract: 'payments', … }) }` in
`payments-stripe/index.ts`, which registers the old capability-providers port, is **removed**.
The commerce extension above is the only way a payments vendor attaches. See D12 for the manifest's
`contributes.providers` entry.

### 0.3 How credentials are supplied (the plugin owns its fields)

- **The plugin declares its own fields**, in two places that must agree:
  - `PaymentProvider.credentialKeys = ["secretKey", "webhookSecret"]` is what the kernel resolves.
  - `jini.plugin.json` → `contributes.providers[0].settings` is what the host settings UI renders.
    It follows the `analytics-posthog` pattern: `{ "name": "secretKey", "label": "Secret key",
    "secret": true, "required": true, "hint": "Stripe Dashboard → Developers → API keys (sk_live_… / sk_test_…)" }`
    and `{ "name": "webhookSecret", "label": "Webhook signing secret", "secret": true, "required": true,
    "hint": "… (whsec_…)" }`.
  - A manifest test (S10) asserts the two name lists are equal.
- **Values** are stored by the host's secret store, per provider account **and mode**. They reach
  the plugin only as `ctx.credentials`, which the host's `ProviderContextPort.resolve`
  (`provider-registry.ts:81-86`) fills for exactly this scope. The kernel checks every slot before
  any call (`NO_CREDENTIALS_CONFIGURED` otherwise).
- The plugin never reads environment variables or globals, keeps no key in module state, and makes
  every outbound call through `ctx.httpClient`. Rotation follows the existing contract note: add a
  `webhookSecretPrevious` slot when someone needs it. Phase 1 does not add it.
- Core has **no** Stripe-named credential, setting or constant.

### 0.4 "No Stripe outside the plugin": verified 2026-10-29

- `rg "from ['\"]stripe['\"]|require\(['\"]stripe['\"]\)|\"stripe\":"` over `packages/` and
  `examples/` finds **no import of the `stripe` SDK anywhere**. The only hit is a test string in
  `provider-plugins/src/__tests__/core-boundary.test.ts:104`.
- That boundary test already **fails the build** if any workspace package other than the plugin
  distribution imports `stripe` (its `VENDOR` regex includes `stripe$`), so the rule is enforced,
  not just true today. The Phase 1 plugin uses raw REST, so the plugin itself takes no SDK either.
- Stripe *mentions* in core are comments and examples only (`contract/provider.ts:5`,
  `contract/scope.ts:18-20`, `state/status.ts:6,35,41`, `contract/evidence.ts:39`,
  `catalog/checkout.ts:55`, `catalog/types.ts:132`, `plugin-contribution.ts:17-18`). They are
  harmless and left alone.
- **One real leak:** `src/react/Payments.tsx:56-57` hard-codes `Stripe` and `PayPal` badges in
  the core panel. S12 replaces them with a `providers: readonly ProviderSummary[]` prop, which the
  host fills from `PaymentsPort.listProviders()`, so attaching a plugin is what makes a vendor
  appear.
- S10 adds one more boundary case: no file outside `provider-plugins/src/payments-stripe/` contains
  `api.stripe.com`. That catches a raw-REST leak the import check cannot see.

### 0.5 The "default provider"

Today core has **no production provider**. The only in-core provider is the deterministic LiPay
fake (`src/payments/testkit/lipay-fake.ts`, exported from `./payments/testkit`). It is test-only
and must never be selectable in `live` mode. Phase 1 keeps it as the default dev/test provider and
updates it for the new contract fields (S1). Whether "default provider" should mean something more
(for example a "manual / pay offline" provider usable in production) is **D11**.

### 0.6 Will PayPal, Lemon Squeezy, Paddle and Polar fit without core changes?

This checks every contract field Phase 1 adds or relies on against the four later vendors.

| Contract element | Stripe | PayPal | Lemon Squeezy | Paddle | Polar | Verdict |
|---|---|---|---|---|---|---|
| `createIntent` → `NextAction` | `redirect` (Checkout) | `redirect` (approve link) | `redirect` (checkout URL) | `client_action` (overlay, `transactionId`), or `redirect` | `redirect` | generic |
| `ProviderContext.returnUrl` | `success_url` | `return_url` | `checkout_data…redirect_url` | `checkout.url` / client success | `success_url` | generic |
| `ProviderContext.cancelUrl` | `cancel_url` | `cancel_url` | — (ignored) | — (ignored) | — (ignored) | generic: required of hosts, optional for plugins to use |
| `IntentLine.providerPriceRef` | Price id | none (ignored; amount-only orders) | variant id | price id | product/price id | generic name, **not** Stripe-only |
| `IntentLine.description` / `quantity` | line item | `purchase_units[].items` | — | items | — | generic; ignorable |
| `IntentRequest.idempotencyKey` | `Idempotency-Key` header | `PayPal-Request-Id` | none | none | none | generic. Vendors without one may create a duplicate *checkout* on a kernel retry. No money moves until the shopper pays, and the kernel's existing quarantine catches the mismatch. Documented in the contract, not a core change. |
| `customerPortal(customerRef)` + capability | billing-portal session | none → capability `false` | `GET /customers/{id}` → `urls.customer_portal` | `customerPortalSessions.create` | customer session | generic |
| `verifyWebhook(rawBody, headers, ctx)` | HMAC, local | **API call** (`verify-webhook-signature`, needs a `webhookId` credential slot) via `ctx.httpClient`; `unknown` → 503 → redelivery | HMAC (`X-Signature`) | HMAC (`Paddle-Signature`) | Standard Webhooks HMAC | generic |
| `WebhookFact.providerEventId` (required) | `event.id` | `id` | **no stable event id**: the plugin derives a deterministic one (hash of `meta.event_name` + `data.id` + `updated_at`) | `event_id` | `webhook-id` header | generic; the derivation requirement is added to the contract doc in S1 |
| `ok([])` = ignored (#31) | unhandled types | same | same | same | same | generic |
| `credentialKeys` + manifest `settings` | `secretKey`, `webhookSecret` | `clientId`, `clientSecret`, `webhookId` | `apiKey`, `storeId`, `webhookSecret` | `apiKey`, `webhookSecret` | `accessToken`, `webhookSecret` | generic (each plugin owns its fields) |
| `capabilities.currencies` | `any` | list | `any` (store currency) | list | list | generic |

**Fields that fit Stripe only:** none in the core contract. The Stripe-specific choices stay in
the plugin: Checkout Session as the `providerRef`, `metadata[jini_payment_id]` for correlation,
the `expand[]=payment_intent` retrieve, and the Bearer + form encoding.

**Two gaps would force a core change for some later vendors.** Neither is Stripe-specific, and
neither blocks Phase 1:

1. **Merchant-of-record tax (Lemon Squeezy, Paddle, Polar).** These vendors can charge our amount
   *plus* tax. `PaymentEvidence.amount` is checked against our amount, so a tax-exclusive charge
   would be **quarantined**. Before the first merchant-of-record plugin, core needs an optional
   `tax?: Money` on the evidence, and the amount check must compare the pre-tax amount. This is
   gap #19's "record outcomes" item. Until then those plugins must use tax-inclusive prices. See D13.
2. **Subscription facts (Lemon Squeezy, Paddle, Polar, and Stripe Phase 2).** `WebhookFact` carries
   payment evidence only (#13). One-time purchases from all five vendors fit today. Their
   subscription events need the Phase 2 fact union, which is a planned core change shared by every
   vendor, not a per-vendor one.

---

## 1. Scope

### In

| # | Item | Shape in one line |
|---|---|---|
| 12 | Catalog checkout creates the payment | New `payOrder()` calls the **existing** `PaymentsPort.createIntent` with the order id as `reference`; a projector marks the order `paid` from the outbox. No second payment path. |
| 3 | Purchase effect union | `CommercePurchaseEffect = { kind: "none" } \| { kind: "credits"; credits }` on the product. Data shape + validation only; nothing consumes it yet. |
| 4 | Our price ↔ vendor price | `CommercePriceProviderRefRepoPort`, keyed by (workspace, price, provider, provider account, **mode**). Its value reaches the provider through a new neutral `IntentRequest.line`. |
| 8 | Customer portal | Optional `PaymentProvider.customerPortal?`, gated by a new `capabilities.customerPortal`; exposed as the non-money `PaymentsPort.customerPortal`. |
| 10 | Browser open-checkout contract | `openCheckout({ next, navigate })` over the existing `NextAction` (`redirect` / `client_action`), with a scheme allow-list. Universal entry, no React. |
| 11 | Cancel URL | `ProviderContext.cancelUrl` (required, host-resolved like `returnUrl`). |
| 31 | Unhandled webhook types | Documented contract: a verified event the provider does not translate is `ok([])`. The receiver answers `200 { received: 0, duplicates: 0, ignored: true }` and writes nothing. |
| 28 | Stripe provider plugin | The **existing** `packages/provider-plugins/src/payments-stripe/` plugin (same id, same folder; §0), extended onto the commerce `PaymentProvider` contract: hosted Checkout Session (`mode=payment`), `retrieve`, signature-verified webhooks → `WebhookFact`, billing-portal link. Vendor code lives only here. |

### Out (Phase 2+ or never in core)

- Subscriptions, recurring checkout and their fact kinds: #1, #2, #13–#16. `billingInterval` prices are **refused** by `payOrder` in Phase 1.
- Credit ledger, entitlement consumer and gating: #5–#7. The #3 effect is stored only.
- Customer identity map / `ensureCustomer`: #9. Phase 1's `customerPortal` takes a caller-supplied `customerRef` (see D5).
- Stripe refunds, disputes, manual capture and void. The plugin declares `refunds: "none"`, `disputes: false`, `capture: "auto"`, `void: false`. The kernel's refund ops refuse it with `CAPABILITY_UNSUPPORTED`, which already works.
- Order `failed` / `canceled` projection. There is no `payment.failed` topic today. An abandoned order stays `pending`, and no money is involved (D6).
- Retiring the catalog's second webhook inbox (`CommerceWebhookEventRepoPort.applyProviderEvent`, `catalog/ports.ts:65-89`). Phase 1 stops *using* it but does not delete it (D3).
- Tax, coupons, invoices, revenue, pricing/account UI, email: #17–#27.
- Polar, Paddle and Lemon Squeezy plugins.

---

## 2. Contracts: exact TypeScript

All new functions follow the house shape `fn(required, optional = {})`. Dependencies are ports.
Every function stays under cyclomatic complexity 11. Nothing throws across a provider boundary.

### 2.1 `src/payments/contract/provider.ts` (edited)

```ts
export interface ProviderCapabilities {
  // …existing fields unchanged…
  /** `customerPortal` method present. A self-serve billing page; never moves money. */
  readonly customerPortal: boolean;
}

export interface ProviderContext {
  // …credentials, account, httpClient, now, webhookUrl, returnUrl unchanged…
  /** Absolute URL the shopper lands on after abandoning a hosted checkout. Host-resolved per site + account, like `returnUrl`. */
  readonly cancelUrl: string;
}

/** What is being bought, for providers whose hosted checkout shows line items. Optional: the kernel's amount stays the truth. */
export interface IntentLine {
  /** Shown to the shopper (the product name snapshot). Never personal data. */
  readonly description: string;
  /** Integer ≥ 1. `amount` must equal unit × quantity; a provider-reported mismatch is quarantined by the existing amount check. */
  readonly quantity: number;
  /** The provider's own price id for (price, provider account, mode), when the host mapped one (#4). */
  readonly providerPriceRef?: string;
}

export interface IntentRequest {
  // …existing fields unchanged…
  readonly line?: IntentLine;
}

export interface PaymentProvider {
  // …existing members unchanged…
  /** Present iff `capabilities.customerPortal`. Read-only: no ledger row, no grant, no idempotency. */
  customerPortal?(
    required: { customerRef: string; ctx: ProviderContext },
    optional?: { signal?: AbortSignal }
  ): Promise<Outcome<{ readonly url: string }>>;
  /**
   * (doc only, #31) … A verified event whose type this provider does not translate is `ok([])`,
   * never `rejected`: a 4xx makes the provider redeliver it forever.
   */
  verifyWebhook(/* signature unchanged */): Promise<Outcome<readonly WebhookFact[]>>;
}
```

### 2.2 `src/payments/provider-module-guard.ts` (edited)

```ts
export const OPTIONAL_PROVIDER_METHODS = ["refund", "capture", "void", "retrieve", "customerPortal"] as const;
// CAPABILITY_CHECKS += [(c) => typeof c.customerPortal === "boolean", "capabilities.customerPortal must be a boolean"]
// CAPABILITY_METHOD_RULES += ["customerPortal", "capabilities.customerPortal === true", (c) => c.customerPortal === true]
```

### 2.3 `src/payments/contract/payments-port.ts` (edited)

```ts
export interface ProviderSummary {
  // …existing…
  readonly customerPortal: boolean;
}

export type PortalResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly error: PaymentError };

export interface PaymentsPort {
  createIntent(
    required: { scope: PaymentScope; amount: Money; idempotencyKey: string; reference: string },
    optional?: {
      captureMode?: "auto" | "manual"; partyId?: string;
      providerOptions?: Readonly<Record<string, unknown>>;
      /** Forwarded to the provider unchanged. Not part of the idempotency comparison (`reference` already pins the order). */
      line?: IntentLine;
    }
  ): Promise<IntentResult>;
  // refund/capture/void/getPayment/listProviders unchanged
  /** Non-money: no grant, no ledger write. `CAPABILITY_UNSUPPORTED` when the provider has no portal. */
  customerPortal(
    required: { scope: PaymentScope; customerRef: string },
    optional?: { signal?: AbortSignal }
  ): Promise<PortalResult>;
}
```

### 2.4 `src/payments/ops/portal.ts` (new)

```ts
/** checkProvider → capability → checkText(customerRef) → resolveContext → dispatch(provider.customerPortal). `unknown` and `rejected` both map to ok:false. */
export async function customerPortal(
  { deps, required }: { deps: OpsDeps; required: { scope: PaymentScope; customerRef: string } },
  optional: { signal?: AbortSignal } = {}
): Promise<PortalResult>;
```

It reuses `checkProvider`, `checkText`, `resolveContext`, `dispatch` and `fail` from
`ops/common.ts`. It adds no new helper there.

### 2.5 `src/payments/ingest/receive.ts` (edited, #31)

```ts
export interface WebhookResponse {
  readonly status: 200 | 400 | 404 | 500 | 503;
  readonly body:
    | { readonly received: number; readonly duplicates: number; readonly ignored: boolean }
    | { readonly code: string; readonly message: string };
}
```

When `verified.facts.length === 0`, `receive` returns `200 { received: 0, duplicates: 0, ignored: true }`
**before** opening a ledger transaction. Every other 200 carries `ignored: false`.

### 2.6 `src/payments/accounting/apply-evidence.ts` (edited)

`payment.succeeded` payloads gain `reference: string` (our order id or other caller reference,
never personal data) at both enqueue sites (`:253`, `:413`). No new topic and no new column:
`reference` is already on the payment row.

### 2.7 `src/payments/contract/checkout-client.ts` (new, universal, #10)

```ts
import type { NextAction } from "./evidence.js";

export type OpenCheckoutResult =
  | { readonly kind: "navigated"; readonly url: string }
  | { readonly kind: "client_action_handled" }
  | { readonly kind: "nothing_to_open"; readonly next: "none" | "out_of_band" }
  | { readonly kind: "refused"; readonly reason: "unsafe_url" | "no_client_action_handler" };

/** Browser-side handler for a provider's in-page flow (Paddle overlay, 3-D Secure). Supplied by a provider's client glue. */
export type ClientActionHandler = (
  required: { payload: Readonly<Record<string, unknown>> },
  optional?: Record<string, never>
) => Promise<void>;

/**
 * Opens what `PaymentView.next` asks for. `navigate` is the DI seam (`(url) => window.location.assign(url)` in a host).
 * Only `https:` URLs are followed (`http:` only for `localhost`/`127.0.0.1`); `javascript:`, `data:` etc. are refused.
 */
export async function openCheckout(
  required: { next: NextAction; navigate: (required: { url: string }) => void },
  optional?: { clientAction?: ClientActionHandler }
): Promise<OpenCheckoutResult>;
```

It is exported from a new universal entry `@jini-ai/commerce/payments/client`, so a browser bundle
never pulls the node kernel.

### 2.8 `src/catalog/types.ts` + `src/catalog/effect.ts` (#3)

```ts
// types.ts
/** What buying a product grants. Phase 2 adds `{ kind: "subscription"; grantsMemberTierId: UUID }`. */
export type CommercePurchaseEffect =
  | { readonly kind: "none" }
  | { readonly kind: "credits"; readonly credits: number };

export interface CommerceProductRecord {
  // …existing…
  /** `undefined` = `{ kind: "none" }`. */
  effect?: (CommercePurchaseEffect) | undefined;
}

// effect.ts (new)
export const MAX_CREDITS_PER_PURCHASE = 1_000_000;
/** null = valid. `credits` is a safe integer in 1..MAX_CREDITS_PER_PURCHASE. */
export function purchaseEffectProblem(
  required: { effect: unknown },
  optional?: Record<string, never>
): string | null;
```

`toProductRow` / `fromProductRow` (`catalog/repo.rows.ts:44-89`) serialize this to
`effect_json`. `save` refuses an invalid effect with `CommerceCheckoutValidationError`, the
package's existing validation error.

### 2.9 `src/catalog/ports.ts` (edited, #4 + #12)

```ts
export interface CommercePriceProviderRefRecord {
  workspaceId: UUID;
  priceId: UUID;
  providerId: string;
  providerAccountId: string;
  mode: PaymentMode;            // "test" | "live": a test ref never resolves in live mode
  providerPriceRef: string;
  createdAt: ISODateTime;
}

export interface CommercePriceProviderRefRepoPort {
  find(
    required: { workspaceId: string; priceId: string; providerId: string; providerAccountId: string; mode: PaymentMode },
    optional?: Record<string, never>
  ): Promise<string | null>;
  /** Upsert on the five-part key. */
  save(record: CommercePriceProviderRefRecord, optional?: Record<string, never>): Promise<void>;
}

export type MarkOrderPaidResult = "paid" | "already_paid" | "not_pending" | "not_found";

export interface CommerceOrderRepoPort {
  // …existing…
  /** `pending → paid` only, with `version + 1`, as one conditional UPDATE (no read-then-write). Idempotent. */
  markPaid(
    required: { workspaceId: string; orderId: string; at: ISODateTime },
    optional?: Record<string, never>
  ): Promise<MarkOrderPaidResult>;
}
```

### 2.10 `src/catalog/pay-order.ts` (new, #12)

```ts
export interface PayOrderDeps {
  orders: CommerceOrderRepoPort;
  prices: CommercePriceRepoPort;
  priceRefs: CommercePriceProviderRefRepoPort;
  payments: PaymentsPort;          // the EXISTING port; no parallel path
}

export interface PayOrderInput {
  workspaceId: UUID;
  orderId: UUID;
  /** Must name the same provider as `order.provider`, and the same workspace. */
  scope: PaymentScope;
}

export type PayOrderResult =
  | { readonly ok: true; readonly order: CommerceOrderRecord; readonly payment: PaymentView; readonly replayed: boolean }
  | { readonly ok: false; readonly order: CommerceOrderRecord; readonly error: PaymentError; readonly payment?: PaymentView };

/**
 * Loads the pending order and its single item → refuses a recurring price (Phase 1) → resolves the
 * provider price ref (nullable) → `payments.createIntent({ scope, amount: order.totalAmount,
 * idempotencyKey: \`order:${order.id}\`, reference: order.id }, { partyId: order.memberId, line })`.
 * Retrying is safe: the same order replays the same payment (kernel idempotency).
 * @throws {CommerceOrderNotFoundError} no such order in this workspace.
 * @throws {CommerceCheckoutValidationError} order not `pending`, scope/provider/workspace mismatch, recurring price.
 */
export async function payOrder(
  required: { deps: PayOrderDeps; input: PayOrderInput },
  optional?: Record<string, never>
): Promise<PayOrderResult>;
```

`checkout()` (`catalog/checkout.ts:220`) is **unchanged**. The host calls `checkout()` and then
`payOrder()`. A failed `payOrder` is retried with the same `orderId`.

### 2.11 `src/catalog/order-projection.ts` (new, #12)

```ts
export interface OrderPaymentProjectorDeps {
  orders: CommerceOrderRepoPort;
  clock: ClockPort;
}

export type OrderProjectionOutcome = "paid" | "already_paid" | "not_pending" | "not_found" | "ignored";

/** Host wires this behind its `OutboxPublisherPort`. Only `payment.succeeded` with a string `payload.reference` acts; everything else is `ignored`. */
export function createOrderPaymentProjector(
  required: { deps: OrderPaymentProjectorDeps },
  optional?: Record<string, never>
): { handle(required: { message: PaymentsOutboxMessage }, optional?: Record<string, never>): Promise<OrderProjectionOutcome> };
```

Redelivery is safe because `markPaid` is idempotent, so the projector needs no dedupe table.
A `not_pending` order (canceled, then paid late) raises nothing in Phase 1; see D6.

### 2.12 Stripe plugin: `packages/provider-plugins/src/payments-stripe/` (#28)

```ts
// provider.ts
export const STRIPE_CAPABILITIES: ProviderCapabilities = {
  refunds: "none", capture: "auto", void: false, disputes: false, retrieve: "payment",
  echoesCorrelation: true, confirmation: ["redirect"], customerPortal: true,
  currencies: "any",
};
export function createStripeProvider(
  required?: Record<string, never>,
  optional?: { apiBase?: string; toleranceSeconds?: number }   // test seam + Stripe's documented 300 s default
): PaymentProvider;   // id "stripe", credentialKeys ["secretKey", "webhookSecret"]

// http.ts — the only file that talks to Stripe; every call goes through ctx.httpClient (ADR-038 seam)
export async function stripeRequest(
  required: { ctx: ProviderContext; method: "GET" | "POST"; path: string },
  optional?: { form?: ReadonlyArray<readonly [string, string]>; idempotencyKey?: string; signal?: AbortSignal }
): Promise<Outcome<Readonly<Record<string, unknown>>>>;
/** 2xx → ok; transport throw / 5xx / 2xx-unparseable → unknown; 400/402/404 → rejected (card_error → DECLINED, else INVALID_REQUEST);
 *  401/403 → rejected NO_CREDENTIALS_CONFIGURED; 409 idempotency_error → rejected IDEMPOTENCY_CONFLICT; 429 → rejected, retryable. */
export function stripeOutcome(required: { status: number; json: unknown }, optional?: Record<string, never>): Outcome<Readonly<Record<string, unknown>>>;

// checkout-session.ts
export function checkoutSessionForm(required: { req: IntentRequest; ctx: ProviderContext }, optional?: Record<string, never>): Array<[string, string]>;
/** Session JSON → evidence. `status` from (session.status, session.payment_status, expanded payment_intent.status, eventType?). */
export function sessionEvidence(
  required: { session: Readonly<Record<string, unknown>> },
  optional?: { eventType?: string }
): PaymentEvidence | null;   // null = not a session we created (no metadata.jini_payment_id) or malformed

// webhook.ts
/** Parses `Stripe-Signature: t=…,v1=…[,v1=…]`; HMAC-SHA256(webhookSecret, `${t}.${rawBody}`), hex, timingSafeEqual; |now − t| ≤ tolerance. */
export function verifyStripeSignature(
  required: { rawBody: Uint8Array; header: string | undefined; secret: string; nowMs: number },
  optional?: { toleranceSeconds?: number }
): boolean;
export function translateStripeEvent(required: { event: unknown }, optional?: Record<string, never>): readonly WebhookFact[];

// portal.ts
// POST /v1/billing_portal/sessions  customer=<customerRef>  return_url=<ctx.returnUrl>  → ok({ url })
```

**Stripe mapping (Phase 1)**

| Our call | Stripe call | Notes |
|---|---|---|
| `createIntent` | `POST /v1/checkout/sessions`, header `Idempotency-Key: req.idempotencyKey` | `mode=payment`, `success_url=ctx.returnUrl`, `cancel_url=ctx.cancelUrl`, `client_reference_id=correlationId`, `metadata[jini_payment_id]` and `payment_intent_data[metadata][jini_payment_id]` = correlationId, one `line_items[0]`: `price=line.providerPriceRef` or `price_data{currency (lowercase), unit_amount, product_data[name]=line.description}`, `quantity=line.quantity ?? 1`. Evidence: `providerRef=session.id`, `status: requires_action`, `amount` from `amount_total`. Next: `{ kind: "redirect", url: session.url }`. A 2xx without `id`/`url` → `unknown`. |
| `retrieve` | `GET /v1/checkout/sessions/{id}?expand[]=payment_intent` | `open` → `requires_action`; `expired` → `canceled`; `complete`+`paid` → `succeeded`; `complete`+`unpaid` → PI `processing` → `pending`, PI `requires_payment_method`/`canceled` → `failed`. |
| `verifyWebhook` | — | Bad or missing signature or stale timestamp → `rejected SIGNATURE_INVALID`. Missing `webhookSecret` cannot happen (the kernel resolves slots first). Translated: `checkout.session.completed`, `.async_payment_succeeded` (→ `succeeded`), `.async_payment_failed` (→ `failed`), `.expired` (→ `canceled`). Each becomes `{ providerEventId: event.id, providerRef: session.id, occurredAt: created*1000, evidence }`. Any other type, or a session without `metadata.jini_payment_id`, → `ok([])` (#31 ignored). Unparseable JSON with a valid signature → `rejected INVALID_REQUEST`. |
| `customerPortal` | `POST /v1/billing_portal/sessions` | `return_url=ctx.returnUrl`. |

Authentication is `Authorization: Bearer <secretKey>`. Bodies are `application/x-www-form-urlencoded`.
The plugin needs no SDK dependency, so the `stripe` package stays banned by
`src/__tests__/core-boundary.test.ts`.

---

## 3. Files per change (new vs edited, with anchors)

| Change | File | New / edited | Anchor |
|---|---|---|---|
| #11 cancel URL | `src/payments/contract/provider.ts` | edited | `ProviderContext` `:68-77` |
| #8 capability + method | same file | edited | `ProviderCapabilities` `:52-66`; `PaymentProvider` `:100-139` |
| `IntentLine` | same file | edited | `IntentRequest` `:79-90` |
| #31 contract doc | same file | edited | `verifyWebhook` doc `:130-134` |
| guard | `src/payments/provider-module-guard.ts` | edited | `OPTIONAL_PROVIDER_METHODS` `:14`, `CAPABILITY_CHECKS` `:27-36`, `CAPABILITY_METHOD_RULES` `:39-44` |
| fake + ctx | `src/payments/testkit/lipay-fake.ts` | edited | capabilities `:101-104`; `lipayFakeContext` `:136-143` |
| conformance | `src/payments/testkit/provider-conformance.ts` | edited | `providerConformanceCases` `:78-114` (add "customerPortal: returns an Outcome and never throws" when promised) |
| test harness ctx | `src/payments/ops/__tests__/harness.ts` | edited | `:129` |
| test ctx | `src/payments/testkit/__tests__/provider-conformance.vitest.test.ts` | edited | `:24` |
| docs | `packages/core/docs/provider-registry.md` | edited | `:56` (ctx field list) |
| port | `src/payments/contract/payments-port.ts` | edited | `ProviderSummary` `:47-52`, `PaymentsPort` `:54-78` |
| line forward | `src/payments/ops/intent.ts` | edited | `IntentOptional` `:35-39`; `req` build `:163-167` |
| portal op | `src/payments/ops/portal.ts` | **new** | — |
| service | `src/payments/ops/service.ts` | edited | `createPaymentsService` `:33-41` (+`customerPortal`); `providerSummary` (+`customerPortal`) |
| #31 receiver | `src/payments/ingest/receive.ts` | edited | `WebhookResponse` `:50-53`; `receive` `:118-143` |
| #31 route test | `src/http/__tests__/payments-webhook.vitest.test.ts` | edited | fixtures `:71`, `:89`, `:104` gain `ignored: false` |
| outbox payload | `src/payments/accounting/apply-evidence.ts` | edited | `:253`, `:413` |
| #10 client | `src/payments/contract/checkout-client.ts` | **new** | — |
| #10 entry | `src/payments/client.ts` | **new** (barrel: `checkout-client.ts` + `NextAction` types) | — |
| #10 export | `package.json` | edited | `jini.entries` + `exports` (`"./payments/client"`, universal) |
| #3 effect | `src/catalog/types.ts` | edited | `CommerceProductRecord` `:32-47` |
| #3 validation | `src/catalog/effect.ts` | **new** | — |
| #3 + #4 schema contract | `src/catalog/database.ts` | edited | `CommerceDatabase` `:4-11` (+`commerce_price_provider_refs`); `CommerceProductsTable` (+`effect_json`) |
| #3 rows | `src/catalog/repo.rows.ts` | edited | product mapping `:44-89` |
| #4 + markPaid ports | `src/catalog/ports.ts` | edited | `CommerceOrderRepoPort` `:42-54`; new port after `:34` |
| #4 SQL adapter | `src/catalog/repo.price-refs.ts` | **new** | — |
| markPaid SQL + factory | `src/catalog/repo.ts` | edited | order repo `:205-250` (+`markPaid`); factories (+`commercePriceProviderRefRepoFor`) |
| #12 orchestration | `src/catalog/pay-order.ts` | **new** | — |
| #12 projection | `src/catalog/order-projection.ts` | **new** | — |
| exports | `src/catalog/index.ts` | edited | `:1-7` (+`effect`, `pay-order`, `order-projection`) |
| header truth | `src/catalog/checkout.ts` | edited (doc only) | header `:92-112`: "payment is `payOrder`'s job" |
| #28 plugin | `packages/provider-plugins/src/payments-stripe/{http,checkout-session,webhook,portal,provider}.ts` | **new** | — |
| #28 entry | `…/payments-stripe/index.ts`, `jini.plugin.json`, `README.md` | edited | `index.ts` drops the legacy `sdk.providers.register` setup (`:16-23`); `jini.plugin.json` gains `extensions["ai.jini.commerce"].provider` and `contributes.providers[0].settings` (secretKey, webhookSecret; §0.3); README states the attach recipe |
| §0.4 boundary | `packages/provider-plugins/src/__tests__/core-boundary.test.ts` | edited | + case: no `api.stripe.com` outside `src/payments-stripe/` |
| §0.4 core UI leak | `src/react/Payments.tsx`, its test | edited | `:56-57` hard-coded `Stripe`/`PayPal` → `providers: readonly ProviderSummary[]` prop |
| #28 legacy | `…/payments-stripe/stripe.ts`, `src/__tests__/payments-stripe.test.ts`, `payments-stripe-runtime-ports.test.ts` | replaced in place (the plugin is extended; its legacy class and tests give way to the new modules; **D1**) | — |
| #28 deps | `packages/provider-plugins/package.json` | edited | `devDependencies` += `"@jini-ai/commerce": "workspace:^"` (types + conformance kit only) |
| attribution | `packages/provider-plugins/src/payments-stripe/NOTICE` | **new** | see §7 |
| docs | `README.md`, `source-map.md`, `CHANGELOG.md` (commerce) | edited | Phase 1 section / new files / entry |

---

## 4. Data, ledger, migrations

**Payments ledger** (`src/payments/ledger/`, owns its own checksummed migrations): **no change.**
No new table, column or migration. `payment.succeeded` payloads gain `reference`. Payload JSON is
schemaless, and old pending messages simply lack it; the projector treats them as `ignored`.

**Catalog tables** (`src/catalog/database.ts:3`, "borrowed table contract; this package never
creates … the host's schema"). The host must apply this DDL. It is shipped as documentation in
`README.md` and mirrored in test fixtures, not as a commerce migration (see D2):

```sql
ALTER TABLE commerce_products ADD COLUMN effect_json TEXT NULL;   -- NULL = {"kind":"none"}

CREATE TABLE commerce_price_provider_refs (
  workspace_id        TEXT NOT NULL,
  price_id            TEXT NOT NULL,
  provider_id         TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  mode                TEXT NOT NULL CHECK (mode IN ('test','live')),
  provider_price_ref  TEXT NOT NULL CHECK (length(provider_price_ref) > 0),
  created_at          TEXT NOT NULL,
  PRIMARY KEY (workspace_id, price_id, provider_id, provider_account_id, mode)
);
```

`commerce_orders` is **unchanged**. `markPaid` reuses `status`, `updated_at` and `version`. The
order ↔ payment link is `payment.reference = order.id`, with idempotency key `order:<id>`, so no
`payment_id` column is needed.

---

## 5. Test plan (failing test first for every behaviour; DI fakes; 100% line/branch/function)

The Phase 1 dispatch prompt must carry the `honest-testing` rules: no ignore comments, no widened
excludes, no softened assertions, and the before/after **test count** in every shard report.

| File under test | Test file | Cases |
|---|---|---|
| `provider-module-guard.ts` | `src/payments/__tests__/kernel/provider-module-guard.vitest.test.ts` (edit) | non-boolean `customerPortal` refused; `customerPortal: true` without the method refused; with the method accepted |
| `testkit/provider-conformance.ts` | `testkit/__tests__/provider-conformance.vitest.test.ts` (edit) | new case runs only when promised; a throwing `customerPortal` fails the case |
| `ops/portal.ts` | `ops/__tests__/portal.vitest.test.ts` (new, reuses `ops/__tests__/harness.ts`) | unregistered provider; capability false → `CAPABILITY_UNSUPPORTED`; empty `customerRef` → `INVALID_REQUEST`; ctx unresolved; provider `ok` → url; `rejected` and `unknown` → ok:false; provider throws → ok:false (via `dispatch`); **no ledger write** (transaction count unchanged) |
| `ops/intent.ts` | `ops/__tests__/intent.vitest.test.ts` (edit) | `line` forwarded verbatim; absent `line` not forwarded (`"line" in req` false); a replay with a different `line` is still a replay |
| `ops/service.ts` | `__tests__/kernel/*` (edit the existing service test) | `customerPortal` wired; `listProviders` reports `customerPortal` |
| `ingest/receive.ts` | `ingest/__tests__/receive.vitest.test.ts` (edit) | `ok([])` → `200 ignored:true`, zero ledger transactions; non-empty → `ignored:false` |
| `http/payments-webhook.ts` | `http/__tests__/payments-webhook.vitest.test.ts` (edit) | the ignored body passes through unchanged |
| `accounting/apply-evidence.ts` | `accounting/__tests__/apply-evidence.vitest.test.ts` (edit) | `payment.succeeded` payload contains `reference` on both the response path and the operator-resolve path |
| `contract/checkout-client.ts` | `contract/__tests__/checkout-client.vitest.test.ts` (new) | redirect https → `navigated`; `http://localhost` allowed; `http://evil` / `javascript:` / `data:` / unparseable → `refused unsafe_url`, `navigate` not called; `client_action` with/without handler; `none` / `out_of_band` → `nothing_to_open`; handler rejection propagates (caller's error) |
| `catalog/effect.ts` | `catalog/__tests__/unit/effect.unit.test.ts` (new) | none ok; credits 1 / MAX ok; 0, negative, non-integer, > MAX, unknown kind, non-object → problem string |
| `catalog/repo.rows.ts` | `catalog/__tests__/unit/repo.rows.unit.test.ts` (edit) | effect round-trips; NULL → undefined; corrupt JSON → typed error (same style as `specs_json`) |
| `catalog/repo.price-refs.ts` | `catalog/__tests__/unit/repo.price-refs.vitest.test.ts` (new; own DDL against `openMemorySqliteKernel`) | find hit; miss on another mode / account / provider / workspace; save upserts |
| `catalog/repo.ts` `markPaid` | `catalog/__tests__/unit/repo.mark-paid.vitest.test.ts` (new; own DDL) | pending → paid (version + 1); paid → `already_paid`; canceled → `not_pending`; missing / other workspace → `not_found`; concurrent double call → exactly one `paid` |
| `catalog/pay-order.ts` | `catalog/__tests__/unit/pay-order.unit.test.ts` (new; fake ports, fake `PaymentsPort` recording calls) | not found; not pending; workspace mismatch; provider mismatch; recurring price refused; price ref present → `line.providerPriceRef`; absent → no ref; exact `createIntent` args (key `order:<id>`, reference, amount, partyId); `ok` / `ok:false` passthrough; second call replays |
| `catalog/order-projection.ts` | `catalog/__tests__/unit/order-projection.unit.test.ts` (new) | other topics → `ignored`; missing / non-string reference → `ignored`; each `markPaid` result surfaces; `at` comes from the injected clock |
| E2E kernel | `src/payments/__tests__/kernel/one-time-purchase.vitest.test.ts` (new) | in-memory ledger + LiPay fake (now redirect-capable via script) + fake catalog repos: checkout → payOrder → webhook → worker → relay → projector → order `paid`; redelivered webhook and redelivered outbox change nothing |
| Stripe `http.ts` | `packages/provider-plugins/src/__tests__/payments-stripe-http.test.ts` (new; fake `HttpClientPort`) | every status class in the `stripeOutcome` table; transport throw → unknown; non-JSON 2xx → unknown; Bearer header; form encoding (nested keys); Idempotency-Key only when given |
| Stripe `checkout-session.ts` | `…/payments-stripe-checkout.test.ts` (new) | form with price ref vs `price_data`; lowercase currency; quantity default 1; success/cancel URLs from ctx; metadata on both session and PI; evidence + redirect; 2xx missing url → unknown; every `sessionEvidence` status row in §2.12; foreign session → null |
| Stripe `webhook.ts` | `…/payments-stripe-webhook.test.ts` (new) | signature valid / tampered body / wrong secret / stale and future `t` / multiple `v1` (one matches) / missing header / malformed header; 4 translated types; unhandled type → `[]`; no metadata → `[]`; bad JSON → rejected; signature computed in-test with `node:crypto` from a fixed secret, **no real key** |
| Stripe `portal.ts` + `provider.ts` | `…/payments-stripe-provider.test.ts` (new) | portal ok / rejected / unknown; `retrieve` path; **commerce `providerConformanceCases` all pass**; `isPaymentProviderModule` true |
| plugin manifest | `…/payments-stripe-manifest.test.ts` (new) | `jini.plugin.json` declares `extensions["ai.jini.commerce"].provider`; commerce's `parse` + `validate` (from `plugin-contribution.ts`) accept the built module; manifest `settings` names == `provider.credentialKeys`, all `secret: true`; registry binding `stripe` → `payments-stripe` |
| boundary | `core-boundary.test.ts` (edit) | `api.stripe.com` appears in no package file outside `src/payments-stripe/` (fixture proves the check fires) |
| `react/Payments.tsx` | its existing test (edit) | renders exactly the provided summaries; empty list → "Setup required", no vendor names |

Coverage gates: `npm --prefix packages/commerce run test:coverage` (existing config) and the
provider-plugins vitest run with coverage scoped to `src/payments-stripe/**`.

---

## 6. Build shards (in order; each ≤ ~150 changed lines incl. tests; file sets disjoint)

| # | Shard | Files (exclusive to this shard) | Depends on |
|---|---|---|---|
| S1 | Provider contract: `cancelUrl`, `customerPortal` capability + method, `IntentLine`, #31 doc, `providerEventId` derivation doc (§0.6) | `payments/contract/provider.ts`, `payments/contract/evidence.ts` (doc only, `WebhookFact` `:238-248`), `payments/provider-module-guard.ts`, `payments/testkit/lipay-fake.ts`, `payments/testkit/provider-conformance.ts`, `payments/ops/__tests__/harness.ts`, `payments/testkit/__tests__/provider-conformance.vitest.test.ts`, `payments/__tests__/kernel/provider-module-guard.vitest.test.ts`, `packages/core/docs/provider-registry.md` | — |
| S2 | Port + ops: `line` forwarding, `customerPortal` op | `payments/contract/payments-port.ts`, `payments/ops/intent.ts`, `payments/ops/portal.ts`, `payments/ops/service.ts`, `payments/ops/__tests__/intent.vitest.test.ts`, `payments/ops/__tests__/portal.vitest.test.ts`, the existing service test under `payments/__tests__/kernel/` (not the guard test) | S1 |
| S3 | #31 ignored + outbox `reference` | `payments/ingest/receive.ts`, `payments/ingest/__tests__/receive.vitest.test.ts`, `http/__tests__/payments-webhook.vitest.test.ts`, `payments/accounting/apply-evidence.ts`, `payments/accounting/__tests__/apply-evidence.vitest.test.ts` | S1 |
| S4 | #10 browser client contract | `payments/contract/checkout-client.ts`, `payments/client.ts`, `payments/contract/__tests__/checkout-client.vitest.test.ts`, `package.json` | — |
| S5 | #3 effect + catalog schema contract | `catalog/types.ts`, `catalog/effect.ts`, `catalog/database.ts`, `catalog/repo.rows.ts`, `catalog/__tests__/unit/effect.unit.test.ts`, `catalog/__tests__/unit/repo.rows.unit.test.ts` | — |
| S6 | #4 price refs + `markPaid` | `catalog/ports.ts`, `catalog/repo.price-refs.ts`, `catalog/repo.ts`, `catalog/__tests__/unit/repo.price-refs.vitest.test.ts`, `catalog/__tests__/unit/repo.mark-paid.vitest.test.ts` | S5 |
| S7 | #12 `payOrder` + projector + E2E | `catalog/pay-order.ts`, `catalog/order-projection.ts`, `catalog/index.ts`, `catalog/checkout.ts` (doc), `catalog/__tests__/unit/pay-order.unit.test.ts`, `catalog/__tests__/unit/order-projection.unit.test.ts`, `payments/__tests__/kernel/one-time-purchase.vitest.test.ts` | S2, S3, S6 |
| S8 | Stripe HTTP + checkout session | `provider-plugins/src/payments-stripe/http.ts`, `…/checkout-session.ts`, `…/__tests__/payments-stripe-http.test.ts`, `…/__tests__/payments-stripe-checkout.test.ts`, `provider-plugins/package.json` | S1 |
| S9 | Stripe webhook verify + translate | `…/payments-stripe/webhook.ts`, `…/__tests__/payments-stripe-webhook.test.ts` | S8 |
| S10 | Stripe provider assembly, portal, manifest + credential fields, legacy class replaced, NOTICE, boundary case | `…/payments-stripe/{provider,portal,index}.ts`, `jini.plugin.json`, `README.md`, `NOTICE`, delete `stripe.ts` and the two legacy tests, `…/__tests__/payments-stripe-provider.test.ts`, `…/__tests__/payments-stripe-manifest.test.ts`, `provider-plugins/src/__tests__/core-boundary.test.ts` | S9, D1 |
| S12 | Core UI vendor-name leak (§0.4) | `react/Payments.tsx`, its test file under `react/` | S2 |
| S11 | Docs | commerce `README.md` (host DDL, wiring recipe), `source-map.md`, `CHANGELOG.md`, `REPORT-opensaas-gap.md` status column for rows 3/4/8/10/11/12/28/31 | S1–S10 |

Shards that touch no common file can run in parallel: S4 and S5 alongside S1, and S8 after S1.
Each shard ends with `pnpm guard`, `pnpm typecheck`, the package's tests and a coverage run. Per
`AGENTS.md`'s cloud rule 2, each shard is committed and pushed on its own.

Line estimates (code + tests): S1 ≈ 90, S2 ≈ 140, S3 ≈ 70, S4 ≈ 120, S5 ≈ 110, S6 ≈ 150,
S7 ≈ 150, S8 ≈ 150, S9 ≈ 140, S10 ≈ 140 changed (excluding the ~480 deleted legacy lines), S11
docs. If S6 or S7 runs over, split its test file off into a follow-up shard rather than adding to
another shard's files.

---

## 7. Adapted from OpenSaaS, and attribution

OpenSaaS is `wasp-lang/open-saas`, MIT, © 2023 wasp-lang. Paths are under `open-saas/template/app/src/payment/`.

| OpenSaaS | What we take | How it is adapted |
|---|---|---|
| `plans.ts:18-41` (`PaymentPlanEffect`) | the subscription-vs-credits effect union idea | Data on our product row (`CommercePurchaseEffect`), not a code constant. No credits counter on a user row: credits will be a ledger (Phase 2). |
| `paymentProcessorPlans.ts:9-42` | plan id ↔ vendor price id mapping | A scoped repo keyed by provider **account and mode**, not env vars. |
| `stripe/checkoutUtils.ts:34-71` | Checkout Session parameters for `mode: "payment"` | Raw REST through `ctx.httpClient`, not the SDK. URLs come from `ProviderContext`, and our correlation id is in metadata. Not copied: `automatic_tax`, `allow_promotion_codes`, `invoice_creation` (out of scope) and email-based customer lookup (`:10-24`, a known weakness; #9). |
| `stripe/paymentProcessor.ts:57-76` | billing-portal session call | Optional capability on `PaymentProvider`, returning an `Outcome`. |
| `redirectToCheckout.ts`, `paymentProcessorClient.ts`, `stripe/paymentProcessorClient.ts` | the client-side "open checkout" seam | `openCheckout` over our `NextAction` union, with an injected `navigate` and a URL scheme allow-list (OpenSaaS calls `window.open(url)` unchecked). |
| `stripe/webhook.ts:45-57`, `errors.ts` (`UnhandledWebhookEventError` → 2xx) | the "unhandled event still answers 2xx" policy | `ok([])` → `200 ignored:true`, with no thrown error used as control flow. |
| `paths.ts` (success/cancel URLs) | the separate cancel URL | `ProviderContext.cancelUrl`, host-resolved per site + account. |

**Never copied:** the user-row billing model (`user.ts`, `User.subscriptionStatus` / `credits`),
the record-then-delete webhook idempotency table (`processedWebhookEvent.ts`), and the
vendor-sum revenue (`stripe/paymentProcessor.ts:79-108`).

**Attribution.** No OpenSaaS file is copied verbatim; the Stripe request is written against
Stripe's REST docs. Because S8–S10 adapt the parameter set and structure above, S10 still adds
`packages/provider-plugins/src/payments-stripe/NOTICE`:

```
Portions of this plugin's design (Stripe Checkout Session parameters for one-time payments,
billing-portal session creation, client "open checkout" seam, unhandled-webhook 2xx policy) are
adapted from Open SaaS (https://github.com/wasp-lang/open-saas), Copyright (c) 2023 wasp-lang,
licensed under the MIT License:

<full MIT license text>
```

The commerce `NOTICE`/`source-map.md` gets one line pointing to it for `checkout-client.ts`
and `effect.ts`. Is `provider-plugins/license-supplements/` the house location instead (it
exists)? That is D7.

---

## 8. Open decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | **Partly settled by the owner (2026-10-29): extend the existing `payments-stripe` plugin.** Still to confirm: its legacy `StripePaymentsProvider` class (`stripe.ts`, old capability-providers `charge`/`getCharge`/`refund` port) and its two tests are deleted in S10, rather than kept beside the new commerce provider. | Delete. Keeping it would mean two Stripe adapters on two contracts, and nothing selects the old one (its README). One-line confirmation needed because it removes code this plan did not author. |
| D2 | Catalog tables are borrowed (`database.ts:3`). Who ships the `effect_json` column and the `commerce_price_provider_refs` table? | Document the DDL in the README and keep the borrowed-schema rule. Alternative: start a commerce-owned catalog migration set like the payments ledger has. That is a bigger policy change. |
| D3 | Retire the catalog's own webhook inbox (`CommerceWebhookEventRepoPort`, `commerce_webhook_events`) now or in Phase 2? | Mark it `@deprecated` in S7 and delete it in Phase 2, before subscriptions. Deleting an exported API needs consumer sign-off. |
| D4 | Effect on the **product** or on the **price**? | Product, next to `grantsMemberTierId`. A "50 credits" pack is its own product. Prices stay immutable money records. |
| D5 | `customerPortal` takes a caller-supplied `customerRef` until #9 lands, and Phase 1 evidence carries no Stripe customer id. Should the session set `customer_creation=always` and add `customerRef?` to `PaymentEvidence` now? | No. Keep Phase 1 to the contract plus the plugin method. Customer identity is #9, which needs the party ↔ customer map. |
| D6 | Expired or failed checkouts leave the order `pending` (there is no `payment.failed` topic). Add `payment.failed` / `payment.canceled` topics and `markFailed`/`markCanceled` now? | Phase 2. No money is held, and adding topics changes `LedgerOutboxTopic` for every consumer. |
| D7 | Attribution location: per-plugin `NOTICE` vs `provider-plugins/license-supplements/`. | Follow whatever `license-supplements/` already does for the other plugins. If it covers only vendored binaries, use `NOTICE`. |
| D8 | Order **mode**: orders have no test/live column, so a test-mode payment can mark a real order paid if a host mis-wires scopes. | Accept for Phase 1. `payOrder` pins scope at creation, and the projector only follows `reference`. Add a mode column with subscriptions. |
| D9 | `payOrder` idempotency key `order:<id>`: after a **rejected** checkout-session creation the same order cannot be retried (replay of the failed payment). | Accept. Session creation is rarely rejected, and the shopper re-runs `checkout()`. Owned retry attempts (`order:<id>:<n>`) are an option nobody has asked for yet. |
| D11 | What does "core keeps the default provider" mean? Today the only in-core provider is the test-only LiPay fake (§0.5). | Keep LiPay as the dev/test default and refuse it in `live` mode. A production "manual / pay offline" provider would be new scope. |
| D12 | The manifest's `contributes.providers` entry (`contract: "payments"`, `contractVersion: 1`) points at the old capability-providers contract. The host settings UI reads `settings` from it. | Keep the entry only as the settings carrier and bump it to `contractVersion: 2` = the commerce contract. Registration happens only through `extensions["ai.jini.commerce"]`. Confirm with the plugin-host owner that a `contributes.providers` entry with no `setup` registration is legal. If not, move `settings` under the commerce extension. |
| D13 | Merchant-of-record tax (§0.6 gap 1): add `tax?: Money` to the evidence plus a pre-tax amount check before the first Lemon Squeezy, Paddle or Polar plugin? | Yes, as a separate small core shard before those plugins. It is not needed for Stripe Phase 1 (no `automatic_tax`). |
| D10 | Fallback `product_data[name]` when a caller creates a Stripe intent with no `line` (agent money tools, LiPay-style callers). | Use the `reference`, since it is ours and not personal data. Alternative: reject `INVALID_REQUEST` without a `line`. |

---

*Hard caps for the build dispatch: one shard per agent run; each run reports the shard id, test
count before/after, coverage numbers and pushed SHAs.*
