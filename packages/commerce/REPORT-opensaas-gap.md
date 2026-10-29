# `@jini-ai/commerce` vs OpenSaaS — capability gap report

Report only, no code changed. Compared on 2026-10-29: `packages/commerce` at `774d6856` (branch
`cloud/commerce-1028-work`), and `wasp-lang/open-saas` `main` (shallow clone, `template/app/`).
Only code and docs were read; neither app was installed or run.

OpenSaaS paths are relative to `open-saas/template/app/`. Our paths are relative to
`packages/commerce/`.

**How to read the comparison.** OpenSaaS is a single-tenant SaaS starter. Its billing is about
350 lines of shared code plus about 500–700 lines per vendor. All billing state sits on the `User`
row, and you choose one vendor by editing a constant. Our package is a vendor-neutral,
multi-tenant payments kernel: an append-only evidence ledger, three-way outcomes, reconciliation,
an inbox/outbox and grant-gated money tools. It is much deeper on payment correctness. But it has
**no SaaS billing layer**: no subscriptions, plans, entitlements, credits, customer portal,
revenue numbers or billing emails. It also ships **no real provider adapter**; only the LiPay
fake exists. Gaps are judged by capability, not by which SDK is missing.

Sizes: **S** ≈ under a day / <300 lines, **M** ≈ 1–3 days / a new module and contract, **L** ≈
a new subsystem with schema, ledger semantics and conformance tests.

## Summary table

| # | Capability | OpenSaaS | Ours | Gap | Core or plugin |
|---|---|---|---|---|---|
| 1 | Subscription lifecycle record (status: active / past_due / cancel_at_period_end / deleted) | `src/payment/plans.ts:1`, `src/payment/user.ts:40`, `schema.prisma` `User.subscriptionStatus` | None. `catalog/contracts.ts:59` hard-codes `subscriptions: "unavailable"` | **L** | Core (state model + ledger); vendor status mapping in plugin |
| 2 | Recurring price → hosted subscription checkout | `src/payment/stripe/paymentProcessor.ts:24`, `stripe/checkoutUtils.ts:34` (`mode: "subscription"`) | Partial: `CommercePriceRecord.billingInterval` exists (`catalog/types.ts:65,79`), but nothing sells a recurring price; `PaymentProvider` has no recurring method (`payments/contract/provider.ts:100`) | **M** | Core contract (`createSubscription`/checkout-session op) + plugin implementation |
| 3 | Plan catalog with typed "effect" (subscription vs N credits) | `src/payment/plans.ts:18-41` | Partial: products/prices with `kind` (`catalog/types.ts:15`) and `grantsMemberTierId` (`:41`); no effect union, no credit effect | **S** | Core |
| 4 | Our plan id ↔ vendor price/variant id mapping | `src/payment/paymentProcessorPlans.ts:9-42` | None (no provider-side price ref on `CommercePriceRecord`) | **S** | Core (mapping table/port); values supplied by host/plugin |
| 5 | Entitlement projection from billing events (paid ⇒ plan active) | `stripe/webhook.ts:106-139`, `user.ts:47` | Partial: the outbox emits `payment.succeeded` etc. (`payments/ledger/rows.ts:356`), and `grantsMemberTierId` names a target, but no consumer grants or revokes anything | **M** | Core (entitlement service subscribing to the outbox) |
| 6 | Credits / prepaid usage balance (purchase, reserve, debit, refund-on-failure) | `user.ts:65-91` (increment), `demo-ai-app/operations.ts:42-101` (atomic reserve + refund) | None | **M** | Core (a credit ledger, not a counter column; see details) |
| 7 | Feature gating helper ("is subscribed or has credits") | `demo-ai-app/operations.ts:98`, `PricingPage.tsx:65` | None | **S** (after 1/5/6) | Core |
| 8 | Customer portal link (self-serve manage/cancel/update card) | `src/payment/operations.ts:58`, `stripe/paymentProcessor.ts:57-76`, `polar/paymentProcessor.ts:47`, `paddle/paymentProcessor.ts:43`, `lemonSqueezy/paymentProcessor.ts:35` (stored URL) | None | **S** | Core: optional `customerPortal?` capability on `PaymentProvider`; plugin implements |
| 9 | Provider customer identity (get-or-create vendor customer, map user ↔ customer) | `stripe/checkoutUtils.ts:10-24`, `user.ts:5-38`, `User.paymentProcessorUserId` | Partial: `CommerceOrderRecord.providerCustomerRef` (`catalog/types.ts:96`) and opaque `partyId` (`payments/contract/provider.ts:87`); no customer record, no ensure-customer op | **M** | Core (party↔provider-customer map) + plugin (`ensureCustomer`) |
| 10 | Hosted-redirect vs in-page (overlay) checkout session | `src/payment/paymentProcessor.ts:25-27`, `paddle/paymentProcessorClient.ts:9-28` | **Has it at intent level**: `NextAction` `redirect` / `client_action` (`payments/contract/evidence.ts:30-34`). No browser-side "open checkout" client contract | **S** | Core contract; client SDK glue in plugin |
| 11 | Checkout success / cancel return pages + URLs | `src/payment/CheckoutResultPage.tsx:15-39`, `paths.ts` | Partial: `ProviderContext.returnUrl` (`payments/contract/provider.ts:76`); no cancel URL, no result UI | **S** | Core (cancel URL in context); UI in host/react |
| 12 | Order → payment wiring (checkout actually charges) | `operations.ts:23-56` (one call creates the vendor session) | Partial: `catalog/checkout.ts:14-33` creates a `pending` order and explicitly does not call payments; `PaymentsPort.createIntent` exists (`payments/contract/payments-port.ts:143`), but nothing connects them (no import of `createIntent` under `src/catalog`) | **M** | Core |
| 13 | Webhook events → subscription / credit state handlers | `stripe/webhook.ts:84-104` (invoice.paid, subscription.updated/deleted); `polar/webhook.ts:98`; `paddle/webhook.ts:99`; `lemonSqueezy/webhook.ts:32-60` | Partial: verified inbox → payment/refund/dispute evidence (`payments/ingest/receive.ts`, `worker.ts`); `WebhookFact` carries only payment evidence (`evidence.ts:83-88`), with no subscription or invoice fact | **M** | Core (new fact kinds); plugin translates vendor events |
| 14 | Cancel-at-period-end / win-back hook | `stripe/webhook.ts:160-191` (emails on `cancel_at_period_end`) | None | **S** (after 1) | Core emits an outbox topic; email in host |
| 15 | Trials | Mapped only (`stripe/webhook.ts:197` maps `trialing` → active; Paddle `paddle/webhook.ts:207`) | None | **S** (as a status) / **M** (as owned logic) | Core status; trial logic in plugin/provider |
| 16 | Dunning / past-due handling | Status only: `past_due` (`plans.ts:2`, `stripe/webhook.ts:199`); retries are left to the vendor | None | **S** for parity (status + topic); **L** for owned retry schedules | Core status; retry schedule normally provider-side |
| 17 | Plan change / proration | Not implemented (portal handles it; `subscription.updated` re-reads the price, `stripe/webhook.ts:166-172`) | None; proration is explicitly out of scope (`catalog/checkout.ts:32-33`, `catalog/types.ts:10-12`) | **M** (delegated) / **L** (owned) | Plugin (delegate to provider portal); core only records the plan change |
| 18 | Promotion codes / coupons | Delegated: `allow_promotion_codes: true` (`stripe/checkoutUtils.ts:48`) | None; discounts excluded (`catalog/checkout.ts:32`) | **S** (pass-through flag) / **L** (owned discounts) | Plugin pass-through via `providerOptions`; owned discounts would be core |
| 19 | Tax collection | Delegated: `automatic_tax: { enabled: true }` (`stripe/checkoutUtils.ts:47`), billing address capture (`:49`) | None; tax excluded (`catalog/checkout.ts:32`) | **S** (delegated) / **L** (owned) | Plugin (merchant-of-record / provider tax); core records tax amount as evidence |
| 20 | Invoices / receipts | Delegated: `invoice_creation` for one-time payments (`stripe/checkoutUtils.ts:57-70`); `invoice.paid` drives state | None | **M** | Core (invoice ref + `invoice.paid` fact); document generation in plugin |
| 21 | Revenue metric | `stripe/paymentProcessor.ts:79-108` (`fetchTotalRevenue` sums vendor balance transactions); `analytics/stats.ts:51` | Partial and better-founded: ledger has `fee_minor` / `net_minor` / `settlement_minor` (`payments/ledger/rows.ts:175-180`, `evidence.ts:53-59`), but no projection; `contracts.ts:61` says `revenue: "unavailable"`; React panel refuses to show numbers (`react/Payments.tsx:115-124`) | **M** | Core (projection from our ledger, not the vendor API) |
| 22 | Daily billing stats job (users, paying users, deltas, revenue snapshot) | `analytics/stats.ts:17-90`, `schema.prisma` `DailyStats` | None | **M** | Core projection; scheduling in host; page-view parts out of scope |
| 23 | Admin analytics dashboard (revenue/profit chart, paying users, signups) | `admin/dashboards/analytics/*.tsx` (`TotalRevenueCard`, `RevenueAndProfitChart`, `TotalPayingUsersCard`) | Static placeholder only: `react/Payments.tsx:8-10` ("ports that information architecture only") | **M** | Core React (`/react`) reading the projection in #21 |
| 24 | Admin customer list filtered by subscription status | `admin/dashboards/users/UsersTable.tsx:45-72`, `user/operations.ts` | None (read tools cover one payment and providers only: `payments/tools/catalog.ts:17-22`) | **M** | Core read tool + React; user/admin parts belong to auth, not commerce |
| 25 | Account page "your plan / manage billing" | `user/AccountPage.tsx:61-65`, `PricingPage.tsx:108-125` | None | **S** (after 1/8) | Core React component |
| 26 | Pricing page (plan cards, best-deal badge, buy button, portal button) | `src/payment/PricingPage.tsx:28-125` | None (a storefront mapping exists for products: `catalog/storefront.ts`) | **S** | Host / theme; core supplies the data shape |
| 27 | Billing emails (cancellation, receipts) | `stripe/webhook.ts:184-189` via `server/emailSender.wasp.ts` | None. Our outbox (`payments/ingest/outbox-relay.ts:1-12`) is the right hook, but nothing listens | **S** | Host (email is not commerce); core only emits topics |
| 28 | Vendor adapters: Stripe, Lemon Squeezy, Polar, Paddle | `src/payment/{stripe,lemonSqueezy,polar,paddle}/` (~500–700 lines each) | None real. Only the deterministic LiPay fake (`payments/testkit/lipay-fake.ts`) and the LiPay signer (`payments/providers/lipay-gateway.ts:1-12`); the old gateway was removed | **M each** | Plugin (never core) |
| 29 | Webhook raw-body middleware per vendor | `stripe/webhook.ts:17-27` | **Has it**, vendor-neutral: `http/payments-webhook.ts` | — | — |
| 30 | Webhook idempotency (process event once) | `src/payment/processedWebhookEvent.ts:20-70` (insert first, delete on failure) | **Has it, stronger**: inbox insert-or-ignore per account+mode, retries, dead letter, revive on redelivery (`payments/ingest/receive.ts:11-16`, `worker.ts:1-20`); a second order-level inbox with out-of-order guard (`catalog/ports.ts:56-80`) | — | — |
| 31 | Unhandled-event policy (2xx so the vendor stops retrying) | `stripe/webhook.ts:45-57`, `errors.ts` | Implicit: provider translates only what it knows; receive answers fast after recording (`receive.ts:11-14`). No explicit "unhandled type" result | **S** | Core (document + `ignored` outcome) |
| 32 | File uploads (S3 presigned) | `src/file-upload/*` | Out of scope for commerce | n/a | Not commerce (media/storage package) |
| 33 | Auth-linked billing (only signed-in users with an email can pay) | `src/payment/operations.ts:29-45` | By design we keep identity out of money paths: `partyId` only (`provider.ts:86`). The caller-side check is the host's job | **S** (document the host contract) | Host |

## Details

### 1. Subscriptions (the largest gap)

**OpenSaaS.** It has a four-value `SubscriptionStatus` (`plans.ts:1-6`) and a plan id stored on
`User` (`subscriptionPlan`, `datePaid`). Webhooks write them directly (`user.ts:40-63`). Each
vendor maps its own statuses down to these four (`stripe/webhook.ts:193-221`,
`paddle/webhook.ts:206-212`). There is no history, period tracking or proration: the user row
holds the latest status and nothing else.

**Ours.** There is no subscription concept at all. Prices can carry `billingInterval`
(`catalog/types.ts:65,78-79`), and the status read model is honest that subscriptions are absent
(`catalog/contracts.ts:59`, `catalog/status.ts:63`). `ProviderCapabilities`
(`payments/contract/provider.ts:52-66`) has no `recurring` flag. Only the older catalog-side
contract does (`catalog/contracts.ts:157`).

**To add (L, core).** Build the same way the payments kernel is built:

- A `SubscriptionRecord` scoped like `PaymentScope`.
- Append-only subscription evidence with derived status (`active | trialing | past_due |
  cancel_at_period_end | canceled | paused | incomplete`).
- Period start/end and the current price.
- A forward-merge table so out-of-order webhooks cannot regress a subscription, in the style of
  `payments/state/status.ts`.
- Outbox topics such as `subscription.activated`, `.canceled`, `.past_due` and `.renewed`.

Each renewal invoice should create a normal payment row, so revenue, refunds and disputes reuse
the existing ledger. Vendor status mapping belongs in the provider plugin. Subscription facts also
need a new `WebhookFact` variant (#13). Today `WebhookFact.evidence` can only be a
`PaymentEvidence`.

### 2. Recurring checkout

**OpenSaaS.** It derives the checkout mode from the plan effect
(`stripe/paymentProcessor.ts:111-119`). The vendor then hosts the subscription.

**Ours.** `createIntent` is one-off money only.

**To add (M).** Add an optional `createSubscription?` / `createCheckoutSession?` to
`PaymentProvider`, gated by a new `capabilities.recurring`. It returns a `NextAction`, which
already models redirect and in-page flows, plus a subscription ref. The kernel owns idempotency,
the same as for intents.

### 3–4. Plans and vendor price mapping

**OpenSaaS.** Plans are a code-level constant, with an `effect` union of `subscription` or
`credits(amount)` (`plans.ts:18-41`). An env-backed map converts plan ids to vendor price ids and
back again (`paymentProcessorPlans.ts`).

**Ours.** The catalog is data-driven (products/prices in SQL), which is more flexible. It lacks
two things:

- **An effect.** We only have `grantsMemberTierId`. Add a `credits` amount and a "subscription
  grants tier X" effect.
- **A provider-side price reference.** Add one per (price, provider account, mode). We have scoped
  everything else, so mode must be in the key: a test-mode price id must never resolve in live
  mode.

**Size: S, core.**

### 5–7. Entitlements, credits, gating

**OpenSaaS.** The webhook handler writes either `subscriptionStatus` or
`credits: { increment }`. Usage reserves a credit with a conditional `updateMany` and gives it
back if the work fails (`demo-ai-app/operations.ts:42-101`). The gate is a two-status check
(`:98-102`).

**Ours.** The single writer already emits `payment.succeeded`, `refund.succeeded` and the dispute
topics through a transactional outbox (`ledger/rows.ts:356`, `ingest/outbox-relay.ts`). That is
the correct place to drive entitlements from. A refund or a lost dispute should *revoke* what a
payment granted. OpenSaaS never does this: a refunded credit purchase keeps its credits.

**To add (M, core).**

1. **Entitlement consumer.** It reads the outbox and grants/revokes the member tier or plan,
   idempotent by message id.
2. **Credit ledger.** Credits are a balance, so use an append-only ledger rather than OpenSaaS's
   counter column: a purchase, reserve, commit, release and clawback-on-refund entry each. A
   counter cannot be reconciled or clawed back. This reuses the reserve-then-settle pattern our
   refund path already implements (`payments/ops/refund.ts`).
3. **`hasEntitlement` / `canSpend` query.**

### 8. Customer portal

**OpenSaaS.** All four vendors expose a per-customer self-serve URL, and OpenSaaS wraps it in one
operation:

- Stripe: `billingPortal.sessions.create`.
- Polar: customer session.
- Paddle: `customerPortalSessions.create`.
- Lemon Squeezy: a URL stored from the webhook.

**To add (S, core).** Add an optional `customerPortal?({ customerRef, ctx })` on
`PaymentProvider`, capability-declared and returning `Outcome<{ url }>`. Expose it on
`PaymentsPort` as a read-only, non-money call (no grant needed). It depends on #9 for the customer
ref.

### 9. Customer identity

**OpenSaaS.** It looks up the vendor customer by email, creates it if missing, and stores the
vendor id on the user (`stripe/checkoutUtils.ts:10-24`). Doing this by email is a known weakness:
Stripe does not enforce unique emails.

**Ours.** We deliberately keep emails and names out of money paths (`provider.ts:86`,
`ledger/rows.ts:10`).

**To add (M).** Add a `party_id ↔ provider customer ref` map per account and mode. Give plugins an
`ensureCustomer?` that receives contact details only through `providerOptions` or a host port. The
customer ref then appears in evidence. This keeps our "no personal data in the ledger" rule.

### 12. Catalog checkout is not connected to payments

**Ours.** `catalog/checkout.ts` creates the order and stops there; the header says so on purpose
(`:14-25`). `catalog/ports.ts:65-80` has its own order-level webhook inbox with an
out-of-order cursor. That inbox is a second, older path, separate from the payments kernel's
inbox.

**To add (M, core).** Add a checkout-to-intent orchestration:

1. Place the order.
2. Call `createIntent` with the order id as `reference` and a stable idempotency key.
3. Project the outbox's `payment.succeeded` / `refund.*` onto the order status.

Then retire the catalog-side webhook inbox, so there is one writer for money facts. Do this before
adding subscriptions, or subscriptions will inherit two inboxes.

### 13–16. Webhook events → billing state; cancel / trial / dunning

**OpenSaaS** handles, per vendor:

| Vendor | Events handled |
|---|---|
| Stripe | `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted` |
| Polar | `order.paid`, `subscription.updated` |
| Paddle | `transaction.completed`, `subscription.updated` / `canceled`; skips payment-method-change transactions (`paddle/webhook.ts:117`) |
| Lemon Squeezy | `order_created`, `subscription_created` / `updated` / `cancelled` / `expired`, using an id derived from the payload because no stable event id exists (`lemonSqueezy/webhook.ts:33-46`) |

Trials and dunning are statuses only. Retries, grace periods and card-update emails are the
vendor's job.

**Ours.** The right base already exists: verified facts, dedupe by provider event id, apply in one
transaction, dead letters and alerts. What is missing is the fact kinds.

**To add.** Extend `WebhookFact` into a union with `subscription` and `invoice` variants, and give
each a merge rule. Parity with OpenSaaS for dunning and trials is **S** once #1 exists: record
statuses and emit topics. Owning dunning (our own retry schedule, grace periods, card-update
emails) would be **L**. It is not recommended while providers already do it.

Note: Lemon Squeezy has no stable event id, so a future plugin must derive a deterministic one.
Our `providerEventId` contract should document that requirement, because the inbox dedupe key
depends on it.

### 17–20. Proration, coupons, tax, invoices

OpenSaaS **delegates** all four to the vendor:

- Proration: through the portal.
- Coupons: `allow_promotion_codes`.
- Tax: `automatic_tax` plus address capture.
- Invoices: `invoice_creation` for one-time payments.

The vendor-neutral equivalent:

- **Pass-through, S, plugin.** Flags go through `IntentRequest.providerOptions`
  (`provider.ts:88-89`), which already exists for this.
- **Record outcomes, M, core.** Tax amount, discount amount and invoice ref become optional fields
  on `PaymentEvidence`/`SettlementEvidence`, so that #21 can report gross vs net vs tax.
- **Owned discounts, tax or proration: L.** They belong in core only if a consumer needs
  merchant-of-record-independent pricing. They are explicitly out of scope today
  (`catalog/checkout.ts:32-33`).

### 21–23. Revenue, stats, admin analytics

**OpenSaaS.** It calls the vendor API and sums every charge balance transaction
(`stripe/paymentProcessor.ts:79-108`). Refunds and fees are ignored, and "profit" is a placeholder
field. A daily job writes a `DailyStats` snapshot (`analytics/stats.ts`), and the admin pages chart
it.

**Ours.** The ledger already stores amount, captured, refunded, disputed, fee, net and settlement
in minor units per currency (`ledger/rows.ts:101-102,175-180`). A revenue projection can therefore
be **more correct** than OpenSaaS's, and it needs no vendor API calls:

- gross = captured
- net = captured − refunded − disputed(lost) − fees
- one figure per currency, never summed across currencies

**To add (M, core).** A projection plus a read tool. The `/react` Payments panel
(`react/Payments.tsx:115-124`) already reserves the slot and refuses to invent numbers. Paying-user
counts depend on #1. Page views and traffic sources (Plausible/GA) are analytics, not commerce.

### 24–26. Admin customer list, account page, pricing page

These are UI in OpenSaaS. Each needs a read model first:

- **Customer list:** a subscriptions-by-status query (M). The admin toggle and user search belong
  to auth/admin.
- **Account page:** the current plan plus a "manage billing" portal button (S, once #1 and #8
  exist).
- **Pricing page:** a host/theme concern. `catalog/storefront.ts` already maps products for render
  data and could expose plan cards.

### 27. Billing emails

OpenSaaS sends one hard-coded "We hate to see you go" email, inline in the webhook handler
(`stripe/webhook.ts:184-189`). For us, email belongs to the host, and commerce only emits topics.
Add `subscription.cancel_scheduled` and receipt topics (S) when #1 lands.

### 28. Vendor adapters

This is the biggest practical gap for anyone trying to *use* the package: no real provider plugin
exists. Each adapter is a stateless translator against `PaymentProvider` (`provider.ts:100-139`)
and must pass `payments/testkit/provider-conformance.ts`. Estimates:

| Adapter | Size | What it needs |
|---|---|---|
| Stripe | M | intents, refunds, capture/void, retrieve, disputes, webhook signature |
| Polar | M | depends on #1 and #8 |
| Paddle | M | depends on #1 and #8 |
| Lemon Squeezy | M | depends on #1 and #8; derived event ids |

All four are plugins, never core. Building Stripe first would also test whether the provider
contract is shaped right, which its own header asks for (`provider.ts:14-15`: "grow it only when a
real adapter cannot be built against it").

## Ours has, they don't

| Capability | Where (ours) | OpenSaaS equivalent |
|---|---|---|
| Vendor-neutral provider contract with declared capabilities (refunds none/full/partial, manual capture, void, disputes, retrieve depth, currencies) | `payments/contract/provider.ts:52-139` | A 5-method interface; you pick a vendor by editing a constant and deleting the other folders (`paymentProcessor.ts:43-52`) |
| Several providers at once, registry refuses duplicate ids and binds ids to plugins | `payments/provider-registry.ts:1-12` | One vendor per deployment |
| Trust-gated plugin contribution (manifest namespace, digest-verified loader) | `payments/plugin-contribution.ts:1-20` | n/a |
| Three-way `Outcome` (`ok` / `rejected` / `unknown`): a timeout is never marked failed | `provider.ts:45-50` | Exceptions; a timeout on checkout creation is just an error |
| Unknown-outcome reconciler with resumable cursor + operator resolution with audit row | `payments/ops/reconciler.ts:1-22`, `ops/operator.ts:1-10` | None |
| Append-only payment/refund/dispute evidence with derived, non-regressing status | `payments/contract/evidence.ts`, `payments/state/status.ts:1-12` | Latest status overwritten on `User` |
| Refunds (full/partial, reserve-then-dispatch, idempotent) | `payments/ops/refund.ts` | None (vendor dashboard only) |
| Manual capture / void (auth-and-hold) | `payments/ops/capture-void.ts:196-200` | None |
| Disputes / chargebacks as first-class facts | `evidence.ts:24-51`, outbox `dispute.opened/closed` | None |
| Fee / net / settlement-currency recording | `evidence.ts:53-59`, `ledger/rows.ts:175-180` | None ("profit" is a placeholder) |
| Pre-charge risk gate (allow / review → manual capture / deny) | `payments/contract/risk.ts:1-21` | None (relies on vendor fraud tools) |
| Stuck-money alerts (over-withdrawn, unknown-aged, dead letter, quarantine) | `payments/contract/alerts.ts:7-17` | `console.error` |
| Amount/currency-mismatch quarantine | `ledger/rows.ts:358` | None |
| Multi-tenant scope on every money row: workspace + site + provider account + test/live mode, ownership from verified endpoint config, never from the payload | `payments/contract/scope.ts:1-22`, `ingest/receive.ts:4-9` | Single tenant; no test/live separation in data |
| Webhook inbox with retries, backoff, dead letter, revive on redelivery; only the body's sha256 is stored | `payments/ingest/receive.ts:11-16`, `ingest/worker.ts:1-20` | Record-then-delete-on-failure table (`processedWebhookEvent.ts`) |
| Transactional outbox for downstream consumers (at-least-once, ordered) | `payments/ingest/outbox-relay.ts:1-12` | None (side effects inline in the handler) |
| Agent tools with human-confirmed, single-use money grants bound to the exact op/amount/key | `payments/tools/catalog.ts:1-22`, `ops/grants.ts:1-17` | n/a (admin dashboard only) |
| Proper `Money` type (integer minor units, ISO-4217, exponent-aware, safe-integer arithmetic) | `money/money.ts:12-86` | Floats; revenue divided by 100 regardless of currency (`stripe/paymentProcessor.ts:107`) |
| Data-driven catalog: products, prices, compare-at price, images, specs, orders with line-item price snapshots, quantity cap | `catalog/types.ts`, `catalog/checkout.ts:39` | Hard-coded plan enum, one line item per checkout (`stripe/webhook.ts:144-147`) |
| Provider conformance test kit + deterministic fake provider with real signatures | `payments/testkit/provider-conformance.ts`, `testkit/lipay-fake.ts` | None |
| SQL + in-memory ledger behind one contract, with checksummed migrations | `payments/ledger/repo.{sql,memory}.ts`, `ledger/migrations/` | Prisma schema only |
| Honest status read model ("unavailable" instead of fabricated readiness) + localized read-only panel | `catalog/status.ts`, `react/Payments.tsx`, `react/commerce-i18n.ts` | n/a |

## Suggested order (if this report turns into work)

1. Wire catalog checkout to `createIntent` and retire the second inbox (#12). M.
2. Build a real Stripe provider plugin against the existing contract (#28). M. This is the first
   real test of the contract.
3. Add the plan effect and the provider price map (#3, #4). S.
4. Add the entitlement consumer and credit ledger on the outbox (#5–#7). M.
5. Add subscriptions: record, evidence, fact kinds and topics (#1, #2, #13–#16). L.
6. Add the customer map and portal link (#8, #9). S + M.
7. Add the revenue projection, the panel and the admin list (#21–#25). M.
8. Add the Polar, Paddle and Lemon Squeezy plugins. M each.
