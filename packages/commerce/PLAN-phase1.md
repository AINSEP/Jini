# `@jini-ai/commerce` — Phase 1 plan: one-time purchases through the attached Stripe plugin

**Revision 2 (2026-10-29).** This replans after the Codex review
(`REVIEW-codex-phase1.md`, verdict REPLAN) and the owner's decisions of the same day. It
supersedes revision 1 (`db41e253`). It is still a plan only: no code is changed. Base:
`32226f0e`. Gap-report rows are written #N (`REPORT-opensaas-gap.md`) and review items R1–R21.
Paths are relative to `packages/commerce/` unless they start with `packages/`.

**Phase 1 goal.** A member buys one active one-time price, is redirected to a real Stripe-hosted
Checkout, and pays. The order becomes `paid` only after that payment's evidence is verified
against the order's durable payment association, which pins workspace, site, account, provider,
mode, amount and currency. The path reuses `checkout()`, `PaymentsPort.createIntent`, `NextAction`,
the scoped ledger, the inbox/worker, the single writer, the outbox and the storefront.

```
checkout() → payOrder() ─createIntent(key order:<id>, line)→ PaymentsPort ─→ Stripe plugin: POST checkout/sessions
   │            └─ save OrderPayment association (order ↔ payment, full scope, amount)       └→ NextAction{redirect}
browser ← openCheckout(next) ← PaymentView.next
Stripe ─signed webhook→ receive (verify; facts | ignored) → inbox → worker (retrieve if id-only) → single writer
single writer ─outbox payment.succeeded(aggregateId = payment id)→ relay → host bus → order projector
order projector → settleOrderPayment: association by payment id → scope-fenced getPayment → verify all → markPaid
```

---

## 0. Owner decisions (2026-10-29) and plugin model

| # | Decision | Effect on this plan |
|---|---|---|
| D1 | **Yes**: delete the legacy `payments-stripe/stripe.ts` adapter and its 2 tests | Shard P22 |
| D2 | **The host** ships catalog schema changes through its own migration (Tovu: ADR-066 TS migrations); borrowed-schema fixtures are updated in the same shard | §4, P10–P12 |
| D3 | Retire the catalog's second webhook inbox in **Phase 2** | Untouched now |
| D11 | **The Stripe plugin is the default production provider.** LiPay fake is test-only, enforced fake-locally, never by LiPay policy in core | P2 |
| D12 | Keep manifest `contributes.providers` only if the loader needs it today → **it does** (setup capture + `contractVersion === 1` validation) | §0.2 |
| D13 | **Not now.** `PaymentEvidence.amount` keeps its meaning; tax/subtotal is a later explicit design | §0.5 |
| Cuts | Purchase effects (#3, R10) and customer portal (#8, R11) **deferred** | Removed from scope |

### 0.1 Where vendors live

Every payment vendor is a **self-contained provider artifact** in `@jini-ai/provider-plugins`:
`packages/provider-plugins/src/payments-<vendor>/`. Each one is built by `scripts/build.ts:97`
into its own digest-pinned `plugins/<id>/<version>/server/index.mjs`. Phase 1 **extends the
existing `payments-stripe`** artifact: same id, same folder, same `contract: "payments"` / `id:
"stripe"`. Its port now implements commerce's canonical `PaymentProvider` instead of the legacy
`charge`/`getCharge`/`refund` port. PayPal, Lemon Squeezy, Paddle and Polar will be sibling
folders. Core holds the vendor-neutral contract only. LiPay is a test fake, not a provider (§0.4).

### 0.2 One attachment authority: `@jini-ai/plugins/host` provider artifacts (R1, R2)

The **only** way a payment vendor attaches is the existing provider-artifact path. No new
lifecycle is added, and commerce's unused agent-plugins contribution spec is **removed**
(`payments/plugin-contribution.ts`, 138 lines, plus its 192-line test; `rg` finds no consumer
outside its own test). Lifecycle:

| Step | Who / where | What happens |
|---|---|---|
| install | existing installer + `catalog.json` | Immutable-version folder; `jini.plugin.json` integrity covers `server/index.mjs` and `licenses/**` |
| discover → load | `loadPlugin` (`packages/plugins/src/host/node/loader.ts`); standalone via `loadProviderPluginArtifact` (`node/provider-artifact.ts:16`), per site via the site provider host | Integrity → SDK range → import → `definition.setup(sdk)` (`loader.ts:184-205`) |
| register | the plugin's `setup` | `sdk.providers.register({ contract: "payments", id: "stripe", contractVersion: 1, factory })`. `contractVersion: 1` is the only accepted value (`provider-contributions.ts:23-32`), so "payments v1" now **means** the commerce `PaymentProvider` port. The legacy port's only consumer is the artifact test, updated in P22. |
| validate | the host's provider host `contracts` (`provider-host.ts:6-11`) | The domain owner supplies the validator: commerce exports `paymentsProviderContract = { contract: "payments", validate: ({ provider }) => paymentProviderModuleProblem(provider) }` (new `payments/provider-contract.ts`). It is typed structurally, so commerce still never imports the plugin host. |
| initialize | `host.initialize({ contract: "payments", id: "stripe", input: {} })` | The factory takes no credentials (the provider is stateless; credentials arrive per call in `ctx`). It returns `{ port: PaymentProvider, dispose: noop }`. |
| commerce registration | host composition | `createKernelProviderRegistry({ items: [{ pluginId: "payments-stripe", module: resource.port }] }, { bindings: { stripe: "payments-stripe" } })` (`provider-registry.ts:55-58`). **Bindings are passed explicitly**, and the E2E test (P25) asserts that a second plugin claiming `stripe` is refused. |
| detach | host | `resource.dispose({})`; the host rebuilds the registry without the item. With no registry entry, the webhook route answers `503 PROVIDER_NOT_REGISTERED` and redelivery keeps events safe (`receive.ts:113-115`). |

`contributes.providers[0]` stays in the manifest because the loader requires it today (D12). It
also carries `settings`, which the host settings UI renders.

### 0.3 Credentials: plugin-owned fields + a real per-account/per-mode adapter (R3)

- **Fields (plugin-owned).** Fields are declared in `contributes.providers[0].settings` under a
  vendor-neutral convention that core enforces for every payments plugin:
  - `accountId` (public, required): the provider account this config is for.
  - For each slot `k` in `provider.credentialKeys`, two secret settings: `test_<k>` and `live_<k>`.
  - Stripe: `credentialKeys = ["secretKey", "webhookSecret"]` gives `test_secretKey`,
    `test_webhookSecret`, `live_secretKey` and `live_webhookSecret`.
  - The names satisfy the setting grammar `^[A-Za-z][A-Za-z0-9_]{0,63}$`. The manifest test
    (P22) asserts that this convention matches `credentialKeys`.
- **Storage.** The existing `ProviderConfigSource` (`packages/plugins/src/host/provider-config-source.ts:26-41`)
  is keyed by `pluginId` within a project or site store. It is unchanged.
- **Adapter (new, core, vendor-neutral): `payments/provider-contexts.ts`**, implementing the
  existing `ProviderContextPort` (`provider-registry.ts:81-86`):

```ts
/** Structural mirror of the plugin host's ProviderConfigSource.read — commerce never imports the host. */
export interface ProviderConfigReaderPort {
  read(required: { pluginId: string }, optional?: Record<string, never>): Promise<{ settings: Readonly<Record<string, string>>; secrets: Readonly<Record<string, string>> } | null>;
}
/** Host-owned: the site's absolute URLs for this scope (null = site not configured for payments). */
export interface ProviderUrlsPort {
  resolve(required: { scope: PaymentScope }, optional?: Record<string, never>): Promise<{ webhookUrl: string; returnUrl: string; cancelUrl: string } | null>;
}
export function createProviderContexts(
  required: {
    configFor: (required: { siteId: string }) => ProviderConfigReaderPort;   // the SITE's store; never another site's
    pluginIdOf: Readonly<Record<string, string>>;                           // the same bindings object as the registry
    urls: ProviderUrlsPort; httpClient: HttpClientPort; now: () => number;
  },
  optional?: Record<string, never>
): ProviderContextPort;
```

  `resolve` fails with `NO_CREDENTIALS_CONFIGURED` when:
  - there is no binding for the provider;
  - nothing is saved for the plugin on this site;
  - `settings.accountId !== scope.providerAccountId` (a wrong-account config is never used);
  - any `${scope.mode}_${k}` slot is missing (a test key never satisfies live, or the reverse);
  - the URLs are unconfigured.

  `ctx.credentials` holds **only** the bare slot names, with only this mode's values.
- **Phase 1 constraint (stated in the README):** one provider account per (site, plugin), and one
  webhook endpoint per (site, provider account, mode). The endpoint's signing secret is that
  mode's `webhookSecret`. Several accounts per site, or several endpoints per scope, are Phase 2
  and need keyed config rows.
- **Isolation tests (P9):** missing slot; wrong account; wrong mode (live requested, only test
  saved); cross-site (site B's saved config never resolves for site A); unbound provider; URLs
  missing; the result carries no slot outside `credentialKeys`.

### 0.4 LiPay is test-only (D11, R15)

`createLipayFake` (`testkit/lipay-fake.ts`) gets a **fake-local guard**. Every method returns
`rejected INVALID_REQUEST "lipay fake is test-only"` when `ctx.account.mode === "live"`. It ships
only from `./payments/testkit`. Core gets no LiPay-specific branch.

### 0.5 Cross-vendor fit (R12, narrowed)

- **New core fields are vendor-neutral.** None is Stripe-only:
  - `ProviderContext.cancelUrl`: PayPal uses it. Lemon Squeezy, Paddle and Polar ignore it.
  - `IntentLine { description, quantity, unitAmount, providerPriceRef? }`: Lemon Squeezy variant,
    Paddle price, Polar product/price.
  - `capabilities.idempotencyWindowMs` (§2.1).
- **Exact charging is required, not "ignorable".**
  - A plugin may drop `description` or `quantity`, but it **must charge exactly `req.amount`**.
  - The kernel verifies `unitAmount × quantity === amount` before any row is written (P5).
  - Stripe additionally refuses a session whose `amount_total`/currency differs from the request
    and returns no redirect (P18).
  - Quarantine of mismatched evidence remains detection, not prevention.
- **Retries.** A same-key `createIntent` replay never re-dispatches (R8). Only the bounded
  recovery in P7 re-dispatches, only with the **original** key, and only for providers declaring
  a non-null `idempotencyWindowMs`. Vendors without request idempotency (Lemon Squeezy, Paddle,
  Polar → `null`) get operator-only recovery.
- **Unchanged and deferred** (D13): `PaymentEvidence.amount` still means authorized/charged money;
  capture and refund arithmetic depend on it (`plan-evidence.ts:295`).
  - Merchant-of-record tax and subtotal modelling (Lemon Squeezy, Paddle, Polar).
  - Subscription facts (#13). These are explicit later designs, with no Stripe fields in core.
- **Stripe-specific choices stay in the plugin:** Checkout Session id as `providerRef`,
  `metadata[jini_payment_id]`, Bearer auth with form encoding, and the currency allow-list.

### 0.6 No Stripe outside the plugin: an executable gate (R21)

- **Verified now:**
  - No `stripe` SDK import exists anywhere; `core-boundary.test.ts` already bans it outside the
    plugin distribution (`:19`, `VENDOR`).
  - No production file outside `payments-stripe/` holds a Stripe API destination. The only
    `api.stripe.com` literals live in the legacy plugin and its tests, which are deleted in P22.
  - Core has two hard-coded vendor badges in `react/Payments.tsx:56-57`, fixed in P16.
- **New gate (P24), extending `core-boundary.test.ts`:**
  1. TypeScript-AST scan of **production** sources (paths under `__tests__/` and `*.test.ts(x)`
     are excluded by an explicit, asserted rule) in every workspace package plus
     `provider-plugins/src/*`. It fails on any string or template literal containing
     `api.stripe.com` outside `src/payments-stripe/`.
  2. No plugin folder imports a sibling plugin folder (`src/<a>/**` → `../<b>/`).
  3. Fixture cases prove that each rule fires.

  This is a **test gate** run by `pnpm --prefix packages/provider-plugins test` and CI. The
  distribution build does not run it.

---

## 1. Scope

**In:**
- #12 checkout pays, with a verified order↔payment association.
- #4 our price → vendor price.
- #10 open-checkout client.
- #11 cancel URL.
- #31 explicit ignored outcome.
- #28 Stripe plugin (Checkout `mode=payment`, `retrieve`, signed webhooks, currency allow-list).
- Rejected-intent replay (R8).
- Bounded lost-response recovery (R9).
- The credential adapter (R3).
- The single attachment authority (R1/R2).
- LiPay test-only guard (D11).
- Core UI vendor-name fix.
- Coverage gates, NOTICE packaging and the boundary gate.

**Out:**
- Purchase effects (#3) and customer portal (#8, which also needs #9 customer identity): deferred.
- Subscriptions, entitlements and credits: #1, #2, #5–#7, #13–#16.
- Stripe refunds, disputes, manual capture and void. The plugin declares `refunds: "none"`,
  `disputes: false`, `capture: "auto"`, `void: false`.
- Order `failed`/`canceled` projection: there is no `payment.failed` topic; an abandoned order
  stays `pending`.
- The catalog's second inbox (D3, Phase 2).
- Tax, coupons and invoices: #17–#20.
- Several accounts or endpoints per site.

---

## 2. Contracts (exact TypeScript; `(required, optional = {})`; ports injected; complexity ≤ 10)

### 2.1 `payments/contract/provider.ts`

```ts
export interface ProviderCapabilities {
  // …existing…
  /**
   * How long the provider honours `IntentRequest.idempotencyKey` (same key + same request → same
   * result, no second object). `null` = no request idempotency: a lost createIntent response is
   * never re-dispatched automatically (operator-only, see reconcile-intent-dispatch).
   */
  readonly idempotencyWindowMs: number | null;
}
export interface ProviderContext { /* …existing… */ readonly cancelUrl: string; }

/** What is being bought. The kernel guarantees `unitAmount.minorUnits × quantity === amount.minorUnits`, same currency. */
export interface IntentLine {
  readonly description: string;          // display only; never personal data
  readonly quantity: number;             // safe integer ≥ 1
  readonly unitAmount: Money;            // the order item's snapshot
  readonly providerPriceRef?: string;    // (price, provider account, mode) mapping, #4
}
export interface IntentRequest { /* …existing… */ readonly line?: IntentLine; }
```

Doc additions on `verifyWebhook`: a verified event type the provider does not translate, or an
event about an object it did not create, is `ok([])`. It is never `rejected`, because a 4xx makes
the vendor redeliver forever. A supported event about **our** object that lacks evidence is an
id-only fact; it is not dropped (R6).

Doc addition on `WebhookFact.providerEventId` (`evidence.ts:238-248`): it must be **stable across
redeliveries**. A vendor without event ids derives one deterministically.

### 2.2 `payments/provider-module-guard.ts`

`CAPABILITY_CHECKS +=` `idempotencyWindowMs` is `null` or a positive safe integer.

### 2.3 `payments/contract/payments-port.ts`

```ts
createIntent(required: { scope; amount; idempotencyKey; reference },
  optional?: { captureMode?; partyId?; providerOptions?; line?: IntentLine }): Promise<IntentResult>;
```

`line` is validated in `checkIntent` (`ops/intent.ts:44-56`): a safe integer quantity ≥ 1, the
same currency as `amount`, and an exact product. Otherwise `INVALID_REQUEST`, with no row written.
`line` is persisted for recovery (§4) and is **not** part of the replay comparison; `reference`
already pins the order.

### 2.4 Rejected-intent replay (R8): `ops/intent.ts` `lookupIntent` (`:58-68`)

Today a same-key replay of a payment whose intent was `rejected` returns `ok: true, replayed`.
New behaviour: when the prior payment's intent attempt (`findAttemptByOperationKey`,
`ledger/repo.ts:96`, key `intent:<key>`) has outcome `rejected`, return
`rejectedReplay(attempt)` (`ops/common.ts:154-160`), the same stored-rejection mechanism that
refund, capture and void already use. That is `ok: false`, the original code, "replayed … key
spent", and `payment` attached. **No provider call happens on any replay.**

Consequences for `payOrder`:
- Retrying after a rejection returns that rejection again. It never creates a fresh session.
- The shopper starts a new `checkout()`, which creates a new order.

### 2.5 Bounded lost-response recovery (R9): `ops/reconcile-intent-dispatch.ts` (new)

```ts
export const MAX_INTENT_REDISPATCHES = 3;
/** One scan; called from reconcileUnknown (ops/reconciler.ts:146) alongside the existing scans. */
export async function reconcileIntentDispatch(
  required: { deps: OpsDeps; olderThanMs: number; limit: number; cursor: ScanCursor | null },
  optional?: Record<string, never>
): Promise<{ counts: ReconcileCounts; next: ScanCursor | null }>;
```

**Candidates:** open `intent` attempts (`listOpenAttempts({ ops: ["intent"] })`,
`ledger/repo.ts:196`) whose payment is `unknown` with `providerRef === null`.

For each candidate, the outcome is decided in this order:

| Condition | Outcome |
|---|---|
| Provider has `idempotencyWindowMs === null` | **leave** + `unknown-aged` alert (operator-only) |
| `now − attempt.createdAt ≥ window − olderThanMs` | **leave** + alert. The window is spent, so a re-dispatch could create a second object. |
| `redispatchCount ≥ MAX_INTENT_REDISPATCHES` | **leave** + alert |
| `requestJson === null` (rows from before 0005, or the request carried `providerOptions`, which are never persisted: they may hold personal data, `rows.ts:10`) | **leave** + alert |
| Otherwise | Tx: `redispatchCount + 1`. Then dispatch `provider.createIntent` with the **unchanged** request rebuilt from the payment row and `requestJson`, using the **original** `idempotencyKey = attempt.id` and `correlationId = payment.id`. Then the same Tx2 as a fresh intent (`markAttempt`, then `applyPaymentEvidence` or `recordIntentDispatchOutcome`). |

**Outcome mapping** for the re-dispatch:

| Re-dispatch result | Mapping |
|---|---|
| Stripe `409` "idempotency key in use" (concurrent) | `unknown`, retryable, left for the next pass |
| `400 idempotency_error` (parameters differ) | `rejected IDEMPOTENCY_CONFLICT`, recorded as **left + alert**, never `failed` |

Once recovered, the shopper's `payOrder` retry replays the payment, which now has `next`.

### 2.6 Webhook "ignored" (#31): `payments/ingest/receive.ts`

`WebhookResponse.body` success arm gains `readonly ignored: boolean`. `ok([])` →
`200 { received: 0, duplicates: 0, ignored: true }` before any ledger transaction. All other 200s
carry `ignored: false`.

### 2.7 Attachment and credentials

`payments/provider-contract.ts` (§0.2) and `payments/provider-contexts.ts` (§0.3) are both
exported from `./payments/kernel`. `plugin-contribution.ts` is deleted (P8).

### 2.8 Browser client (#10): `payments/contract/checkout-client.ts` + entry `./payments/client` (universal)

```ts
export type OpenCheckoutResult =
  | { readonly kind: "navigated"; readonly url: string }
  | { readonly kind: "client_action_handled" }
  | { readonly kind: "nothing_to_open"; readonly next: "none" | "out_of_band" | "pending" }   // "pending" = next === null
  | { readonly kind: "refused"; readonly reason: "unsafe_url" | "no_client_action_handler" };
export type ClientActionHandler = (required: { payload: Readonly<Record<string, unknown>> }, optional?: Record<string, never>) => Promise<void>;
export async function openCheckout(
  required: { next: NextAction | null; navigate: (required: { url: string }) => void },   // PaymentView.next is nullable (payments-port.ts:29)
  optional?: { clientAction?: ClientActionHandler }
): Promise<OpenCheckoutResult>;
```

URLs are followed only if they are `https:`, or `http:` on `localhost`/`127.0.0.1`. Anything
else is refused.

### 2.9 Catalog ports: `catalog/ports.ts`

```ts
export interface CommercePriceProviderRefRepoPort {
  find(required: { workspaceId: string; priceId: string; providerId: string; providerAccountId: string; mode: PaymentMode }, optional?: Record<string, never>): Promise<string | null>;
  save(record: CommercePriceProviderRefRecord, optional?: Record<string, never>): Promise<void>;   // upsert on the 5-part key
}
/** The durable order ↔ payment association (R4). Written by payOrder; the only thing the projector trusts. */
export interface CommerceOrderPaymentRecord {
  workspaceId: UUID; orderId: UUID; paymentId: string;
  siteId: string; providerId: string; providerAccountId: string; mode: PaymentMode;
  amount: Money; createdAt: ISODateTime;
}
export type SaveOrderPaymentResult = "saved" | "unchanged" | "conflict";   // conflict = same order, different payment or scope
export interface CommerceOrderPaymentRepoPort {
  save(record: CommerceOrderPaymentRecord, optional?: Record<string, never>): Promise<SaveOrderPaymentResult>;
  findByOrder(required: { workspaceId: string; orderId: string }, optional?: Record<string, never>): Promise<CommerceOrderPaymentRecord | null>;
  findByPayment(required: { workspaceId: string; mode: PaymentMode; paymentId: string }, optional?: Record<string, never>): Promise<CommerceOrderPaymentRecord | null>;
}
export type MarkOrderPaidResult = "paid" | "already_paid" | "not_pending" | "not_found";
// CommerceOrderRepoPort += markPaid(required: { workspaceId; orderId; at }): Promise<MarkOrderPaidResult>
//   one conditional UPDATE … WHERE status = 'pending' (version + 1), then a point read only to classify a 0-row result
```

### 2.10 `catalog/pay-order.ts` (#12, R13)

```ts
export interface PayOrderDeps { orders; prices; priceRefs; orderPayments: CommerceOrderPaymentRepoPort; payments: PaymentsPort; settle: SettleOrderPaymentDeps; }
export type PayOrderResult =
  | { readonly ok: true; readonly order: CommerceOrderRecord; readonly payment: PaymentView; readonly replayed: boolean }
  | { readonly ok: false; readonly order: CommerceOrderRecord; readonly error: PaymentError; readonly payment?: PaymentView };
export async function payOrder(required: { deps: PayOrderDeps; input: { workspaceId: UUID; orderId: UUID; scope: PaymentScope } }, optional?: Record<string, never>): Promise<PayOrderResult>;
```

`loadPayableOrder` (≤ 10 branches) throws **typed** errors before any money call:

| Condition | Error |
|---|---|
| Order missing | `CommerceOrderNotFoundError` |
| Order not `pending` | `CommerceCheckoutValidationError` |
| `scope.workspaceId`/`providerId` ≠ the order's | `CommerceCheckoutValidationError` |
| Item count ≠ **exactly 1** | `CommerceCheckoutValidationError` |
| Item price missing | `CommercePriceNotFoundError` |
| Recurring price (`billingInterval`) | `CommerceCheckoutValidationError` |
| `orderTotal([{ item.unitAmount, item.quantity }]) ≠ order.totalAmount` (the snapshot is preserved; the live price amount is never used) | `CommerceCheckoutValidationError` |
| Existing association with a different scope | `CommerceCheckoutValidationError` |

Then:
1. `payments.createIntent({ scope, amount: order.totalAmount, idempotencyKey: "order:<id>", reference: order.id }, { partyId: order.memberId, line })`.
2. If a `payment` is returned, call `orderPayments.save(...)`. A `conflict` throws
   `CommerceCheckoutValidationError`. Storage errors propagate, so the caller retries `payOrder`,
   which replays.
3. Call `settleOrderPayment({ paymentId })`. This covers providers that succeed synchronously, and
   the window in which the outbox message is processed before the association exists.

### 2.11 `catalog/settle-order-payment.ts` + `catalog/order-projection.ts` (R4, R13)

```ts
export interface SettleOrderPaymentDeps { orders; orderPayments; payments: PaymentsPort; alerts: PaymentsAlertPort; clock: ClockPort; }
export type SettleOutcome = "paid" | "already_paid" | "not_ours" | "not_succeeded" | "blocked";
export async function settleOrderPayment(required: { deps: SettleOrderPaymentDeps; input: { workspaceId: string; mode: PaymentMode; paymentId: string } }, optional?: Record<string, never>): Promise<SettleOutcome>;
export function createOrderPaymentProjector(required: { deps: SettleOrderPaymentDeps }, optional?: Record<string, never>):
  { handle(required: { message: PaymentsOutboxMessage }, optional?: Record<string, never>): Promise<SettleOutcome | "ignored"> };
```

`settleOrderPayment` steps, in order:
1. Look up the association by `(workspaceId, mode, paymentId)`. None → `not_ours`, no alert:
   payments made outside `payOrder`, such as agent tools, are not orders.
2. Read the order. Missing → **alert** + `blocked`.
3. Call `payments.getPayment({ scope: association scope, paymentId })`. The read is scope-fenced,
   so a different site, account, provider or mode returns `null` → **alert** + `blocked`.
4. `payment.status !== "succeeded"` → `not_succeeded` (no alert; it is early).
5. Run `settlementProblem`. It requires `payment.reference === order.id`, `payment.amount`,
   `payment.captured`, `order.totalAmount` and the association amount all equal in minor units and
   currency, `order.provider === association.providerId`, and the same workspace. Any mismatch →
   **alert** + `blocked`.
6. Call `orders.markPaid`. `not_pending` (money arrived on a canceled order) or `not_found` →
   **alert** + `blocked`.

**Acknowledgement policy:**
- Every outcome above **returns**, so the relay marks the message published. The alert is the
  escalation, delivered through the existing `PaymentsAlertPort` with a new kind
  `"fulfillment-blocked"`, which names the order and payment ids.
- Storage exceptions **propagate**: the relay stops its batch and redelivers
  (`outbox-relay.ts:69`, at least once). `markPaid` is idempotent, so this is safe.
- The projector acts only on `payment.succeeded`; every other topic returns `ignored`.

### 2.12 Stripe plugin (`packages/provider-plugins/src/payments-stripe/`)

```ts
// provider.ts — the port the factory returns; no options (R15: ctx.httpClient and ctx.now are the seams)
export const STRIPE_CAPABILITIES: ProviderCapabilities = { refunds: "none", capture: "auto", void: false, disputes: false,
  retrieve: "payment", echoesCorrelation: true, confirmation: ["redirect"], currencies: STRIPE_CURRENCIES, idempotencyWindowMs: 23 * 3_600_000 };
export function createStripePaymentProvider(required?: Record<string, never>, optional?: Record<string, never>): PaymentProvider;
// index.ts — setup(sdk) registers { contract: "payments", id: "stripe", contractVersion: 1, factory: () => ({ port: createStripePaymentProvider(), dispose: () => {} }) }

// amount.ts — exact, reversible, plugin-local (R7)
export const STRIPE_CURRENCIES: readonly string[];   // allow-list where ISO exponent == Stripe API exponent (USD EUR GBP CAD AUD NZD CHF SEK NOK DKK PLN CZK SGD HKD MXN BRL JPY KRW …); excludes ISK UGX HUF TWD and all 3-decimal codes
export function toStripeAmount(required: { money: Money }, optional?: Record<string, never>): { amount: number; currency: string } | null;   // null = not allowed
export function fromStripeAmount(required: { amount: unknown; currency: unknown }, optional?: Record<string, never>): Money | null;

// http.ts
export async function stripeRequest(required: { ctx: ProviderContext; method: "GET" | "POST"; path: string },
  optional?: { form?: ReadonlyArray<readonly [string, string]>; idempotencyKey?: string }): Promise<Outcome<Readonly<Record<string, unknown>>>>;
export function stripeOutcome(required: { status: number; json: unknown }, optional?: Record<string, never>): Outcome<Readonly<Record<string, unknown>>>;

// checkout-session.ts
export function checkoutSessionForm(required: { req: IntentRequest; ctx: ProviderContext }, optional?: Record<string, never>): Array<[string, string]> | null;
export type SessionReading = { kind: "evidence"; evidence: PaymentEvidence } | { kind: "id_only"; sessionId: string } | { kind: "foreign" };
export function readSession(required: { session: unknown; mode: PaymentMode }, optional?: { eventType?: string }): SessionReading;

// webhook.ts
export function verifyStripeSignature(required: { rawBody: Uint8Array; header: string | undefined; secret: string; nowMs: number }, optional?: Record<string, never>): boolean;
export type Translation = { kind: "facts"; facts: readonly WebhookFact[] } | { kind: "ignored" } | { kind: "malformed"; reason: string };
export function translateStripeEvent(required: { event: unknown; mode: PaymentMode }, optional?: Record<string, never>): Translation;
```

**HTTP outcome table** (`stripeOutcome`), as R7 and R9 require:

| Response | Outcome |
|---|---|
| 2xx with a JSON object | ok |
| 2xx unparseable | **unknown** |
| Transport throw, 5xx | **unknown**, retryable |
| 409 (`idempotency_key_in_use`) | **unknown**, retryable |
| 400 `idempotency_error` | rejected `IDEMPOTENCY_CONFLICT` |
| 402 / `card_error` | rejected `DECLINED` |
| 400 / 404 | rejected `INVALID_REQUEST` |
| 401 / 403 | rejected `NO_CREDENTIALS_CONFIGURED` |
| 429 | rejected, retryable (Stripe guarantees no side effect) |

**createIntent**
1. Map the amount with `toStripeAmount`; `null` → rejected `CURRENCY_UNSUPPORTED` with no HTTP.
2. Build the form:

   | Field | Value |
   |---|---|
   | `mode` | `payment` |
   | `success_url` | `ctx.returnUrl` |
   | `cancel_url` | `ctx.cancelUrl` |
   | `client_reference_id` | `correlationId` |
   | `metadata[jini_payment_id]` | `correlationId` |
   | `payment_intent_data[metadata][jini_payment_id]` | `correlationId` |
   | `line_items[0][price]` | `line.providerPriceRef`, when set |
   | `line_items[0][price_data]` | otherwise: `{ currency, unit_amount: toStripeAmount(line.unitAmount), product_data[name]: line.description }` |
   | `quantity` | `line.quantity` |

   **The order total is never sent as a unit price.** Without a `line`, the request becomes one
   unit of `req.amount`, named `Payment <correlationId>`; it never uses `IntentRequest.reference`,
   which does not exist (R14).
3. Send it with header `Idempotency-Key: req.idempotencyKey`.
4. Check the response: `id` and `url` must be strings, and
   `fromStripeAmount(amount_total, currency)` must **equal `req.amount`**. If not, the outcome is
   `unknown` for missing ids and `rejected INVALID_REQUEST` for an amount mismatch. No redirect is
   returned in either case, so nobody can pay that session.
5. Otherwise: evidence `{ providerRef: session.id, correlationId, status: "requires_action",
   amount }`, plus `next: { kind: "redirect", url }`.

**State mapping (`readSession`, R5):**

| Session state | Our status |
|---|---|
| `status: "open"` | `requires_action` |
| `status: "expired"` | `canceled` |
| `status: "complete"` + `payment_status: "paid"` | `succeeded` |
| `status: "complete"` + `payment_status: "unpaid"` (async method) | **`pending`**: completion is not payment |
| `status: "complete"` + `payment_status: "no_payment_required"` | `id_only` (never success from a zero charge; the worker retrieves; the kernel refuses zero amounts anyway) |
| Event `checkout.session.async_payment_failed` | `failed` (event type wins over the session's lingering `unpaid`) |
| Event `checkout.session.async_payment_succeeded` | `succeeded` only if `payment_status === "paid"`, else `pending` |

- Webhooks **never require an expanded PaymentIntent**. The session's own `payment_status` is
  authoritative.
- `retrieve` does `GET /v1/checkout/sessions/{id}?expand[]=payment_intent`. If `payment_intent`
  comes back expanded, `processing` keeps `pending`, and `requires_payment_method` or `canceled`
  under `complete+unpaid` → `failed`. If it is only an id string, the session status alone
  decides.

**Webhook classification (`verifyWebhook`, R6), in order:**

| Check | Result |
|---|---|
| Signature: header `t=…,v1=…`, `HMAC-SHA256(secret, "<t>." + exact raw bytes)`, hex. Every `v1` is compared with `timingSafeEqual` **only when lengths match** (a malformed-length digest is a non-match, never a throw). `abs(ctx.now()/1000 − t) ≤ 300`. | Failure → rejected `SIGNATURE_INVALID` |
| Body not JSON, or missing `id`/`type`/`created`(number)/`data.object` | rejected `INVALID_REQUEST` |
| `event.livemode !== (ctx.account.mode === "live")` | rejected `INVALID_REQUEST` |
| `type` not one of the four `checkout.session.*` types | `ok([])` (ignored) |
| `object !== "checkout.session"`, or no `metadata.jini_payment_id` | `ok([])` (foreign) |
| Ours but `mode !== "payment"` or no session `id` | rejected `INVALID_REQUEST` |
| Ours but evidence fields missing or unreadable | **id-only fact** `{ providerEventId, providerRef: session.id, occurredAt }`; the worker calls `retrieve` (`worker.ts:161-170`) |
| Otherwise | `[{ providerEventId: event.id, providerRef: session.id, occurredAt: created * 1000, evidence }]` |

---

## 3. Files (new / edited / deleted, with anchors)

| Area | File | Kind | Anchor |
|---|---|---|---|
| contract | `payments/contract/provider.ts` | edit | caps `:52-66`, ctx `:68-77`, req `:79-90`, verify doc `:130-134` |
| contract | `payments/contract/evidence.ts` | edit (doc) | `WebhookFact` `:238-248` |
| guard | `payments/provider-module-guard.ts` | edit | `CAPABILITY_CHECKS` `:27-36` |
| fixtures (cap/ctx) | `ingest/__tests__/harness.ts`, `ingest/__tests__/worker.vitest.test.ts`, `accounting/__tests__/{harness,apply-evidence.vitest,review-fixes.vitest}.ts`, `ops/__tests__/{harness,reconciler.vitest}.ts`, `testkit/__tests__/{provider-conformance,lipay-fake}.vitest.test.ts`, `__tests__/kernel/{provider-module-guard,plugin-contribution}.vitest.test.ts`, `testkit/lipay-fake.ts`, `tools/__tests__/read-tools.vitest.test.ts:50` | edit | every `capabilities` literal / ctx literal (`rg echoesCorrelation`, `rg webhookUrl`) |
| docs | `packages/core/docs/provider-registry.md` | edit | `:56` |
| replay | `payments/ops/intent.ts` | edit | `lookupIntent` `:58-68`, `checkIntent` `:44-56`, `openIntent` `:103-117`, `req` `:163-167` |
| port | `payments/contract/payments-port.ts` | edit | `PaymentsPort.createIntent` `:55-58` |
| ledger | `payments/ledger/migrations/0005_payments_intent_request.ts` | new | — |
| ledger | `ledger/migrations/{index,checksums}.ts`, `ledger/rows.ts` (`AttemptRecord` `:398-417` + row mapping), `ledger/repo.ts` (+`noteRedispatch`), `ledger/repo.sql.ts`, `ledger/repo.memory.ts`, `ledger/__tests__/{ledger-contract.ts,migrations.vitest.test.ts}` | edit | — |
| recovery | `payments/ops/reconcile-intent-dispatch.ts` | new | — |
| recovery | `payments/ops/reconciler.ts` | edit | `reconcileUnknown` `:146` (+ scan), counts/cursor types `:39-60` |
| receive | `payments/ingest/receive.ts` | edit | `:50-53`, `:118-143` |
| attach | `payments/provider-contract.ts` | new | — |
| attach | `payments/plugin-contribution.ts` + `__tests__/kernel/plugin-contribution.vitest.test.ts` | **delete** (−330) | — |
| attach | `payments/kernel.ts` | edit | exports `:17-19` |
| credentials | `payments/provider-contexts.ts` | new | — |
| alerts | `payments/contract/alerts.ts` | edit | `PaymentsAlertKind` `:8-16` (+`fulfillment-blocked`) |
| client | `payments/contract/checkout-client.ts`, `payments/client.ts` | new | — |
| client | `package.json` | edit | `jini.entries` + `exports` (`./payments/client`), `files` (+`NOTICE`), `test:coverage` thresholds |
| catalog | `catalog/database.ts` | edit | `CommerceDatabase` `:4-11` (+2 tables) |
| catalog | `catalog/ports.ts` | edit | `:30-54` (+2 ports, `markPaid`) |
| catalog | `catalog/repo.price-refs.ts`, `catalog/repo.order-payments.ts` | new | — |
| catalog | `catalog/repo.ts` | edit | order repo `:205-250` (+`markPaid`), factories |
| catalog | `catalog/pay-order.ts`, `catalog/settle-order-payment.ts`, `catalog/order-projection.ts` | new | — |
| catalog | `catalog/index.ts` `:1-7`; `catalog/checkout.ts` header `:92-112` (doc) | edit | — |
| fixtures (borrowed schema / ports) | `catalog/__tests__/unit/repo.vitest.test.ts:37-55` (DDL), `checkout.unit.test.ts:26`, `checkout-boundaries.vitest.test.ts` (fake order repo) | edit | — |
| UI | `react/Payments.tsx:56-57` + its test | edit | — |
| packaging | `NOTICE` (commerce root) | new | — |
| plugin | `provider-plugins/src/payments-stripe/{amount,http,checkout-session,webhook,provider}.ts` | new | — |
| plugin | `…/payments-stripe/{index.ts,jini.plugin.json,README.md}` | edit | `index.ts:1-23`, manifest `contributes.providers[0]` (+`settings`) |
| plugin | `…/payments-stripe/stripe.ts`, `src/__tests__/payments-stripe.test.ts`, `src/__tests__/payments-stripe-runtime-ports.test.ts` | **delete** (−484, D1) | — |
| plugin | `src/__tests__/artifact.integration.test.ts` | edit | `SPECS['payments-stripe']` `:43-44`, NOTICE assertion near `:75` |
| plugin | `src/__tests__/core-boundary.test.ts` | edit | `VENDOR` `:19` kept; new production-literal + sibling-import cases |
| plugin | `provider-plugins/package.json` (devDep `@jini-ai/commerce`, `files` + `NOTICE`, `test:coverage`), `provider-plugins/vitest.coverage.config.ts` (new), `provider-plugins/NOTICE` (new) | edit/new | — |

---

## 4. Data, ledger and migrations

**Payments ledger** (commerce-owned, ADR-066 checksummed steps): new frozen step
**`0005_payments_intent_request`**. It is pinned in `checksums.ts` and appended in
`migrations/index.ts:33-35`:

```sql
ALTER TABLE commerce_payment_attempts ADD COLUMN request_json TEXT NULL;          -- intent attempts only: {"captureMode","partyId"?,"line"?}; NULL when providerOptions were present (may hold personal data) or the op is not an intent
ALTER TABLE commerce_payment_attempts ADD COLUMN redispatch_count BIGINT NOT NULL DEFAULT 0;
```

`AttemptRecord` gains `requestJson: string | null` and `redispatchCount: number`. `LedgerTx` gains
`noteRedispatch({ id, at })`. Rows written before this step read as `null`/`0`, which is
operator-only recovery.

**Catalog tables are host-owned (D2).** The prerequisite is a **host migration in Tovu**, an
ADR-066 TS migration owned by the Tovu host. It must run before the host enables `payOrder`.
Commerce never creates catalog tables (`database.ts:3`). The DDL, documented in the README and
mirrored in the borrowed-schema fixture `repo.vitest.test.ts:37-55` **in the same shard** as each
`database.ts` change:

```sql
CREATE TABLE commerce_price_provider_refs (
  workspace_id TEXT NOT NULL, price_id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_account_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test','live')), provider_price_ref TEXT NOT NULL CHECK (length(provider_price_ref) > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, price_id, provider_id, provider_account_id, mode));

CREATE TABLE commerce_order_payments (
  workspace_id TEXT NOT NULL, order_id TEXT NOT NULL, payment_id TEXT NOT NULL,
  site_id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_account_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test','live')), amount_minor BIGINT NOT NULL, currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, order_id),
  UNIQUE (workspace_id, mode, payment_id));
```

`commerce_orders` and `commerce_products` are **unchanged**. Effects are cut, and `markPaid`
reuses `status`, `updated_at` and `version`.

---

## 5. Tests and coverage

**Rules for every shard:**
- The failing test is written first, and each behaviour's tests ship in the **same** shard.
- DI fakes only; no live keys or network.
- The dispatch prompt carries `honest-testing`'s banned moves.
- Each report gives the shard id, test counts **before/after**, the coverage JSON summary and the
  pushed SHAs.

**Coverage gate (R19):**
- **Commerce.** Every new Phase 1 test is a vitest file named `*.vitest.test.ts`, so
  `vitest.coverage.config.ts:10` already includes it. That config keeps `all: true`, an unchanged
  include/exclude, `json-summary`, and the full `src/**` denominator. P0 adds
  `coverage.thresholds` with **per-file 100/100/100/100 (lines, branches, functions, statements)**
  for every Phase 1 new or edited source file (an explicit glob list). Package totals are no lower
  than the P0 baseline. The existing `node:test` catalog suite (`src/catalog/__tests__/unit/*.test.ts`,
  run by `npm test`) stays as a regression suite and is edited only where port fakes must grow.
  Phase 1 coverage is never claimed from it.
- **Provider plugins.** P0 adds `vitest.coverage.config.ts`: include
  `src/payments-stripe/**/*.ts`, exclude `__tests__`, `json-summary`, thresholds 100 on all four
  metrics. It also adds the script `test:coverage`.
- **Baseline.** P0 records both packages' coverage and test counts at `32226f0e` in
  `ADS-memory/.local-artifacts/handoff/commerce-phase1-baseline.md`.

**Test plan per behaviour** (each lives in its shard, §6):

| Behaviour | Test file (runner: vitest) | Key cases |
|---|---|---|
| Capability/ctx contract | `__tests__/kernel/provider-module-guard.vitest.test.ts` | `idempotencyWindowMs` 0, negative, float, string refused; `null` and positive accepted |
| LiPay test-only | `testkit/__tests__/lipay-fake.vitest.test.ts` | every method → rejected in `live`; test mode unchanged |
| Ignored webhooks | `ingest/__tests__/receive.vitest.test.ts`, `http/__tests__/payments-webhook.vitest.test.ts` | `ok([])` → 200 `ignored:true`, zero transactions; others `ignored:false` |
| Rejected replay | `ops/__tests__/intent.vitest.test.ts` | rejected then same key → `ok:false`, original code, "replayed", no provider call; ok replay unchanged; unknown replay → `ok:true` with `next: null` |
| `line` | same | forwarded verbatim; absent not forwarded; product mismatch, currency mismatch, quantity 0 / non-integer / unsafe → `INVALID_REQUEST`, no row |
| Ledger 0005 | `ledger/__tests__/migrations.vitest.test.ts`, `ledger-contract.ts` (memory + SQL) | checksum pinned; old rows read null/0; `requestJson` round-trips; `noteRedispatch` increments once per call |
| Recovery | `ops/__tests__/reconcile-intent-dispatch.vitest.test.ts` | window null / spent / cap reached / no request → left + alert; re-dispatch uses the **original** key and identical request (asserted on the fake's received req); ok → settled with `next`; 409 → stays unknown; `IDEMPOTENCY_CONFLICT` → left + alert, never failed; counter increments before dispatch (a crash mid-dispatch still counts) |
| Attachment | `__tests__/kernel/provider-contract.vitest.test.ts` | validator accepts the LiPay fake, refuses a malformed port with the guard's message |
| Credentials | `__tests__/kernel/provider-contexts.vitest.test.ts` | §0.3 isolation list |
| Client | `contract/__tests__/checkout-client.vitest.test.ts` | `null` → pending; https / localhost http followed; `http://evil`, `javascript:`, `data:`, unparseable refused without `navigate`; `client_action` with and without handler; handler rejection propagates |
| Price refs | `catalog/__tests__/unit/repo.price-refs.vitest.test.ts` | hit; miss per key part (mode, account, provider, workspace); upsert |
| Association | `catalog/__tests__/unit/repo.order-payments.vitest.test.ts` | save, unchanged, conflict (other payment, other scope); find by order and by payment; mode-fenced |
| `markPaid` | `catalog/__tests__/unit/repo.mark-paid.vitest.test.ts` | four results; concurrent double call → exactly one `paid` |
| `payOrder` | `catalog/__tests__/unit/pay-order.vitest.test.ts` | every `loadPayableOrder` refusal; exact `createIntent` args; ref present and absent; association saved; conflict; replay; synchronous success settles; rejected passthrough |
| Settlement | `catalog/__tests__/unit/settle-order-payment.vitest.test.ts` | **one negative test per mismatch**: workspace, site, account, provider, mode (scope-fenced null), amount, currency, reference, captured, status; not ours; order missing; `not_pending` alert; storage throw propagates |
| Projector | `catalog/__tests__/unit/order-projection.vitest.test.ts` | non-success topics ignored; redelivery idempotent |
| UI | `react/__tests__/Payments.test.tsx` | renders the given summaries only; empty → "Setup required", no vendor names |
| Stripe amount | `provider-plugins/src/__tests__/payments-stripe-amount.test.ts` | USD 1099 ↔ 1099; JPY 500 ↔ 500; ISK, UGX, HUF, TWD, KWD → null; non-integer or negative Stripe amount → null; round-trip property over the allow-list |
| Stripe HTTP | `…/payments-stripe-http.test.ts` | every row of the outcome table; Bearer header; nested form keys; Idempotency-Key only when given |
| Stripe session | `…/payments-stripe-checkout.test.ts` | form with price ref vs `price_data`; **quantity 3 sends the unit amount, not the total**; no-line fallback name; unsupported currency → no HTTP; `amount_total` mismatch → rejected with no redirect; missing url → unknown; every `readSession` row |
| Stripe signature | `…/payments-stripe-signature.test.ts` | valid; tampered byte; whitespace-reserialized body fails (**exact bytes**); wrong secret; `t` at ±300 s passes and ±301 s fails (via `ctx.now`); several `v1` with one match; `v1` of wrong hex length / non-hex; missing or garbled header. Signatures are computed **in the test** with `node:crypto`, not the plugin's function. |
| Stripe translate | `…/payments-stripe-webhook.test.ts` | every classification row; livemode mismatch; id-only fact |
| Stripe provider | `…/payments-stripe-provider.test.ts` | commerce `providerConformanceCases` all pass; `retrieve` mapping incl. PI id-only vs expanded |
| Manifest | `…/payments-stripe-manifest.test.ts` | settings follow the §0.3 convention vs `credentialKeys`, all secrets `secret: true`; `contributes.providers[0]` = payments/stripe/v1 |
| **Stripe E2E** (R18) | `…/payments-stripe-kernel.test.ts` | Real Stripe provider + commerce kernel (memory ledger, receiver, worker, relay) + catalog fakes + `createProviderContexts` + registry with bindings + scripted fake `HttpClientPort` + **independently signed** webhook bytes. (a) checkout → `payOrder` → redirect; `completed+unpaid` → order stays `pending`; `async_payment_succeeded` → `paid` exactly once; redelivered webhook and redelivered outbox change nothing. (b) Reordered: success before `completed+unpaid` → never regresses. (c) A same-reference payment of a smaller amount, and a test-mode payment for a live association, never settle. (d) Create-session timeout → `unknown`, no URL → reconciler re-dispatches with the same `Idempotency-Key` → `payOrder` replay now returns the URL. (e) A second plugin claiming `stripe` is refused by bindings. |
| Packed artifact | `src/__tests__/artifact.integration.test.ts` (extend) | `payments-stripe` validated by commerce's `paymentsProviderContract.validate`; probe: `verifyWebhook` on a garbage body → rejected with no network; `licenses/@jini-ai_provider-plugins/NOTICE` present, integrity-pinned, containing "Open SaaS" and `c2c6285b` |
| Commerce pack | `src/__tests__/packaging.vitest.test.ts` | `npm pack --dry-run --json` includes `NOTICE` |
| Boundary | `core-boundary.test.ts` (extend) | §0.6 rules with fixtures that prove each fires |

---

## 6. Build shards

**Rules:**
- Lines are counted as **additions + deletions**, tests included, with a cap of about 150.
- Every behaviour ships with its tests in its shard.
- A file appears in more than one shard **only** in strict sequence (the "after" column).
- Every shard ends green: `pnpm guard`, `pnpm typecheck`, both packages' tests and coverage gates,
  then commit and push.

| # | Shard | Files | +/− (est.) | After |
|---|---|---|---|---|
| P0 | Coverage gates + baseline | commerce `vitest.coverage.config.ts` (thresholds), provider-plugins `vitest.coverage.config.ts` (new), provider-plugins `package.json` (script) | +40 | — |
| P1 | Contract fields + guard + **every** fixture ripple | `provider.ts`, `evidence.ts` (doc), `provider-module-guard.ts`, `lipay-fake.ts`, the 13 fixture files in §3, `core/docs/provider-registry.md`, guard test | +70 / −20 | P0 |
| P2 | LiPay test-only guard | `lipay-fake.ts`, `lipay-fake.vitest.test.ts` | +35 / −3 | P1 |
| P3 | Ignored webhooks (#31) | `receive.ts`, `receive.vitest.test.ts`, `payments-webhook.vitest.test.ts` | +30 / −6 | P1 |
| P4 | Rejected-intent replay | `ops/intent.ts`, `ops/__tests__/intent.vitest.test.ts` | +45 / −4 | P1 |
| P5 | `line` validation + forwarding | `payments-port.ts`, `ops/intent.ts`, `intent.vitest.test.ts` | +70 / −4 | P4 |
| P6 | Ledger 0005 | `migrations/0005_…` (new), `migrations/{index,checksums}.ts`, `rows.ts`, `repo.ts`, `repo.sql.ts`, `repo.memory.ts`, `ledger-contract.ts`, `migrations.vitest.test.ts` | +140 / −6 | P1 |
| P7a | Intent writes `request_json` | `ops/intent.ts`, `intent.vitest.test.ts` | +35 / −3 | P5, P6 |
| P7b | Bounded re-dispatch | `ops/reconcile-intent-dispatch.ts` (new), `ops/reconciler.ts`, `ops/__tests__/reconcile-intent-dispatch.vitest.test.ts` (new) | +150 / −6 | P7a |
| P8a | Contract validator | `payments/provider-contract.ts` (new), `kernel.ts`, its test | +45 | P1 |
| **P8b** | Remove second attachment authority | delete `plugin-contribution.ts` + its test; `kernel.ts` export line | +0 / **−331** | P8a; **cap exception, pure deletion, Coordinator sign-off + owner OK (O1)** |
| P9 | Credential adapter | `payments/provider-contexts.ts` (new), `kernel.ts`, `__tests__/kernel/provider-contexts.vitest.test.ts` | +150 | P8b |
| P10 | Price refs (#4) | `catalog/database.ts`, `catalog/ports.ts`, `catalog/repo.price-refs.ts` (new), `repo.vitest.test.ts` (DDL), `repo.price-refs.vitest.test.ts` | +120 / −2 | P1 |
| P11 | Order↔payment association | `catalog/database.ts`, `catalog/ports.ts`, `catalog/repo.order-payments.ts` (new), `repo.vitest.test.ts` (DDL), `repo.order-payments.vitest.test.ts` | +145 / −2 | P10 |
| P12 | `markPaid` | `catalog/ports.ts`, `catalog/repo.ts`, `checkout.unit.test.ts`, `checkout-boundaries.vitest.test.ts`, `repo.mark-paid.vitest.test.ts` (new) | +110 / −2 | P11 |
| P13 | Settlement + projector | `payments/contract/alerts.ts`, `catalog/settle-order-payment.ts` (new), `catalog/order-projection.ts` (new), their 2 tests | +150 / −1 | P12 |
| P14 | `payOrder` | `catalog/pay-order.ts` (new), `catalog/index.ts`, `catalog/checkout.ts` (doc), `pay-order.vitest.test.ts` | +150 / −6 | P5, P13 |
| P15 | Browser client (#10) | `checkout-client.ts`, `client.ts` (new), `package.json` (entry), its test | +125 / −1 | P0 |
| P16 | Core UI vendor leak | `react/Payments.tsx`, its test | +35 / −6 | P1 |
| P17 | Stripe amount + HTTP | `payments-stripe/{amount,http}.ts` (new), 2 tests, provider-plugins `package.json` (devDep) | +150 | P1 |
| P18 | Stripe session create + read | `checkout-session.ts` (new), its test | +150 | P17 |
| P19 | Stripe signature | `webhook.ts` (new: `verifyStripeSignature`), signature test | +100 | P17 |
| P20 | Stripe translation | `webhook.ts`, translate test | +140 | P18, P19 |
| P21 | Stripe provider assembly | `provider.ts` (new), provider test (conformance) | +110 | P20 |
| **P22** | Switch artifact to commerce contract + delete legacy (D1) | `index.ts`, `jini.plugin.json`, `README.md`, `artifact.integration.test.ts`, manifest test (new); delete `stripe.ts` + 2 legacy tests | +95 / **−505** | P21; **cap exception: −484 are D1-approved deletions; Coordinator sign-off** |
| P23 | NOTICE packaging (R20) | `provider-plugins/NOTICE`, `provider-plugins/package.json` (`files`), `commerce/NOTICE`, commerce `package.json` (`files`), `artifact.integration.test.ts`, `packaging.vitest.test.ts` (new) | +80 | P15, P22 |
| P24 | Boundary gate (R21) | `core-boundary.test.ts` | +90 / −2 | P22 |
| P25a | E2E: happy / unpaid / reorder / redelivery / bindings | `payments-stripe-kernel.test.ts` (new) | +150 | P9, P14, P22 |
| P25b | E2E: mismatch + lost-response recovery | same file | +130 | P25a, P7b |
| P26 | Docs | commerce `README.md` (host DDL prerequisite, composition recipe §0.2/§0.3, Phase 1 constraints), `source-map.md`, `CHANGELOG.md`, gap-report status column | docs | all |

**Parallel lanes once P1 is green** (no shared files): {P2}, {P3}, {P4→P5→P7a}, {P6}, {P8a},
{P10→P11→P12→P13}, {P15}, {P16}, {P17→…}. `ops/intent.ts`, `catalog/ports.ts`,
`catalog/database.ts`, `repo.vitest.test.ts`, `kernel.ts`, `webhook.ts`,
`artifact.integration.test.ts` and both `package.json` files are serialised by the "after"
column. P8b and P22 exceed the cap **only through deletions**. They go to the Coordinator before
dispatch, as R17 asks, and are not split into a broken intermediate state.

---

## 7. OpenSaaS adaptation and attribution (R20)

**Reference:** `wasp-lang/open-saas` at commit **`c2c6285bdb14b040584505372ad9bb062a0bca11`**,
MIT, © 2023 wasp-lang. Paths are under `template/app/src/payment/`.

| OpenSaaS | Adapted as | Notable differences |
|---|---|---|
| `paymentProcessorPlans.ts:9-42` | `CommercePriceProviderRefRepoPort` | DB rows keyed by account **and mode**, not env vars |
| `stripe/checkoutUtils.ts:34-71` | `checkoutSessionForm` | Raw REST via `ctx.httpClient`; exact unit amount and currency allow-list. **Omitted:** `customer` / `customer_update` (customer-dependent, #9), `automatic_tax`, `allow_promotion_codes`, `invoice_creation`. |
| `stripe/webhook.ts:106`, `:266` (fulfil on `invoice.paid` with `paid_at`) | `readSession` + settlement | **Changed fulfilment trigger:** Checkout Session `payment_status === "paid"` (completion alone is not payment), through the single writer → outbox → association-verified projector, never a direct user-row write |
| `stripe/webhook.ts:45-57`, `errors.ts` | `ok([])` → `200 ignored:true` | No exception-as-control-flow; malformed supported events are not swallowed |
| `redirectToCheckout.ts`, `paymentProcessorClient.ts` | `openCheckout` | Injected `navigate`, scheme allow-list, nullable `next` |
| `paths.ts:19` | `returnUrl` / `cancelUrl` | Portal-return destination deferred with the portal |

**Never copied:**
- The user-row billing model (`user.ts`).
- `processedWebhookEvent.ts`.
- The vendor-sum revenue.
- Inline billing emails.
- Email-based customer lookup.

**Packaging:**
- `NOTICE` files carry the full MIT text and the commit: one at the `provider-plugins` package
  root, and one at the `commerce` package root for `checkout-client.ts` and the price-map design.
- `scripts/build.ts:49-73` (`retainLicenses`) copies an owning package root's `notice*` files
  into every artifact's `licenses/<package>/`, under integrity hashing.
- Both packages' `files` lists gain `NOTICE`. Commerce's currently omits it (`package.json:76`).
- Packed contents are tested in P23.

---

## 8. Open items for the owner

| # | Item | Recommendation |
|---|---|---|
| O1 | Delete commerce's unused agent-plugins contribution spec (`payments/plugin-contribution.ts` + test, −331), so the plugin-host artifact path is the **one** attachment authority | Yes. No consumer exists (`rg`); keeping it is a second lifecycle (R2). |
| O2 | Phase 1 constraint: one provider account per (site, plugin), one webhook endpoint per (site, account, mode) | Accept for Phase 1 |
| O3 | Stripe currency allow-list (§2.12): which currencies the business needs beyond the listed set | Start with the list; extend only with tested exponent pairs |
| O4 | `idempotencyWindowMs` for Stripe: 23 h (Stripe keys live at least 24 h; 1 h safety margin) | Accept |

---

## Review responses (`REVIEW-codex-phase1.md`, all 21 items)

| R | Verdict | Response |
|---|---|---|
| 1 | **Accept** | Confirmed: the build emits `server/index.mjs` (`build.ts:97`), the loader requires `definition.setup` (`loader.ts:184-205`), and `contractVersion` must be 1 (`provider-contributions.ts:23-32`). The plan now extends the existing artifact registration/factory: the same `sdk.providers.register({ contract: "payments", id: "stripe", contractVersion: 1 })`, whose port now implements `PaymentProvider`, validated by a commerce-supplied contract validator (§0.2). There is no `./provider.js` and no version 2. |
| 2 | **Accept** | One authority: `@jini-ai/plugins/host` provider artifacts. Install → load → setup capture → validate → initialize → commerce registry (with bindings) → detach are tabulated in §0.2. The unused agent-plugins contribution spec is removed (P8b, O1), so no parallel lifecycle remains. |
| 3 | **Accept** | Real adapter `createProviderContexts` over the existing `ProviderConfigSource` shape. It uses a site-scoped reader, an `accountId` match and `test_*`/`live_*` slots, and has missing-slot, wrong-account, wrong-mode and cross-site tests. The webhook-secret-per-endpoint constraint is explicit, and bindings `{ stripe: "payments-stripe" }` are passed and tested (§0.3, P9, P25a). |
| 4 | **Accept** (D8 withdrawn) | Durable `commerce_order_payments` association. The projector trusts only it, reads the payment **scope-fenced** from the association's scope, and verifies reference, amount, captured, currency, status, provider and workspace before `markPaid`. One negative test per mismatch (§2.9, §2.11). |
| 5 | **Accept** | Full `readSession` mapping: `complete+unpaid` → `pending`, `paid` → `succeeded`, async success and failure handled explicitly, and expanded vs id-only PaymentIntent defined. Webhooks never need an expanded PaymentIntent (§2.12). The OpenSaaS "paid" guard survives as the `payment_status` check. |
| 6 | **Accept** | `Translation = facts | ignored | malformed`, plus `SessionReading = evidence | id_only | foreign`. Ours-but-incomplete becomes an id-only fact for worker retrieval. Malformed supported events are rejected. `livemode`, `mode=payment`, `created`, `id` and `type` are validated before facts are produced (§2.12). |
| 7 | **Accept** | `IntentLine.unitAmount` carries the snapshot. The kernel verifies `unit × quantity = amount` (P5). Stripe sends the unit amount and checks `amount_total`. `currencies` becomes an allow-list; ISK, UGX, HUF, TWD and 3-decimal currencies are refused. USD, JPY, quantity > 1, overflow and refused-currency tests are included (§2.12, P17–P18). |
| 8 | **Accept** | Replay of a rejected intent now returns the stored rejection via the existing `rejectedReplay` (`common.ts:154-160`). The plan no longer claims that a retry creates a fresh session (§2.4, P4). |
| 9 | **Accept** | Bounded recovery with the **original** key and the persisted unchanged request. It is gated by provider `idempotencyWindowMs`, capped at 3, and operator-only otherwise. It distinguishes 409 in-use (`unknown`) from 400 parameter conflict (left + alert). This needs ledger step 0005 (§2.5, §4, P6–P7b, P25b). |
| 10 | **Accept** (owner cut) | Purchase effects removed. No `effect_json`, no `effect.ts`. Deferred to the credit-ledger phase, with purchase-time snapshots and reconciliation against `grantsMemberTierId`. |
| 11 | **Accept** (owner cut) | Customer portal removed (capability, port method, op). Deferred with #9 customer identity and host-authorized ownership; separate portal-return URL noted. |
| 12 | **Accept** | §0.5 rewritten. "Ignorable" quantity is replaced by "must charge exactly `req.amount`", the "kernel retry" claim is corrected, and D13 is withdrawn (owner: not now). `PaymentEvidence.amount` keeps its meaning. |
| 13 | **Accept** | `payOrder` requires exactly one item and preserves the snapshot, with typed outcomes for missing price and malformed item. The projector's acknowledgement policy is defined: business outcomes acknowledge with a `fulfillment-blocked` alert, storage failures propagate for redelivery. Existing alert and relay mechanisms are reused (§2.10–2.11). |
| 14 | **Accept** | `providerSummary` → `ops/view.ts:40` (no longer touched; portal cut). The fallback name uses the correlation id, not `reference`. `openCheckout` takes `NextAction | null`. `toProductRecord` is no longer touched (effects cut). Provider types are imported from `@jini-ai/commerce/payments/kernel`. Complexity ≤ 10 is stated in §2. |
| 15 | **Accept** | `apiBase` and `toleranceSeconds` are dropped: `ctx.httpClient` and `ctx.now` are the seams, and 300 s is a constant. The LiPay restriction is a fake-local guard with tests (P2); core gets no LiPay policy. |
| 16 | **Accept** | Host prerequisite named: a Tovu ADR-066 TS migration (D2). Borrowed-schema DDL fixture `repo.vitest.test.ts:37-55` is updated in the same shard as each `database.ts` change. Port-fake ripples (`checkout.unit.test.ts:26`, `checkout-boundaries`) and capability-fixture ripples (13 files) are inside the shards that cause them (P1, P10–P12). |
| 17 | **Accept** | Schedule rebuilt (§6). It counts additions and deletions, keeps tests with their behaviour, serialises shared files, puts the LiPay changes in P1 → P2 sequence, and routes the two deletion-only cap exceptions (P8b, P22) to the Coordinator. |
| 18 | **Accept** | The Stripe E2E uses the real adapter, the kernel and independently signed bytes, covering unpaid-then-paid, exactly-once, reorder, mismatch, scope and mode, lost response and bindings (P25a/b). Signature tests cover wrong-length digests and exact bytes. The packed-artifact test is extended, not replaced (P23). |
| 19 | **Accept** | Both runners are addressed. Phase 1 tests are vitest only and covered by the existing all-files config, with per-file 100% thresholds. `node:test` stays a regression suite. Provider-plugins gets its own coverage config. JSON summaries are produced, and baseline and final counts are recorded (§5, P0). |
| 20 | **Accept** | `NOTICE` at both package roots, carried by `retainLicenses` into artifacts. Both `files` lists are updated, packed contents are tested, the reference commit is pinned, and the changed fulfilment trigger and the `customer_update` omission are recorded (§7, P23). |
| 21 | **Accept** | The boundary gate is an AST scan of production literals and imports, with explicit test-file handling. Sibling-plugin imports are banned, fixtures prove each rule fires, and the existing SDK scanner is preserved. It is described as a test gate, not a build step (§0.6, P24). |
