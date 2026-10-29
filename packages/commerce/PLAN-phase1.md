# `@jini-ai/commerce` — Phase 1 plan: one-time purchases through the attached Stripe plugin

**Revision 3 (2026-10-29).** This revision responds to:

- the Codex re-review `REVIEW-codex-phase1-r2.md`, verdict REPLAN, narrowing;
- the coordinator's simplification, which drops automatic lost-response recovery;
- the owner's sign-offs on O1–O4, all YES.

It supersedes revision 2 (`aa5d627e`) and revision 1 (`db41e253`). It is a plan only: no code
changes. The base is `32226f0e`.

References use these forms:

- #N is a row of `REPORT-opensaas-gap.md`.
- Rn is a first-review item.
- r2-x is a re-review item.

Paths are relative to `packages/commerce/` unless they start with `packages/`.

**Phase 1 goal.** A member buys one active one-time price and is redirected to a real
Stripe-hosted Checkout, then pays. The order becomes `paid` only after the payment's evidence has
been verified against the order's **reserved-before-dispatch** payment association. That
association pins workspace, site, account, provider, mode, amount and currency.

The flow reuses `checkout()`, `PaymentsPort.createIntent`, `NextAction`, the scoped ledger, the
inbox and worker, the single writer, the outbox, the reconciler and operator resolution, and the
storefront.

```
checkout() → payOrder(): reserve association (order + scope, unique per order)
           → PaymentsPort.createIntent(key order:<id>, reference order.id, line) → Stripe plugin → NextAction{redirect}
           → bind association.paymentId → settleOrderPayment (sync-success providers)
browser ← openCheckout(PaymentView.next)
Stripe ─signed webhook→ receive (facts | ignored | rejected) → inbox → worker (retrieve if id-only) → single writer
single writer ─outbox payment.succeeded{reference}→ relay → host bus → projector → settleOrderPayment
settleOrderPayment: association by (workspace, reference) → scope-fenced getPayment → verify all → bind if unbound → markPaid
```

---

## 0. Decisions and the plugin model

### 0.1 Owner and coordinator decisions (binding)

| # | Decision | Effect on this plan |
|---|---|---|
| D1 | Delete the legacy `payments-stripe/stripe.ts` and its 2 tests | P30 |
| D2 | The **host** ships catalog schema changes through its own migration (Tovu ADR-066 TS migrations); borrowed-schema fixtures are updated in the same shard | §4, P14–P16 |
| D3 | The catalog's second webhook inbox is retired in Phase 2 | Untouched |
| D11 | The Stripe plugin is the default production provider; the LiPay fake is test-only, enforced fake-locally | P03 |
| D12 | Keep manifest `contributes.providers`: the loader needs it today | §0.3 |
| D13 | Not now: `PaymentEvidence.amount` keeps its meaning | §0.6 |
| Cuts | Purchase effects (#3) and the customer portal (#8) are deferred | Out of scope |
| **C-1** (coordinator, rev 3) | **No automatic lost-response recovery.** A lost create-session response stays **unresolved**: the payment stays `unknown` and is never failed or re-sent with a new key. It raises an operator alert through the existing port, and the existing reconciler surfaces it. A late webhook for that session still settles normally. Ledger step 0005, the request snapshot and the recovery state machine are removed. | §2.5 |
| O1 | YES: delete `payments/plugin-contribution.ts` and its test | P11 |
| O2 | YES: one provider account per **site** and plugin; one webhook endpoint per (site, account, mode) | §0.4 |
| O3 | YES: a fixed, conservative currency list | §2.12 |
| O4 | YES: a 23-hour window. **Now moot.** It only parameterised the removed auto-recovery. Rejected-intent replay is ledger-only and dispatches nothing, and the Stripe `Idempotency-Key` is still sent on every create. No capability field is added. | — |
| Cap | YES: P11 and P30 may exceed ~150 lines through deletions only | §6 |

### 0.2 Where vendors live

Each vendor is a self-contained provider artifact in `@jini-ai/provider-plugins`:
`src/payments-<vendor>/`. It is built by `scripts/build.ts:97` into a digest-pinned
`plugins/<id>/<version>/server/index.mjs`.

Phase 1 **extends the existing `payments-stripe`**, keeping its id, folder, `contract: "payments"`
and `id: "stripe"`. The port implements commerce's `PaymentProvider`. Core keeps only the
vendor-neutral contract. LiPay is a test fake.

### 0.3 One attachment authority (R1, R2, r2-R2)

The only attachment path is the `@jini-ai/plugins/host` provider-artifact path. Commerce's unused
agent-plugins contribution spec is deleted (P11, O1).

| Step | Who / where | What happens |
|---|---|---|
| install | existing installer + `catalog.json` | The integrity hash covers `server/index.mjs` and `licenses/**` |
| load | `loadPlugin` (`plugins/src/host/node/loader.ts`), through the **site provider host** (`provider-host.ts:24-31`), or `loadProviderPluginArtifact` (`node/provider-artifact.ts:16`) outside a site | Integrity, then SDK range, then import, then `definition.setup(sdk)` (`loader.ts:184-205`) |
| register | plugin `setup` | `sdk.providers.register({ contract: "payments", id: "stripe", contractVersion: 1, factory })` (v1 is the only accepted version, `provider-contributions.ts:23-32`) |
| validate | the host's `contracts` (`provider-host.ts:6-11`) | Commerce supplies `paymentsProviderContract.validate`, which runs `paymentProviderModuleProblem`. The type is structural, so commerce never imports the host. |
| initialize | `host.initialize({ contract: "payments", id: "stripe", input: {} })` | Returns a `PluginProviderLease` (`port`, `isCurrent`, `dispose`). The factory takes no credentials. |
| **lease guard** (r2-R2) | commerce `leasedProviderItem` | The registry never caches the raw port. It holds a guarded `PaymentProvider` that checks `lease.isCurrent({})` before every method (§2.7). |
| commerce registration | host composition | `createKernelProviderRegistry({ items: [leasedProviderItem({ pluginId: "payments-stripe", lease })] }, { bindings: { stripe: "payments-stripe" } })`. Bindings are passed explicitly and tested. |
| detach / retire | host | Once the lease is retired, the guarded port answers as in §2.7 and in-flight calls stay host-owned. The host then rebuilds the registry without the item, and the webhook route returns 503 `PROVIDER_NOT_REGISTERED`. |

### 0.4 Credentials (R3, r2-R3)

**Fields.** The plugin owns its fields, declared in `contributes.providers[0].settings`:

- `accountId`: public and required.
- `test_<k>` and `live_<k>`: secret, for each `k` in `credentialKeys`. For Stripe these are
  `test_secretKey`, `test_webhookSecret`, `live_secretKey` and `live_webhookSecret`.

The manifest test asserts that the settings follow this convention.

**Adapter.** `payments/provider-contexts.ts` provides `createProviderContexts(required, optional = {})`,
which implements `ProviderContextPort`. It reads through a structural mirror of
`ProviderConfigSource.read` (`provider-config-source.ts:26-41`), via
`configFor({ siteId })`, so only the site's own store is used.

`resolve` refuses with `NO_CREDENTIALS_CONFIGURED` in these cases:

| Case | Retryable |
|---|---|
| No binding for the provider | no |
| Nothing saved for this plugin on this site | no |
| `accountId` does not match the scope's account | no |
| The `${mode}_${k}` slot is missing | no |
| Provider URLs are not configured | no |
| **The reader throws** (r2-R3: `ProviderConfigUnreadableError` when a saved row cannot be opened, `provider-config-source.ts:30`, or any storage error) | **yes** |

When the reader throws, the error is caught and never rethrown, and secret text never appears in
the message, which reads "provider configuration could not be read; re-enter it in settings".

A webhook resolve failure therefore becomes a 503 (`receive.ts:95`), and the vendor redelivers.
A charge attempt fails before any row is written.

**Isolation tests:**

- a missing slot;
- the wrong account;
- the wrong mode (live requested, only test saved);
- cross-site (site B's config never resolves for site A);
- an unbound provider;
- missing URLs;
- an unreadable config, where the reader throws the host error class and the result is refused and retryable;
- no slot outside `credentialKeys` is returned.

**Phase 1 constraint (O2).** One provider account per site per plugin. One webhook endpoint per
(site, account, mode), signed with that mode's `webhookSecret`.

### 0.5 LiPay is test-only (D11)

This is a fake-local guard in `createLipayFake`. Every method returns `rejected INVALID_REQUEST`
when `ctx.account.mode === "live"`. LiPay ships only from `./payments/testkit`, and core contains
no LiPay branch.

### 0.6 Cross-vendor fit (R12)

**Vendor-neutral additions.** None is Stripe-only:

- `ProviderContext.cancelUrl`
- `IntentLine { description, quantity, unitAmount, providerPriceRef? }`
- the `ok([])` "ignored" rule
- the `providerEventId` stability rule
- the `reference` field in the `payment.succeeded` payload

**Plugins charge exactly `req.amount`.** The kernel verifies that unit × quantity equals the total
before writing any row. Stripe also refuses a session whose `amount_total` or currency differs,
and in that case returns no redirect.

**Replays never re-dispatch (R8).** Revision 3 adds no automatic re-dispatch at all (C-1).

**Deferred, explicitly:**

- tax and subtotal modelling (D13);
- subscription facts (#13);
- merchant-of-record vendors.

Stripe specifics (session id as `providerRef`, `metadata[jini_payment_id]`, Bearer auth and form
encoding, the currency list) stay inside the plugin.

### 0.7 No Stripe outside the plugin (R21, resolved)

Verified now:

- No `stripe` SDK import exists anywhere. The existing `core-boundary.test.ts:19` `VENDOR` scanner
  enforces this.
- The only `api.stripe.com` literals are in the legacy plugin and its tests, both deleted in P30.
- Two hard-coded vendor badges sit in `react/Payments.tsx:56-57` and are fixed in P22.

P33 adds an AST scan of production sources for `api.stripe.com` literals outside
`src/payments-stripe/`, plus a sibling-plugin import ban. Both come with fixtures that prove they
fire. This is a test gate run by `pnpm --prefix packages/provider-plugins test` and CI, not by the
build.

---

## 1. Scope

**In:**

- #12: checkout pays, through a reserved and verified association.
- #4: price → vendor price mapping.
- #10: `openCheckout`.
- #11: `cancelUrl`.
- #31: the `ignored` outcome.
- #28: the Stripe plugin (Checkout `mode=payment`, `retrieve`, signed webhooks, fixed currency
  list).
- R8: rejected-intent replay.
- Lost-response **unresolved** behaviour, proven by tests (C-1).
- The credential adapter.
- The lease-guarded single attachment authority.
- The LiPay live guard.
- The core UI vendor-name fix.
- Coverage gates, NOTICE packaging and the boundary gate.

**Out:**

- Automatic lost-response recovery (C-1).
- Purchase effects and the customer portal.
- Subscriptions, entitlements and credits.
- Stripe refunds, disputes, capture and void (declared `none`/`false`).
- Order `failed`/`canceled` projection.
- The second catalog inbox (D3).
- Tax, coupons and invoices.
- Several accounts or endpoints per site.

---

## 2. Contracts

All exact TypeScript below follows the same rules:

- `(required, optional = {})` signatures;
- injected ports;
- cyclomatic complexity ≤ 10.

### 2.1 `payments/contract/provider.ts`

```ts
export interface ProviderContext { /* …existing… */ readonly cancelUrl: string; }
/** The kernel guarantees unitAmount.minorUnits × quantity === amount.minorUnits, same currency. */
export interface IntentLine {
  readonly description: string;          // display only; never personal data
  readonly quantity: number;             // safe integer ≥ 1
  readonly unitAmount: Money;            // the order item's snapshot
  readonly providerPriceRef?: string;    // #4 mapping for (price, provider account, mode)
}
export interface IntentRequest { /* …existing… */ readonly line?: IntentLine; }
```

`ProviderCapabilities` is **unchanged**. Revision 2's `idempotencyWindowMs` is removed with C-1.

Documentation additions:

- **`verifyWebhook`:** an unsupported verified event type, or an event about an object the
  provider did not create, returns `ok([])`. An event of a **supported** type that carries our
  correlation but is malformed returns `rejected INVALID_REQUEST`. Our object with incomplete
  evidence becomes an id-only fact.
- **`WebhookFact.providerEventId`** (`evidence.ts:238-248`): must be stable across redeliveries.

### 2.2 `payments/contract/payments-port.ts`

`createIntent` gains `optional.line?: IntentLine`.

`checkIntent` (`ops/intent.ts:44-56`) validates `line`: quantity must be a safe integer ≥ 1, the
currency must equal `amount.currency`, and the product must be exact. Otherwise it returns
`INVALID_REQUEST` and writes no row.

`line` is forwarded to the provider and is not part of the replay comparison. It is **not
persisted**.

### 2.3 The `payment.succeeded` payload (`payments/accounting/apply-evidence.ts:253`, `:413`)

The payload gains `reference: string`, taken from the payment row. It contains no personal data.

It only lets a consumer **locate** the order. The association is still what is trusted (§2.11).
Messages enqueued before this change lack the field, and the projector returns `ignored` for them.

### 2.4 Rejected-intent replay (R8, resolved): `ops/intent.ts` `lookupIntent` (`:58-68`)

A same-key replay of a payment whose `intent:<key>` attempt (`findAttemptByOperationKey`,
`ledger/repo.ts:96`) is `rejected` returns `rejectedReplay(attempt)` (`ops/common.ts:154-160`):
`ok: false`, the original code, "replayed … key spent", with the payment attached.

No replay ever calls the provider.

### 2.5 Lost create-session response: **unresolved, never retried** (C-1)

This needs **no production change**. Today's kernel already does exactly this, and P08 pins it
with tests:

1. The dispatch outcome is `unknown` (timeout, 5xx, transport error, or 2xx without `id`/`url`).
   `recordIntentDispatchOutcome(… "unknown")` keeps the payment `unknown`. It never becomes
   `failed`.
2. `payOrder` returns `ok: false`, carrying the `unknown` error and a payment with `next: null`. A
   retry with the same key replays that payment (`lookupIntent`) and **never re-dispatches**. A new
   key is never minted.
3. `reconcileUnknown` (`ops/reconciler.ts:146`) finds the `unknown` intent. Because `providerRef
   === null`, `retrieveSnapshot` (`reconcile-snapshot.ts:20`) refuses, and `leave` raises
   `unknown-aged` through `PaymentsAlertPort` (`reconcile-snapshot.ts:45-48`).
4. The operator checks Stripe and resolves the payment with the existing `resolveUnknown`
   (`ops/operator.ts:79`), which writes an audit row. The session also expires on its own, by
   Stripe's default 24-hour Checkout expiry.
5. A **late webhook** for that session settles normally. The worker locates the payment by
   `correlationId` (`metadata.jini_payment_id`) when `providerRef` is unknown
   (`worker.ts:182-189`). The writer applies the evidence, the outbox emits, and the association
   settles the order.

### 2.6 Webhook "ignored" (#31): `payments/ingest/receive.ts`

`ok([])` returns `200 { received: 0, duplicates: 0, ignored: true }` before any ledger
transaction. Every other 200 carries `ignored: false`.

### 2.7 Attachment and credentials: `payments/provider-contract.ts` (new), `provider-contexts.ts` (new)

```ts
export const paymentsProviderContract: { readonly contract: "payments"; readonly validate: (required: { provider: unknown }, optional?: Record<string, never>) => string | undefined };
/** Structural mirror of the host's PluginProviderLease. */
export interface PaymentProviderLease { readonly port: unknown; isCurrent(required: Record<string, never>, optional?: Record<string, never>): boolean; }
/**
 * Validates lease.port once, then returns a registry item whose PaymentProvider checks
 * lease.isCurrent({}) before EVERY method:
 *   createIntent (and any money-moving method)  → rejected PROVIDER_NOT_REGISTERED (nothing was dispatched: provably no money moved)
 *   retrieve, verifyWebhook                     → unknown  PROVIDER_NOT_REGISTERED, retryable (reconcile later / 503 → redelivery)
 * `id`, `capabilities` and `credentialKeys` are copied at wrap time, so they cannot change under the registry.
 */
export function leasedProviderItem(required: { pluginId: string; lease: PaymentProviderLease }, optional?: Record<string, never>): LoadedProviderItem | { readonly problem: string };
```

`createProviderContexts` is specified in §0.4. Both files are exported from `./payments/kernel`.

### 2.8 Browser client (#10): `payments/contract/checkout-client.ts`, entry `./payments/client` (universal)

```ts
export type OpenCheckoutResult =
  | { readonly kind: "navigated"; readonly url: string }
  | { readonly kind: "client_action_handled" }
  | { readonly kind: "nothing_to_open"; readonly next: "none" | "out_of_band" | "pending" }   // pending = next === null
  | { readonly kind: "refused"; readonly reason: "unsafe_url" | "no_client_action_handler" };
export type ClientActionHandler = (required: { payload: Readonly<Record<string, unknown>> }, optional?: Record<string, never>) => Promise<void>;
export async function openCheckout(
  required: { next: NextAction | null; navigate: (required: { url: string }) => void },
  optional?: { clientAction?: ClientActionHandler }
): Promise<OpenCheckoutResult>;
```

Only `https:` URLs are followed, plus `http:` on `localhost` or `127.0.0.1`.

### 2.9 Catalog ports: `catalog/ports.ts`

```ts
export interface CommercePriceProviderRefRepoPort {
  find(required: { workspaceId: string; priceId: string; providerId: string; providerAccountId: string; mode: PaymentMode }, optional?: Record<string, never>): Promise<string | null>;
  save(record: CommercePriceProviderRefRecord, optional?: Record<string, never>): Promise<void>;     // upsert on the 5-part key
}

/** r2-association: reserved BEFORE dispatch, unique per order; bound to the payment after. */
export interface CommerceOrderPaymentRecord {
  workspaceId: UUID; orderId: UUID;
  siteId: string; providerId: string; providerAccountId: string; mode: PaymentMode;
  amount: Money;
  paymentId: string | null;          // null = reserved, not yet bound
  createdAt: ISODateTime;
}
export type ReserveOrderPaymentResult = "reserved" | "same_scope" | "conflict";      // conflict = another scope/amount already reserved this order
export type BindOrderPaymentResult = "bound" | "already_bound" | "conflict" | "not_found";   // conflict = bound to a different payment
export interface CommerceOrderPaymentRepoPort {
  /** INSERT … ON CONFLICT (workspace_id, order_id) DO NOTHING, then classify by re-reading: never read-then-insert. */
  reserve(record: Omit<CommerceOrderPaymentRecord, "paymentId">, optional?: Record<string, never>): Promise<ReserveOrderPaymentResult>;
  /** UPDATE … SET payment_id = ? WHERE … AND payment_id IS NULL; 0 rows → classify. */
  bind(required: { workspaceId: string; orderId: string; paymentId: string }, optional?: Record<string, never>): Promise<BindOrderPaymentResult>;
  findByOrder(required: { workspaceId: string; orderId: string }, optional?: Record<string, never>): Promise<CommerceOrderPaymentRecord | null>;
}
export type MarkOrderPaidResult = "paid" | "already_paid" | "not_pending" | "not_found";
// CommerceOrderRepoPort += markPaid(required: { workspaceId; orderId; at }): Promise<MarkOrderPaidResult>   // conditional UPDATE … WHERE status='pending'
```

The repository factories `commercePriceProviderRefRepoFor` and `commerceOrderPaymentRepoFor` are
exported from `catalog/repo.ts`, which is the public `./repo` entry (`package.json` exports). Each
is added in the shard that introduces it (P14, P15).

### 2.10 `catalog/load-payable-order.ts` + `catalog/pay-order.ts` (#12, R13)

```ts
export async function loadPayableOrder(required: { deps: { orders; prices }; input: { workspaceId; orderId; scope: PaymentScope } }, optional?: Record<string, never>):
  Promise<{ order: CommerceOrderRecord; item: CommerceOrderItemRecord; price: CommercePriceRecord }>;
export interface PayOrderDeps { orders; prices; priceRefs; orderPayments: CommerceOrderPaymentRepoPort; payments: PaymentsPort; settle: SettleOrderPaymentDeps; }
export async function payOrder(required: { deps: PayOrderDeps; input: { workspaceId: UUID; orderId: UUID; scope: PaymentScope } }, optional?: Record<string, never>): Promise<PayOrderResult>;
```

`loadPayableOrder` raises typed errors:

| Condition | Error |
|---|---|
| Order missing | `CommerceOrderNotFoundError` |
| Order not `pending` | `CommerceCheckoutValidationError` |
| Workspace or provider differs from the scope | `CommerceCheckoutValidationError` |
| Item count is not exactly 1 | `CommerceCheckoutValidationError` |
| Price missing | `CommercePriceNotFoundError` |
| Price is recurring | `CommerceCheckoutValidationError` |
| Snapshot `orderTotal` differs from `order.totalAmount` | `CommerceCheckoutValidationError` |

`payOrder` then runs these steps:

1. **Reserve.** Call `orderPayments.reserve({ order, scope, amount: order.totalAmount })`.
   - `conflict` raises `CommerceCheckoutValidationError` ("order already reserved for another
     scope"). It is raised **before any dispatch**, so a concurrent test and live request cannot
     both dispatch.
   - `same_scope` is a double click, and the call proceeds. Both calls send the same key
     `order:<id>`, and the kernel's unique race (`onUniqueRace`) gives both the **same** payment.
2. **Dispatch.** Call `payments.createIntent({ scope, amount, idempotencyKey: "order:<id>",
   reference: order.id }, { partyId: order.memberId, line })`. The provider price ref comes from
   `priceRefs.find`.
3. **Bind.** When the result carries a payment, call `orderPayments.bind(paymentId)`.
   - `conflict` raises an error.
   - A storage error propagates, and the caller retries `payOrder`. That retry reserves
     `same_scope`, replays, and binds.
   - A **crash between dispatch and bind** is safe: the reservation already exists, so settlement
     binds it (§2.11).
4. **Settle.** Call `settleOrderPayment` with `(paymentId, reference = order.id)`. This covers
   providers that succeed synchronously.

### 2.11 `catalog/settle-order-payment.ts` + `catalog/order-projection.ts` (R4, R13, r2-association)

```ts
export interface SettleOrderPaymentDeps { orders; orderPayments; payments: PaymentsPort; alerts: PaymentsAlertPort; clock: ClockPort; }
export type SettleOutcome = "paid" | "already_paid" | "not_ours" | "not_succeeded" | "blocked";
export async function settleOrderPayment(required: { deps: SettleOrderPaymentDeps; input: { workspaceId: string; mode: PaymentMode; paymentId: string; reference: string } }, optional?: Record<string, never>): Promise<SettleOutcome>;
export function createOrderPaymentProjector(required: { deps: SettleOrderPaymentDeps }, optional?: Record<string, never>):
  { handle(required: { message: PaymentsOutboxMessage }, optional?: Record<string, never>): Promise<SettleOutcome | "ignored"> };
```

`settleOrderPayment` runs these steps in order. Each is a small helper.

1. Read the association `findByOrder(workspaceId, reference)`.
   - **No association, and no order with that id**: `not_ours`. This is acknowledged silently;
     these are payments outside the order flow, such as agent-tool intents.
   - **No association, but the order exists**: alert `fulfillment-blocked` and return `blocked`
     (r2-R13). Every `payOrder` payment is reserved before dispatch, so this can only be a
     non-`payOrder` payment naming an order, or lost reservation storage. The alert names the order
     and payment. The operator settles it by calling the exported `settleOrderPayment` after fixing
     the data. No fulfillment is lost silently.
   - **Reserved but unbound**: the call proceeds. It is **never `not_ours`** (r2-association).
2. If `association.mode` differs from the message mode, return `blocked` with an alert.
3. Call `payments.getPayment({ scope: association scope, paymentId })`. The read is scope-fenced.
   A `null` result returns `blocked` with an alert.
4. If the status is not `succeeded`, return `not_succeeded`. This raises no alert.
5. If `association.paymentId` is set and differs, return `blocked` with an alert. This is a second
   payment for the same order, so money was taken twice.
6. `settlementProblem` checks that:
   - `payment.reference === order.id`;
   - the amount, captured amount, order total and association amount are all equal in minor units
     and currency;
   - the order provider matches the association;
   - the workspace matches.

   Any mismatch returns `blocked` with an alert.
7. If the association is unbound, call `bind(paymentId)`. A `conflict` returns `blocked` with an
   alert.
8. Call `orders.markPaid`. A `not_pending` or `not_found` result returns `blocked` with an alert.

**Acknowledgement policy.**

- Every outcome above returns, the relay marks the message published, and the alert is the
  escalation. The new alert kind is `fulfillment-blocked` in `contract/alerts.ts`.
- Storage exceptions propagate. The relay stops the batch and redelivers (`outbox-relay.ts:69`).
- `bind` and `markPaid` are idempotent.
- The projector acts only on `payment.succeeded` with a string `payload.reference`. Everything else
  is `ignored`.

### 2.12 Stripe plugin (`packages/provider-plugins/src/payments-stripe/`)

```ts
// provider.ts (r2-R14: required-object convention)
export const STRIPE_CAPABILITIES: ProviderCapabilities = { refunds: "none", capture: "auto", void: false, disputes: false,
  retrieve: "payment", echoesCorrelation: true, confirmation: ["redirect"], currencies: STRIPE_CURRENCIES };
export function createStripePaymentProvider(required: Record<string, never>, _optional: Record<string, never> = {}): PaymentProvider;
// index.ts: setup(sdk) registers { contract: "payments", id: "stripe", contractVersion: 1,
//   factory: () => ({ port: createStripePaymentProvider({}), dispose: () => {} }) }

// amount.ts (R7, r2-R7) — EXACT list, every entry has ISO exponent == Stripe API exponent:
export const STRIPE_CURRENCIES = ["AUD", "BRL", "CAD", "CHF", "CZK", "DKK", "EUR", "GBP", "HKD",
  "JPY", "KRW", "MXN", "NOK", "NZD", "PLN", "SEK", "SGD", "USD"] as const;   // 18; JPY and KRW are zero-decimal in both
export function toStripeAmount(required: { money: Money }, _optional: Record<string, never> = {}): { amount: number; currency: string } | null;
export function fromStripeAmount(required: { amount: unknown; currency: unknown }, _optional: Record<string, never> = {}): Money | null;

// http.ts
export async function stripeRequest(required: { ctx: ProviderContext; method: "GET" | "POST"; path: string },
  optional: { form?: ReadonlyArray<readonly [string, string]>; idempotencyKey?: string } = {}): Promise<Outcome<Readonly<Record<string, unknown>>>>;
export function stripeOutcome(required: { status: number; json: unknown }, _optional: Record<string, never> = {}): Outcome<Readonly<Record<string, unknown>>>;

// checkout-session.ts
export function checkoutSessionForm(required: { req: IntentRequest; ctx: ProviderContext }, _optional: Record<string, never> = {}): Array<[string, string]> | null;
export async function createCheckoutSession(required: { req: IntentRequest; ctx: ProviderContext }, _optional: Record<string, never> = {}): Promise<Outcome<{ evidence: PaymentEvidence; next: NextAction }>>;

// session-reading.ts
export type SessionReading = { kind: "evidence"; evidence: PaymentEvidence } | { kind: "id_only"; sessionId: string } | { kind: "foreign" } | { kind: "malformed"; reason: string };
export function readSession(required: { object: unknown; mode: PaymentMode }, optional: { eventType?: string } = {}): SessionReading;

// webhook-signature.ts, webhook.ts
export function verifyStripeSignature(required: { rawBody: Uint8Array; header: string | undefined; secret: string; nowMs: number }, _optional: Record<string, never> = {}): boolean;
export type Translation = { kind: "facts"; facts: readonly WebhookFact[] } | { kind: "ignored" } | { kind: "malformed"; reason: string };
export function translateStripeEvent(required: { event: unknown; mode: PaymentMode }, _optional: Record<string, never> = {}): Translation;
```

**Currencies (r2-R7, corrected reasoning).** Any currency outside the list makes `createIntent`
return `rejected CURRENCY_UNSUPPORTED` before any HTTP call. The exclusions fall into three groups:

- **ISK and UGX** (ISO zero-decimal) are sent by Stripe's API as two-decimal amounts. Supporting
  them needs a ×100 conversion that this phase does not build, so they are excluded.
- **HUF and TWD** are charged by Stripe as ordinary two-decimal amounts, the same as ISO. Their
  Stripe restrictions concern **payouts**, not charges. Excluding them is a **scope choice** under
  O3's conservative list, not a technical incompatibility.
- **Three-decimal currencies** (BHD, JOD, KWD, OMR, TND, …) require a trailing zero in Stripe and
  are excluded for the same scope reason.

**HTTP outcomes.**

| Response | Outcome |
|---|---|
| 2xx with a JSON object | ok |
| 2xx that does not parse | unknown |
| Transport throw, 5xx, or 409 `idempotency_key_in_use` | unknown, retryable |
| 400 `idempotency_error` | rejected `IDEMPOTENCY_CONFLICT` |
| 402 or `card_error` | rejected `DECLINED` |
| Other 400, or 404 | rejected `INVALID_REQUEST` |
| 401 or 403 | rejected `NO_CREDENTIALS_CONFIGURED` |
| 429 | rejected, retryable |

**createIntent.** The form contains:

- `mode=payment`, `success_url=ctx.returnUrl`, `cancel_url=ctx.cancelUrl`;
- `client_reference_id`, `metadata[jini_payment_id]` and
  `payment_intent_data[metadata][jini_payment_id]`, all set to the correlation id;
- `line_items[0]` as `price=providerPriceRef`, or as
  `price_data{ currency, unit_amount: toStripeAmount(line.unitAmount), product_data[name] }`;
- `quantity`.

The unit amount is sent, never the total. Without a `line`, the request is one unit of
`req.amount` named `Payment <correlationId>`. The `Idempotency-Key` header is `req.idempotencyKey`.

The response is checked before it is accepted:

- A missing `id` or `url` returns **unknown** (§2.5).
- If `fromStripeAmount(amount_total, currency)` differs from `req.amount`, the call returns
  `rejected INVALID_REQUEST` with no redirect.
- Otherwise it returns `requires_action` evidence plus a redirect.

**`readSession` mapping (R5, resolved).**

| Session | Status |
|---|---|
| `open` | `requires_action` |
| `expired` | `canceled` |
| `complete` + `paid` | `succeeded` |
| `complete` + `unpaid` | `pending` |
| `complete` + `no_payment_required` | `id_only` |
| Event `async_payment_failed` | `failed` |
| Event `async_payment_succeeded` | `succeeded` only if `paid` |

For `retrieve` with `expand[]=payment_intent`: an expanded PI with `requires_payment_method` or
`canceled` under `complete+unpaid` maps to `failed`. A PI that is only an id string means the
session status alone decides.

**Webhook classification (R6, r2-R6).** The first matching row wins.

| Check | Result |
|---|---|
| Signature invalid (`t=…,v1=…`, HMAC-SHA256 over `"<t>." + raw bytes`, length-checked `timingSafeEqual`, `|ctx.now()/1000 − t| ≤ 300`) | rejected `SIGNATURE_INVALID` |
| Not JSON, or missing `id`, `type`, numeric `created` or `data.object` | rejected `INVALID_REQUEST` |
| `livemode` does not match `ctx.account.mode` | rejected `INVALID_REQUEST` |
| Type is not one of the four `checkout.session.*` types | `ok([])` (unsupported) |
| `data.object.metadata.jini_payment_id` is absent | `ok([])` (foreign) |
| **Our metadata, but `object !== "checkout.session"`**, or `mode !== "payment"`, or no session `id` | **rejected `INVALID_REQUEST`** (malformed, r2-R6) |
| Our session, evidence incomplete | id-only fact, then worker `retrieve` (`worker.ts:161-170`) |
| Otherwise | `[{ providerEventId: event.id, providerRef: session.id, occurredAt: created * 1000, evidence }]` |

---

## 3. Files

| Area | File | Kind | Anchor / note |
|---|---|---|---|
| contract | `payments/contract/provider.ts` | edit | ctx `:68-77`, req `:79-90`, verify doc `:130-134` |
| contract | `payments/contract/evidence.ts` | edit (doc) | `:238-248` |
| ctx fixtures | `testkit/lipay-fake.ts:140`, `ops/__tests__/harness.ts:129`, `testkit/__tests__/provider-conformance.vitest.test.ts:24`; `core/docs/provider-registry.md:56` | edit | `rg webhookUrl`: the only ctx literals |
| port + intent | `payments/contract/payments-port.ts:55-58`, `payments/ops/intent.ts` (`lookupIntent :58-68`, `checkIntent :44-56`, `req :163-167`) | edit | — |
| outbox | `payments/accounting/apply-evidence.ts:253,:413` | edit | + `reference` |
| receive | `payments/ingest/receive.ts:50-53,:118-143` | edit | — |
| attach | `payments/provider-contract.ts` | new | — |
| attach | `payments/plugin-contribution.ts` + `__tests__/kernel/plugin-contribution.vitest.test.ts` | **delete −330** | O1 |
| attach | `payments/kernel.ts:17-19` | edit | exports (serialised: P10 → P11 → P12) |
| credentials | `payments/provider-contexts.ts` | new | — |
| alerts | `payments/contract/alerts.ts:8-16` | edit | + `fulfillment-blocked` |
| client | `payments/contract/checkout-client.ts`, `payments/client.ts` | new | — |
| package | commerce `package.json` | edit | P01: `test` script glob; P09: `./payments/client` entry; P31: `files` + `NOTICE` |
| coverage | commerce `vitest.coverage.config.ts`, `coverage-gates/*.json` (new dir) | edit/new | §5 |
| catalog | `catalog/database.ts:4-11`, `catalog/ports.ts:30-54`, `catalog/repo.ts` (order repo `:205-250`, factories) | edit | serialised P14 → P15 → P16 |
| catalog | `catalog/repo.price-refs.ts`, `catalog/repo.order-payments.ts`, `catalog/load-payable-order.ts`, `catalog/pay-order.ts`, `catalog/settle-order-payment.ts`, `catalog/order-projection.ts` | new | — |
| catalog | `catalog/index.ts:1-7`, `catalog/checkout.ts:92-112` (doc) | edit | — |
| fixtures | `catalog/__tests__/unit/repo.vitest.test.ts:37-55` (DDL), `checkout.unit.test.ts:26`, `checkout-boundaries.vitest.test.ts` (fake order repo) | edit | in the shard that changes the contract |
| UI | `react/Payments.tsx:56-57` + test | edit | — |
| plugin | `src/payments-stripe/{amount,http,checkout-session,session-reading,webhook-signature,webhook,provider}.ts` | new | — |
| plugin | `src/payments-stripe/{index.ts,jini.plugin.json,README.md}` | edit | — |
| plugin | `src/payments-stripe/stripe.ts`, `src/__tests__/payments-stripe.test.ts`, `payments-stripe-runtime-ports.test.ts` | **delete −484** | D1 |
| plugin | `src/__tests__/artifact.integration.test.ts` (`:43-44`, near `:75`), `src/__tests__/core-boundary.test.ts` | edit | — |
| plugin pkg | `provider-plugins/package.json` (devDep `@jini-ai/commerce`, `test:coverage`, `files`), `vitest.coverage.config.ts` + `coverage-gates/` (new), `NOTICE` (new) | edit/new | — |
| lockfile | `pnpm-lock.yaml` (repo root) | edit | **owned by P23 only** (the single dependency change in Phase 1) |
| packaging | commerce `NOTICE` | new | — |

---

## 4. Data and migrations

**Payments ledger: no change.** Step 0005 and the request snapshot are removed (C-1). The only
payments-side change is the `reference` key added to the JSON outbox payload, which needs no
schema change.

**Catalog: a host migration (D2).** This is a prerequisite: Tovu ships an ADR-066 TS migration
**before** the host enables `payOrder`. Commerce never creates catalog tables (`database.ts:3`).
The DDL below is documented in the README and mirrored in the borrowed-schema fixture
`repo.vitest.test.ts:37-55` **in the same shard** that edits `database.ts`.

```sql
CREATE TABLE commerce_price_provider_refs (
  workspace_id TEXT NOT NULL, price_id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_account_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test','live')), provider_price_ref TEXT NOT NULL CHECK (length(provider_price_ref) > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, price_id, provider_id, provider_account_id, mode));

CREATE TABLE commerce_order_payments (
  workspace_id TEXT NOT NULL, order_id TEXT NOT NULL,
  site_id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_account_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test','live')), amount_minor BIGINT NOT NULL, currency TEXT NOT NULL,
  payment_id TEXT NULL,                       -- NULL = reserved before dispatch; set once by bind
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, order_id),       -- one reservation per order: concurrent test/live or double clicks cannot both dispatch
  UNIQUE (workspace_id, mode, payment_id));
```

`commerce_orders` and `commerce_products` are unchanged.

---

## 5. Tests and coverage (R19, r2-coverage)

**Runner separation (P01).**

- The commerce `test` script's node glob changes from `src/catalog/__tests__/unit/*.test.ts` to
  **`src/catalog/__tests__/unit/*.unit.test.ts`**. Today the old glob also matches the four
  `*.vitest.test.ts` files in that directory.
- Every Phase 1 test is Vitest and named `*.vitest.test.ts` in commerce. Vitest includes are
  unchanged (`vitest.coverage.config.ts:10`).
- The `node:test` catalog suite stays a regression suite. Phase 1 coverage is never claimed from
  it.
- Provider-plugins tests stay Vitest (`*.test.ts`), with a new coverage config scoped to
  `src/payments-stripe/**`.

**Baseline first (P01).**

- Run both packages' full suites and coverage at the P01 parent commit.
- Record the test counts and `coverage-summary.json` totals in the P01 commit message and in
  `ADS-memory/.local-artifacts/handoff/commerce-phase1-baseline.md`.
- Add no thresholds yet.
- On this branch the combined config and the `test:coverage` script exist. The reviewer's checkout
  lacked them; that is checkout drift.

**Incremental gates (no shared threshold file).**

- Each package's coverage config merges every `coverage-gates/*.json` into `coverage.thresholds`
  as per-file globs at 100/100/100/100.
- **Each shard adds its own `coverage-gates/Pxx.json`**, listing exactly the source files it tests
  to 100%. Shards therefore never edit a shared gate file.
- Package totals may not fall below the P01 baseline. This is enforced by a `baseline.json`
  committed in P01.

**Reports.** Every shard report includes the shard id, test counts before and after, the coverage
JSON, and the pushed SHAs. The dispatch prompt carries `honest-testing`.

**Test cases by behaviour** (Vitest throughout; each in its shard):

| Behaviour | Key cases |
|---|---|
| `cancelUrl` and docs (P02) | ctx fixtures compile; conformance still passes |
| LiPay live guard (P03) | every method is rejected in live mode; test mode is unchanged |
| Ignored (P04) | `ok([])` gives 200 `ignored:true` with zero transactions; everything else gives `ignored:false`; the route passes the body through |
| Rejected replay (P05) | rejected, then the same key gives `ok:false`, the original code, "replayed", and no provider call; an ok replay is unchanged; an unknown replay gives `ok:true` with `next:null` and no dispatch |
| `line` (P06) | forwarded verbatim; absent means not forwarded; product, currency or quantity violations give `INVALID_REQUEST` and write no row |
| Outbox `reference` (P07) | present on both enqueue paths; old payloads still relay |
| **Lost response (P08, C-1)** | Provider `unknown` gives payment `unknown`, never failed. The retry replays with the same key and **no second dispatch** (asserted by the fake's call count). The reconciler `leave`s with an `unknown-aged` alert. `resolveUnknown` resolves it. A late signed-evidence webhook carrying the correlation id settles the payment through the worker. |
| Client (P09) | `null` gives pending; https and localhost-http are followed; `http://evil`, `javascript:`, `data:` and unparseable URLs are refused without navigating; client action with and without a handler; handler rejection propagates |
| Contract and lease (P10) | the validator accepts the fake and refuses a malformed port; a lease retired before a call gives a rejected `createIntent`, an unknown `retrieve` and `verifyWebhook`, and **no inner call** (spy) |
| Credentials (P12) | the §0.4 isolation list, including the unreadable config |
| Price refs (P14) | a hit; a miss for each key part; upsert |
| Association (P15) | reserve gives `reserved`, `same_scope` or `conflict` (other site, account, mode or amount); **concurrent reserves with different scopes give exactly one `reserved`**; bind gives `bound`, `already_bound`, `conflict` or `not_found`; `findByOrder` |
| `markPaid` (P16) | all four results; a concurrent double call gives exactly one `paid` |
| Settlement (P18) | one negative test per mismatch (workspace, site, account, provider, mode, amount, currency, reference, captured, status, second payment); reserved-unbound gets bound, never `not_ours`; no association with the order present raises an alert; no association and no order gives `not_ours`; `not_pending` raises an alert; a storage throw propagates |
| Projector (P19) | non-success topics and a missing reference are ignored; redelivery is idempotent |
| `loadPayableOrder` (P20) | every refusal row |
| `payOrder` (P21) | exact `createIntent` args; a reservation conflict causes **no dispatch**; **a crash between dispatch and bind** (`bind` throws) followed by a webhook settles the order through the reservation; **concurrent double click** gives one payment, and both calls return it; replay; sync-success settles; a rejected result passes through |
| UI (P22) | renders the given summaries only; empty gives "Setup required" |
| Stripe amount (P23) | USD and JPY round-trip; ISK, UGX, HUF, TWD, KWD and MGA give `null`; negative or non-integer input gives `null`; round-trip over all 18 |
| Stripe HTTP (P24) | every outcome-table row; Bearer auth; nested form keys; `Idempotency-Key` only when given |
| Stripe session (P25) | price ref vs `price_data`; **quantity 3 sends the unit amount**; the no-line name; unsupported currency makes no HTTP call; `amount_total` mismatch gives rejected with no redirect; a missing url gives unknown |
| `readSession` (P26) | every mapping row; expanded PI vs id-only PI; malformed and foreign |
| Signature (P27) | valid; one tampered byte; a re-serialized body fails (exact bytes); wrong secret; ±300 s passes and ±301 s fails (via `ctx.now`); several `v1` values; wrong-length or non-hex `v1`; missing or garbled header. **Signatures are computed in the test with `node:crypto`.** |
| Translate (P28) | every classification row, including **our metadata on a non-`checkout.session` object being malformed** |
| Provider (P29) | commerce `providerConformanceCases`; `retrieve` |
| Artifact and manifest (P30) | the packed artifact validates through `paymentsProviderContract.validate`; the probe (garbage webhook) is rejected without network; settings follow the convention; no legacy port remains |
| NOTICE (P31) | `licenses/@jini-ai_provider-plugins/NOTICE` is integrity-pinned and contains "Open SaaS" and `c2c6285b`; commerce `npm pack --dry-run --json` lists `NOTICE` |
| E2E (P34–P35) | Real Stripe adapter, kernel, catalog fakes, `createProviderContexts`, a lease-guarded registry with bindings, a scripted `HttpClientPort`, and **independently signed** bytes. Happy path; unpaid then paid; exactly once; reorder; redelivery; a second plugin claiming `stripe` is refused; lease retirement; mismatch and wrong mode never settle; lost response stays unresolved and a late webhook settles; crash between dispatch and bind; concurrent `payOrder` |
| Boundary (P33) | production-literal and sibling-import rules, each proven by a fixture |

---

## 6. Build shards (renumbered, rev 3; r2-schedule, R17)

**Rules.**

- Estimates count **implementation + tests**, as additions and deletions, against a cap of about
  150.
- Every behaviour ships with its tests in the same shard.
- A file is edited by more than one shard **only** in the order of the "Depends on" column.
- Every shard ends with `pnpm guard`, `pnpm typecheck`, both packages' tests, and the coverage
  gates its own `coverage-gates/Pxx.json` turns on. It is then committed and pushed (cloud rule 2).

| # | Shard | Files | Impl | Tests | Total | Depends on |
|---|---|---|---|---|---|---|
| P01 | Runner split, coverage configs, baseline | commerce `package.json` (test glob), commerce `vitest.coverage.config.ts` (gate merge), provider-plugins `vitest.coverage.config.ts` + `package.json` (`test:coverage`), both `coverage-gates/baseline.json` | 45 | 0 | 45 | — |
| P02 | `cancelUrl` + contract docs | `provider.ts`, `evidence.ts` (doc), `lipay-fake.ts:140`, `ops/__tests__/harness.ts`, `provider-conformance.vitest.test.ts`, `core/docs/provider-registry.md` | 15 | 5 | 20 | P01 |
| P03 | LiPay live guard | `lipay-fake.ts`, `lipay-fake.vitest.test.ts`, gate | 25 | 35 | 60 | P02 |
| P04 | Ignored webhooks | `receive.ts`, `receive.vitest.test.ts`, `payments-webhook.vitest.test.ts`, gate | 15 | 35 | 50 | P01 |
| P05 | Rejected-intent replay | `ops/intent.ts`, `intent.vitest.test.ts`, gate | 15 | 45 | 60 | P01 |
| P06 | `IntentLine` validation + forwarding | `provider.ts`, `payments-port.ts`, `ops/intent.ts`, `intent.vitest.test.ts` | 45 | 65 | 110 | P02, P05 |
| P07 | Outbox `reference` | `apply-evidence.ts`, `apply-evidence.vitest.test.ts`, `outbox-relay` test (old payload), gate | 6 | 45 | 51 | P01 |
| P08 | Lost response: unresolved (tests only, C-1) | `ops/__tests__/lost-response.vitest.test.ts` (new); reconciler assertions only if an existing one must change (none expected; otherwise stop and report) | 0 | 110 | 110 | P05 |
| P09 | Browser client | `checkout-client.ts`, `client.ts`, commerce `package.json` (entry), test, gate | 55 | 70 | 125 | P01 |
| P10 | Contract validator + lease guard | `payments/provider-contract.ts`, `kernel.ts`, test, gate | 70 | 80 | 150 | P02 |
| P11 | Delete second attachment authority (O1) | delete `plugin-contribution.ts` + test; `kernel.ts` export | 0/−138 | 0/−192 | **−331** | P10; **cap exception (approved)** |
| P12 | Credential adapter | `payments/provider-contexts.ts`, `kernel.ts`, test, gate | 75 | 75 | 150 | P11 |
| P13 | Alert kind | `contract/alerts.ts` (+1 kind) + alerts type test | 3 | 10 | 13 | P01 |
| P14 | Price refs (#4) | `database.ts`, `ports.ts`, `repo.price-refs.ts`, `repo.ts` (factory export), `repo.vitest.test.ts` (DDL), `repo.price-refs.vitest.test.ts`, gate | 60 | 70 | 130 | P01 |
| P15 | Association reserve/bind | `database.ts`, `ports.ts`, `repo.order-payments.ts`, `repo.ts` (factory export), `repo.vitest.test.ts` (DDL), `repo.order-payments.vitest.test.ts`, gate | 70 | 80 | 150 | P14 |
| P16 | `markPaid` | `ports.ts`, `repo.ts`, `checkout.unit.test.ts:26` + `checkout-boundaries.vitest.test.ts` fakes, `repo.mark-paid.vitest.test.ts`, gate | 30 | 65 | 95 | P15 |
| P17 | *(reserved: none; kept so later numbers stay stable)* | — | — | — | — | — |
| P18 | `settleOrderPayment` | `catalog/settle-order-payment.ts`, test, gate | 70 | 80 | 150 | P07, P13, P16 |
| P19 | Projector | `catalog/order-projection.ts`, test, gate | 25 | 50 | 75 | P18 |
| P20 | `loadPayableOrder` | `catalog/load-payable-order.ts`, test, gate | 40 | 70 | 110 | P16 |
| P21 | `payOrder` | `catalog/pay-order.ts`, `catalog/index.ts`, `checkout.ts` (doc), test, gate | 45 | 105 | 150 | P06, P18, P20 |
| P22 | Core UI vendor leak | `react/Payments.tsx`, its test, gate | 15 | 25 | 40 | P01 |
| P23 | Stripe amount + dependency + **lockfile** | `amount.ts`, its test, provider-plugins `package.json` (devDep), `pnpm-lock.yaml`, gate | 45 | 60 | 105 + lock | P01, P02 |
| P24 | Stripe HTTP | `http.ts`, its test, gate | 60 | 80 | 140 | P23 |
| P25 | Stripe session create | `checkout-session.ts`, its test, gate | 65 | 85 | 150 | P06, P24 |
| P26 | `readSession` | `session-reading.ts`, its test, gate | 50 | 90 | 140 | P23 |
| P27 | Signature | `webhook-signature.ts`, its test, gate | 40 | 90 | 130 | P23 |
| P28 | Translate | `webhook.ts`, its test, gate | 60 | 90 | 150 | P26, P27 |
| P29 | Provider assembly | `provider.ts`, its test (conformance), gate | 45 | 60 | 105 | P25, P28 |
| P30 | Switch artifact + delete legacy (D1) | `index.ts`, `jini.plugin.json`, `README.md`, `artifact.integration.test.ts`, manifest test (new); delete `stripe.ts` + 2 tests | 45/−203 | 60/−281 | +105/**−484** | P29, **P10** (validator); **cap exception (approved)** |
| P31 | NOTICE packaging | both `NOTICE`, both `package.json` (`files`), `artifact.integration.test.ts`, `packaging.vitest.test.ts` | 50 | 40 | 90 | P09, P30 |
| P32 | *(reserved: none)* | — | — | — | — | — |
| P33 | Boundary gate | `core-boundary.test.ts` | 0 | 90 | 90 | P30 |
| P34 | E2E (a): happy, unpaid → paid, reorder, redelivery, bindings, lease retirement | `payments-stripe-kernel.test.ts` (new) | 0 | 150 | 150 | P12, P19, P21, P30 |
| P35 | E2E (b): mismatch, wrong mode, lost response + late webhook, crash between dispatch and bind, concurrent `payOrder` | same file | 0 | 140 | 140 | P34, P08 |
| P36 | Docs | commerce `README.md` (host DDL prerequisite, composition recipe, constraints), `source-map.md`, `CHANGELOG.md`, gap-report status | docs | — | — | all |

**Serialised shared files.**

| File | Order |
|---|---|
| `provider.ts` | P02 → P06 |
| `ops/intent.ts` and `intent.vitest.test.ts` | P05 → P06 |
| `lipay-fake.ts` | P02 → P03 |
| `kernel.ts` | P10 → P11 → P12 |
| `database.ts`, `ports.ts`, `repo.ts`, `repo.vitest.test.ts` | P14 → P15 → P16 |
| commerce `package.json` | P01 → P09 → P31 |
| provider-plugins `package.json` | P01 → P23 → P31 |
| `artifact.integration.test.ts` | P30 → P31 |
| `payments-stripe-kernel.test.ts` | P34 → P35 |
| `pnpm-lock.yaml` | P23 only |

**Parallel lanes after P02.**

- {P03}
- {P04}
- {P05 → P06 → P08}
- {P07}
- {P09}
- {P10 → P11 → P12}
- {P13}
- {P14 → P15 → P16 → P18/P20 → P19/P21}
- {P22}
- {P23 → P24/P26/P27 → P25/P28 → P29 → P30 → P31/P33}

---

## 7. OpenSaaS adaptation and attribution (R20, resolved)

The reference is `wasp-lang/open-saas` at **`c2c6285bdb14b040584505372ad9bb062a0bca11`**, MIT,
© 2023 wasp-lang. Paths below are under `template/app/src/payment/`.

| OpenSaaS | Adapted as | Differences |
|---|---|---|
| `paymentProcessorPlans.ts:9-42` | `CommercePriceProviderRefRepoPort` | Database rows keyed by account and mode |
| `stripe/checkoutUtils.ts:34-71` | `checkoutSessionForm` | Raw REST; exact unit amount; fixed currency list. **Omitted:** `customer`, `customer_update` (customer-dependent, #9), `automatic_tax`, `allow_promotion_codes`, `invoice_creation` |
| `stripe/webhook.ts:106`, `:266` | `readSession` + settlement | **Changed fulfillment trigger:** a Checkout `payment_status === "paid"` goes through the single writer, then the outbox, then the association-verified projector. Never `invoice.paid` writing a user row. |
| `stripe/webhook.ts:45-57`, `errors.ts` | `ok([])` → 200 `ignored` | Malformed supported events are rejected, not swallowed |
| `redirectToCheckout.ts`, `paymentProcessorClient.ts` | `openCheckout` | Injected `navigate`; scheme allow-list; nullable `next` |
| `paths.ts:19` | `returnUrl` / `cancelUrl` | Portal-return URL deferred with the portal |

Never copied:

- the user-row billing model;
- `processedWebhookEvent.ts`;
- vendor-sum revenue;
- inline emails;
- email-based customer lookup.

Two `NOTICE` files carry the full MIT text and the commit hash: one at the `provider-plugins`
root, which `retainLicenses` (`build.ts:49-73`) copies into every artifact, and one at the commerce
root. Both `files` lists include it, and P31 tests the packed contents.

---

## 8. Open items

None blocking. O1–O4 and both cap exceptions were signed off (§0.1). The rest needs only a
Coordinator check at dispatch time: the deletion-only shards P11 and P30, which are approved.

---

## Review responses — round 1 (`REVIEW-codex-phase1.md`, answered in rev 2)

| R | Verdict | Response (rev 2; rev-3 status in brackets) |
|---|---|---|
| 1 | Accept | Existing artifact entry/setup/`contractVersion: 1` reused; commerce supplies the validator. [r2: RESOLVED] |
| 2 | Accept | One authority (plugin host provider artifacts); agent-plugins spec removed. [r2: PARTLY → lease guard added, §2.7/P10] |
| 3 | Accept | `createProviderContexts` with account/mode/site isolation. [r2: PARTLY → unreadable config handled, §0.4/P12] |
| 4 | Accept | Durable association verified before `markPaid`. [r2: PARTLY → reserved before dispatch, §2.9–2.11/P15/P21] |
| 5 | Accept | Full Checkout state mapping. [r2: RESOLVED] |
| 6 | Accept | Ignored vs malformed vs id-only. [r2: PARTLY → our metadata on a non-session object is malformed, §2.12/P28] |
| 7 | Accept | Exact unit amount; currency allow-list. [r2: PARTLY → exact 18-code list, HUF/TWD reasoning corrected, §2.12/P23] |
| 8 | Accept | Stored rejection replayed via `rejectedReplay`. [r2: RESOLVED; kept] |
| 9 | Accept | Bounded recovery with original key. [r2: PARTLY → **superseded by C-1**: no automatic recovery; unresolved + alert + operator; late webhook settles, §2.5/P08] |
| 10 | Accept | Effects cut. [r2: RESOLVED] |
| 11 | Accept | Portal cut. [r2: RESOLVED] |
| 12 | Accept | Exact charging; `amount` meaning kept. [r2: RESOLVED] |
| 13 | Accept | One item; acknowledgement policy. [r2: PARTLY → missing association with existing order alerts, never silent, §2.11/P18] |
| 14 | Accept | Names corrected. [r2: PARTLY → required-object signature, factory exports scheduled, §2.9/§2.12] |
| 15 | Accept | No `apiBase`/tolerance options; fake-local LiPay guard. [r2: RESOLVED] |
| 16 | Accept | Host migration named; fixtures in the same shard. [r2: PARTLY → attempt-constructor point moot (no new attempt fields after C-1); see r2-R16] |
| 17 | Accept | Rebuilt schedule. [r2: NOT RESOLVED → rebuilt again, §6] |
| 18 | Accept | Stripe E2E with independent signatures. [r2: RESOLVED; extended to association cases, P34–P35] |
| 19 | Accept | Coverage across runners. [r2: PARTLY → runner split, baseline first, per-shard gates, §5] |
| 20 | Accept | NOTICE packaged in both distributions. [r2: RESOLVED] |
| 21 | Accept | Executable boundary gate. [r2: RESOLVED] |

## Review responses — round 2 (`REVIEW-codex-phase1-r2.md`, answered in rev 3)

| Item | Verdict | Response |
|---|---|---|
| R2 (partly) | **Accept** | The registry never holds the raw port. `leasedProviderItem` checks `lease.isCurrent({})` before every method: a retired lease gives a rejected `createIntent` (nothing dispatched) and an unknown `retrieve`/`verifyWebhook` (503 or redelivery, reconcile later). Identity and capabilities are frozen at wrap time. Tested in P10 and in E2E P34. |
| R3 (partly) | **Accept** | A throw from the reader (`ProviderConfigUnreadableError`, `provider-config-source.ts:30`, or a storage error) is caught and becomes `NO_CREDENTIALS_CONFIGURED`, retryable, with a fixed message carrying no secret text. Webhooks therefore get 503 and redelivery, and charges fail before any row. Test in P12. |
| R4 (partly) / NEW-association | **Accept** | The association is **reserved before dispatch**, keyed by `(workspace, order)`, with the full scope and amount. `reserve` is insert-or-classify, so concurrent test/live requests or double clicks cannot both dispatch, and a same-scope double click converges on one payment through the kernel key. `bind` runs after dispatch. Settlement locates the order through the payment's `reference` (now in the outbox payload) and the association, so a **reserved-but-unbound association is never `not_ours`**. Tests cover a crash between dispatch and bind, and concurrent calls (P15, P21, P35). |
| R6 (partly) | **Accept** | Our `jini_payment_id` metadata on an object other than `checkout.session` gives `rejected INVALID_REQUEST` (malformed). Unsupported types and foreign objects stay `ok([])`. P28. |
| R7 (partly) | **Accept** | Exact list of 18 codes, with no ellipsis. Corrected: ISK and UGX are excluded because Stripe represents them as two-decimal; HUF and TWD **charge** two-decimal like ISO, and their restrictions concern payouts, so excluding them is a scope choice (O3). Three-decimal currencies are a scope choice too. Tests in P23 (MGA included, as a currency whose ISO and Stripe exponents differ). |
| R9 (partly) | **Superseded (C-1)** | Automatic recovery is removed, so the parameter-stability, concurrency and conflict-persistence concerns no longer apply. §2.5 describes the unresolved path using only existing mechanisms; P08 pins it with tests. |
| R13 (partly) | **Accept** | A payment whose `reference` names an existing order without an association raises `fulfillment-blocked` and is acknowledged. It is escalated, never silent; the operator re-runs the exported `settleOrderPayment`. Only a reference naming no order at all is `not_ours`. Storage errors are never acknowledged. |
| R14 (partly) | **Accept** | `createStripePaymentProvider(required: Record<string, never>, _optional = {})`. All new functions follow `(required, optional = {})`. The repository factories `commercePriceProviderRefRepoFor` and `commerceOrderPaymentRepoFor` are exported from `./repo` in P14 and P15. |
| R16 (partly) | **Accept / moot** | After C-1, no attempt fields are added, so `ops/common.ts:124` (the attempt constructor defaults) is untouched. The host-migration part was already resolved, and fixtures change in the same shard as the contract (P14–P16). |
| R17 / NEW-schedule | **Accept** | Renumbered P01–P36. Each shard lists its dependencies explicitly; serialised shared files are listed. Other fixes: P30 depends on P10 (validator); P08 owns any reconciler assertion; factory exports are in P14 and P15; the lockfile belongs to P23 only. Estimates are implementation **plus** tests. Only the two approved deletion shards exceed the cap. |
| R19 (partly) / NEW-coverage | **Accept** | The node glob narrows to `*.unit.test.ts`, so the four Vitest files no longer match it. The baseline is recorded in P01 before any threshold. Each shard turns on its files' 100% gates through its own `coverage-gates/Pxx.json`, so no gate file is shared. A totals floor comes from `baseline.json`. |
| NEW-recovery parameters | **Superseded (C-1)** | No re-dispatch, so no request or URL snapshot is needed. |
| NEW-recovery state | **Superseded (C-1)** | No recovery state machine. Today a lost response stays `unknown` (`recordIntentDispatchOutcome`), and nothing marks it `failed`. |
| Open items O1–O4 | **Recorded** | All YES (§0.1). O4 is moot after C-1, and no `idempotencyWindowMs` capability is added. |
