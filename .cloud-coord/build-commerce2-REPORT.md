# build-commerce2 REPORT — payments lots L4, L5, L6a, L7
Branch `cloud/build-commerce2-2026-10-21`, base 08f5dac9. Run 16:51Z–~20:00Z (paused ~17:25–19:55 on a session limit; owner moved hard stop to 23:00Z). 4 Opus builders (L4, L5, L6a, L7), no review subagents (owner). Coordinator wrote the shared seams, the layers line and verification.

## Lots + commits (all DONE, pushed)
| Lot | Feature commit | Notes |
|---|---|---|
| seams | 5cc1d4d5 | `payments/provider-registry.ts` (kernel registry + `ProviderContextPort`), `contract/alerts.ts` |
| L5 ingest | 9546d840 | webhook route, inbox worker, outbox relay |
| L6a Stripe | 970b9005 (bulk landed in WIP d20703bf/c11c85a0) | new package `@jini-ai/payments-stripe` |
| L7 agent tools | 71b1a539 | `./payments/tools` entry |
| L4 operations | fa7ed60a (bulk in WIP 3e0122f4) | service, grants, reconciler, operator, deletions |
WIP/progress commits: 89de9d3a, 328bd72e, d83a6e74, d20703bf, c11c85a0, 3e0122f4, 2072719c (stop-hook snapshots; squash-able). Each lot's builder notes: `.cloud-coord/build-commerce2-L{4,5,6a,7}.md`.

## Tests (final HEAD, cloud)
- commerce kernel vitest: **546 passed, 1 skipped** (Postgres). Was 278 → +268 (L4 ~276 new incl. rewrites, L5 62, L7 42; 138 legacy node:test cases deleted with their code).
- commerce catalog node:test 46/46 (48 before; 2 went with webhook-inbox.ts). React 4/4. `tsc --noEmit` clean. Build clean.
- payments-stripe vitest **144/144** (conformance cases twice, real contribution loader registration, openssl HMAC vector).
- `check-engine-boundaries`, `check-package-layers`, `check-subpath-isolation`: rc 0. `pnpm guard` self-test FAILS on an agent-runtime fixture (R2) — identical on base 08f5dac9 (verified in a clean worktree), not ours.

## Coverage (stmts/branch/funcs/lines)
100/100/100/100 for every runtime file under commerce `src/payments/**` (ops/*, ingest/*, tools/*, accounting/*, ledger/* incl. migration 0002, provider-registry, contract/{alerts,provider,risk,scope,tokens}, state, testkit) and `src/http/**`, and every payments-stripe `src/*.ts`. Type-only files (contract/evidence.ts, payments-port.ts) have no statements. No ignores/excludes/threshold changes.

## Complexity
Repo eslint + `complexity:[error,10]` + `sonarjs/cognitive-complexity:[error,10]` over commerce payments/http + payments-stripe: **0 complexity errors**. 8 pre-existing-style sonarjs warnings. One lint error (banned phrase "this site" in a tool description) fixed by the coordinator.

## Deviations (why)
- L4: reconciler also moves stale `reserved` refunds (crash between Tx1/Tx2) to `unknown`, never `failed`. Owner rule "no refund for this key after retrieve → failed" applies only with `retrieve: "payment+refunds"` and when no snapshot refund could still be ours; `pending` is never failed, only alerted.
- L4: cheap checks before grant redeem (bad request never burns an approval); a mismatching redeem does not consume; a grant redeemed in a tx that then refuses stays used. Grant binding has no siteId (payment id + full scope check pin it).
- L4: `createPaymentsOperator` (reconcile/resolve) kept apart from `PaymentsPort` so consumers never get it. Operator audit = migration `0002_payments_operator_actions`; 0002 also adds `commerce_outbox.seq` for strict per-apply order (L5 finding).
- L4: replays return risk `allow/idempotent-replay` (original decision not stored); capture/void idempotency matched on attempt row.
- L5: worker takes scope from the inbox row (no endpoint dep); correlation id naming another account → dead-letter + quarantine `scope-mismatch`; retrieved evidence applied as source `retrieve`; stored errors keep codes only.
- L6a: refund/dispute webhooks become id-only facts (coordinator decision) so the worker retrieves the authoritative snapshot — avoids a refund webhook setting captured = full amount on a partially captured intent. `charge.refunded` keeps evidence (carries amount_captured). ISK/UGX ×100 on the wire. livemode ≠ account mode → rejected. Stripe-Version pinned 2024-06-20. No `stripe` SDK.
- L7: core has no money side-effect class → money tools are `mutates-durable-state` + `confirmer-must-equal-own-delegatedBy`, no `rememberKey`; grants port typed `Pick<…,"mint">` in tools (tools cannot redeem). Permission re-checked in run.

## Deleted
`payments/{lipay-plugin,ports,state-machine,registry,credentials,index}.ts`, their node:test suites + support/storage, `store/store-plugin.ts`, `store/index.ts` + tests, `catalog/webhook-inbox.ts` + test, legacy `http/__tests__/{payments-webhook.test,http-test-server}.ts`; package.json `./payments`, `./store` entries. `providers/lipay-gateway.ts` reduced to `signLipayWebhook` (the fake's signer). **Breaking for Tovu at its next bump** (pins npm 0.1.1 today): `apps/website/src/features/plugins/{lipay,store}`, `route-async-guards.test.ts:360-368` (old `resolveLipay` deps), public site routes typing `StoreApi`.

## LOCAL-RUN NEEDED
- `ledger/__tests__/postgres.vitest.test.ts` with `COMMERCE_PG_URL` (now also covers migration 0002, `seq` order, new list methods).
- Stripe sandbox: record real PaymentIntent/Refund/Dispute/Event payloads to replace synthetic fixtures (`payments-stripe/src/__tests__/fixtures/*`, marked "needs sandbox recording"); verify ISK/UGX handling, signature with real `whsec_`, 3DS `next_action`.
- True concurrent-refund interleaving on Postgres. No Playwright needed this job (no UI).

## Owner questions
1. Timed-out `createIntent` has no provider ref → reconciler cannot retrieve; only operator resolve. Add a provider lookup by our correlation id (Stripe search by metadata)?
2. Over-withdrawn alert fires inside the writer tx; a later rollback could leave a spurious alert. OK, or move alerts to the outbox?
3. Reconciler `olderThanMs` must exceed the slowest provider call — enforce a floor?
4. Core: add a `moves-money` side-effect value + approval class so the risk gate distinguishes money tools?
5. A replayed money-tool call still mints an unused grant (lapses at TTL, 2 min). OK for a durable grant store?
6. Webhook verify results other than SIGNATURE_INVALID (e.g. livemode mismatch) return 400 — keep?
7. Grants are in-memory only (`createMemoryGrantStore`); multi-process hosts need a durable `MoneyGrantPort` (table) — next lot?

## What L6b / L9 / risk layer must start from
- **L6b PayPal**: copy `packages/payments-stripe` layout (plugin.json → dist default export, layers entry 7, only `@jini-ai/commerce/payments/kernel` imports); pass `providerConformanceCases`; register via `paymentProviderContributionSpec` + `createKernelProviderRegistry` (bindings pin id → pluginId). Test whether PayPal echoes `custom_id`/`invoice_id` (echoesCorrelation); if not, L3's park rule applies.
- **L9 donations**: consume `PaymentsPort` (from `createPaymentsService`) + outbox via `createOutboxRelay`'s publisher (`payment.succeeded`, `refund.succeeded`, `refund.failed`, `dispute.opened`, `dispute.closed`; dedupe by message id). Money moves only through L7 tools / minted grants.
- **Risk layer**: plug in via `PreChargeRiskPort` (`assessPreChargeRisk` policy/deadline) and feed from the outbox; alerts via `PaymentsAlertPort`. Keep the ledger portable (no PostGIS/graph in money tables).
- Hosts must wire: `ProviderContextPort` (credentials incl. `webhookSecretPrevious`), `WebhookEndpointPort`, one inbox worker + one outbox relay per database (no claim/lease yet), reconciler timer, the route before any JSON body parser.
