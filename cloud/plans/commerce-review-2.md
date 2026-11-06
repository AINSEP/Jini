# Commerce second review (Opus)

Reviewed: Tovu `7d58e6a95..origin/cloud/commerce` (head 60049a5ae), Jini `c34aea4cd..origin/cloud/commerce` (head eb4baf982). Read-only; nothing was run. Findings come from reading the code, so no failure below was reproduced. I stopped at the context budget (see "Not read").

Counts: 0 critical, 2 high, 13 medium.

Verdict: merge after listed fixes. N-H1 and N-H2 must be fixed before commerce can be turned on at any site. Commerce-off sites are safe from these two, because the tool needs an existing unknown payment.

## High

### N-H1. An agent can mark a payment paid with no person approving
- Where: Jini `payments/tools/resolve-unknown.ts:17-25` (no `actorClassRule`), `:33-44` (plain handler). Compare `payments/tools/catalog.ts:78` (money tools use `confirmer-must-equal-own-delegatedBy`) and Tovu `features/consent/tool-registrations.ts:5` (`approvalToolHandler`). I found no generic gate on `mutates-durable-state` in Tovu's assistant code; the only `sideEffects` check in `apps/website/src/assistant` and `src/server` is batch eligibility.
- Failure: the model calls `{orderId, outcome: "succeeded", reason: "Verified in dashboard"}` for an order whose payment is `unknown`. This could follow an owner's vague request or injected page or plugin text. `settleUnknownIntent` (`accounting/apply-evidence.ts:410-414`) sets `succeeded` and `capturedMinor = amountMinor` and enqueues `payment.succeeded`. The relay then marks the order paid, so goods are fulfilled with no money received. The audit row records `actor: ctx.principal.id` (`resolve-unknown.ts:43`), so it reads as a person's verification, and the `reason` text is unverified model output. The tool gate is also `admin.integrations.manage`, not the payment permission (`commerce.payments.manage`), so any integrations admin passes it.
- Not a risk: scope comes from the stored order association (`commerce.ts:246-251`), cross-site rows are refused, only `unknown` rows move, and the audit and state change commit together. A later real webhook can still move `failed` to `succeeded` (`state/status.ts:39`), so a wrong "failed" self-corrects if the webhook arrives. A wrong "succeeded" never corrects, because `succeeded` has no next state.
- Fix: build the handler with `approvalToolHandler`/`humanConfirmedHandler`, declare `actorClassRule: "confirmer-must-equal-own-delegatedBy"`, and show order, amount, mode and outcome on the card. Add a test that a declined card writes nothing.

### N-H2. The owner cannot find what needs resolving, and acknowledged settlement failures leave no record
- Where: Tovu `composition/commerce.ts:110-114`: `alerted` is a process-lifetime Set keyed by `alert.kind`, and the warning text drops `alert.detail` and `alert.paymentId`. `commerce.ts:119-122` plus `ingest/outbox-relay.ts:76`: a `blocked` message is now marked published. `settle-order-payment.ts:66`: `not_succeeded` raises no alert at all, although the code comment at `commerce.ts:120` and the report both say it does. `resolve-unknown.ts:20` needs an `orderId`; no tool lists stuck orders (grep of `payments/tools`, `catalog-tools.ts`, `tools.ts`).
- Failure:
  - The first `unknown-aged` logs one line with no id. Every later unknown payment, in any order, logs nothing until restart. H4's tool is reachable only if a buyer complains and supplies the order id.
  - A second `fulfillment-blocked` (buyer charged, order cannot be marked paid) logs nothing, the message is gone, and the tool refuses it because the intent is `succeeded`, not `unknown`. No repair path exists short of SQL.
  - The first `inbox-dead-letter` from a harmless cause (N-M9) hides a real one.
  - Trigger honesty: `blocked` needs a data mismatch and is rare; `not_succeeded` is unreachable with Stripe today (`refunds: "none"`). `unknown-aged` is the realistic path.
- Fix: dedupe by `kind + paymentId` with a bounded set, and log the ids and detail. Write blocked and `not_succeeded` outcomes to the existing `commerce_quarantine` table before acknowledging. Add a bounded "needs attention" list (at most 10 order ids) to `commerce_get_status`, using the existing scans.

## Medium

### N-M1. Changing account across modes strands a buyer who pays an old session
- Where: `catalog/merchant-drain.ts:14-20` releases `requires_action` rows unless they share the configured provider and mode. `payments/provider-contexts.ts:56` refuses when saved `accountId` differs from the row's. `commerce.ts:154-157` picks the old row's scope for the webhook.
- Failure: account A in test mode has an open Stripe session (open for up to 24 h). The owner saves account B in live mode, and nothing blocks this. The buyer pays the old session. The webhook resolves to scope A, the context is refused, and it is not accepted. The reconciler fails the same way. The order stays pending until A's settings are restored. The integration test (`commerce.integration.test.ts` around "abandoned requires_action") leaves provider settings on the old account, so it does not exercise this.
- Fix: release `requires_action` rows only when the account is unchanged, or when the row is older than the session lifetime (25 h).

### N-M2. Every abandoned checkout polls Stripe and writes evidence every 15 minutes
- Where: `ops/reconciler.ts:153`; `accounting/apply-evidence.ts:240` (always appends evidence), `:173` (always bumps `updated_at` and `version`), even when nothing changed.
- Cost: an abandoned session open 24 h gives about 95 Stripe GETs and about 95 permanent evidence rows, even with webhooks working. At 1,000 abandons a day that is about 95,000 rows a day. The scan takes 10 rows a minute per mode, so more than 150 open sessions delays the `unknown` rows and truly paid rows sharing that scan. `tally` is sequential with 30 s timeouts (`http.ts:47`), so during a Stripe slowdown one pass can hold the worker for up to 10 minutes with two modes, delaying inbox and relay work.
- Fix: retrieve by age (15 min, 1 h, then at expiry). Skip the evidence append and row write when status is unchanged. Scan `unknown` separately.

### N-M3. Rows that are not `unknown` can stick forever, and the tool cannot clear them
- Where: `ops/reconcile-snapshot.ts:38` (a rejected or failed retrieve leaves the row); `accounting/apply-evidence.ts:407` (only `unknown` settles); `ops/operator.ts:38` with `ops/common.ts:46` (provider must be registered); `commerce.ts:184` (`hasOpenPayment`).
- Failure: keys are revoked, or the session returns 404 (`http.ts:5`). A `requires_action` or `pending` row is retried every minute, because `updated_at` does not move, and never closes. On a disabled shop the 5 s worker never stops and holds its PostgreSQL connection. `commerce_resolve_unknown` refuses it. With the Stripe plugin off or keys removed, `checkProvider` also refuses `unknown` rows, which is exactly the case manual resolution exists for.
- Fix: skip the provider check for resolution, since it makes no HTTP call. Allow resolving `requires_action`/`pending` rows older than the session lifetime.

### N-M4. The buyer page says "check again shortly" forever after a failed or expired payment
- Where: `catalog/buyer-order.ts:24-29` reads only `order.status`. No code in `catalog/` writes an order to `failed` or `canceled`, so lines 26-27 are dead.
- Failure: a session expires, a card fails, or the owner resolves `failed`. `/commerce/return` and `/commerce/cancel` keep showing "Payment status pending ... Check this same order again shortly", with no new-order path except "Back to shop".
- Fix: branch on `view.payment.status` for `failed` and `canceled`, and remove the dead order branches.

### N-M5. M7 is only half fixed: POST pay still returns internal fields, and "View order" is raw JSON
- Where: Tovu `routes/commerce/purchase.ts:162` returns the raw view; `payments/ops/view.ts:30` includes `scope` (workspace, site, provider account id, mode). The browser link `browser/checkout.ts:41` points at the JSON API.
- Failure: any signed-in buyer who pays sees the merchant's provider account id and site id. The test "POST pay retains provider continuation" asserts only `next`, and the allowlist test covers only GET.
- Fix: return `toCommerceBuyerOrder` plus `payment.next`, `intent.ok` and `intent.error`. Point the link at `/commerce/return?orderId=`.

### N-M6. Orders created before a price correction can still be paid at the old price
- Where: `catalog/load-payable-order.ts:30-31` checks that the price exists, not that it is active. `catalog/checkout.ts:155` checks only at creation. Orders have no expiry.
- Failure: the owner types 100 instead of 1000 and corrects it. Anyone who sent `POST /orders` during the window can send `POST .../pay` days later, is charged 100, and the order is marked paid. This survives H5, whose purpose was to stop selling a mistyped price.
- Fix: in `payOrder`, refuse when the price is not active and no association exists yet. Keep existing association and replay behavior.

### N-M7. An active shop with removed configuration never starts draining after a restart
- Where: `commerce.ts:201` (active branch, no table probe), `:208`, `:135`, `:240`. `storageReady` is set only by `ensureSchema` or the off branch.
- Failure: commerce enabled, configuration cleared, open payments, restart. `resolve` skips the drain read and returns null, the worker is not kicked, and `resolveReceiver` returns null, so webhooks are refused until settings are restored. The drain tests boot with commerce disabled, so they miss this.
- Fix: run the `tableExists` probes in both branches.

### N-M8. Disabled draining reruns the migration check every 5 seconds
- Where: `commerce.ts:189` (added by the M1 fix); `db/migrate/runner.ts:218-232`.
- Cost: `tableExists` plus a full ledger read, validation and checksum verification each cycle, about 34,000 queries a day while any row stays open (indefinitely under N-M3). `warm()` at `:206` already ran it.
- Fix: memoize it like `ensureSchema`.

### N-M9. Two sites on one Stripe account produce dead letters and retries on each other's events
- Where: `ingest/worker.ts:197`, `:146`; the header comment at `:177-180` names this setup, but only the shared-database form is handled and tested.
- Failure: with separate site databases, every event from site A's sessions reaches site B and finds no payment. B retries 8 times over about an hour and then stores a permanent dead row, and it uses B's one `inbox-dead-letter` warning (N-H2). `hasPending` stays true during the retries, and id-only events also call Stripe each time. No money moves.
- Fix: add `metadata[jini_site_id]` when creating the session (`checkout-session.ts:17`), and ignore other sites in `readSession`.

### N-M10. The resolve tool appears on commerce-off sites and hits a missing table
- Where: `commerce.ts:246-251`; `catalog/repo.order-payments.ts:17`. Unlike the catalog tools, it has no setup check.
- Failure: on a site that never enabled commerce, the call throws a storage error on `commerce_order_payments`, not the tool's plain "not found" message. I did not trace how the tool layer words that error.
- Fix: return `order-payment-not-found` when `tableExists` is false.

### N-M11. M8 residue: a pool below 2 keeps taking payments that never settle
- Where: `db/kernel/session-lock.ts` (the new throw); `settlement-worker.ts:79-81` warns once; `commerce.ts:231-238` `status` ignores worker ownership.
- Failure: `max: 1` on PostgreSQL. The worker can never run, but `ready` stays true, so buyers are charged and orders stay pending. One warning, then silence.
- Fix: report not ready when `poolMax < 2`.

### N-M12. No Stripe API version is pinned
- Where: `payments-stripe/http.ts:41-44` has no `Stripe-Version` header; `session-reading.ts` depends on field shapes. No failure observed; the risk is that retrieve follows the account's default version, which can differ per merchant and from the webhook endpoint's version.
- Fix: send one fixed `Stripe-Version` and state the required webhook version in the setup skill.

### N-M13. Tests that do not prove what the code now depends on
- `tool-catalog-commerce.unit.test.ts` uses a fake `commerce` and asserts three tool ids. The real runtime has four, so nothing covers the real registration list or the risky tool's approval. The contributor risk map in `tool-catalog-manifest.ts:374` also omits `commerce_resolve_unknown`; I did not trace what reads that map.
- `resolve-unknown.vitest.test.ts` tests permission and scope only, with no approval or decline case.
- `settlement-worker.unit.test.ts`: the "PostgreSQL" tests use a fake `withOwnership`. Real PostgreSQL is covered only for the lock itself, not the worker on it.
- `reconciler-stale.vitest.test.ts` proves recovery, but not the repeat cost of an unchanged open session (N-M2).
- Browser tests are jsdom with stubbed `fetch`; they cover button state, not the Stripe round trip.
- Stripe retrieve, replay and expiry are proven only against fake transport, as the report admits. Run one Stripe test-mode pass before going live.
