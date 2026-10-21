# build-commerce REPORT — payments kernel L0, L1, L2, L3, L8
Branch `cloud/build-commerce-2026-10-21`, base b3c4144b. Run 15:59Z to ~16:45Z (wall clock as reported by `date`). Design: Tovu fd254878 `.cloud-coord/commerce-design/`. 11 Opus subagents used: 4 builders, 6 reviewers, 1 fixer (plus the coordinator wrote L1 and L3).

## Status per lot (all DONE)
| Lot | Commits | Notes |
|---|---|---|
| L1 contracts | 0b3581dc, fix 8e200009 | Money, scope, evidence, provider contract (Outcome ok/rejected/unknown), PaymentsPort (refund/capture/void need a grant), PreChargeRiskPort, derived status, DI tokens |
| L0 plugin proof + testkit + daemon | c9ff94a5, fix 8e200009 | real `createPluginContributionLoader` + `defineExecutablePluginContribution` with a fake provider plugin; trust, revocation, invalid-module and bad-manifest refusals; `./payments/testkit`; whole daemon `connectors` payments slot deleted (POST charge, POST refund, GET read) |
| L8 catalog onto Money | bf3c9a52, fix 0448b69d | `*Cents` fields migrated to Money (no aliases); UPPERCASE currency; `orderTotal` safe-integer sum; mixed currency refused |
| L2 ledger | 934d5a13, fix 857b2a62 (WIP snapshots 6fadaa57, a67917fb) | 8 tables, ONE ADR-066 migration `0001_payments_ledger`, repo port, Kysely SQL + in-memory adapters |
| L3 single writer | 4fcb8194, 7dce7d0d, fixes 9560a35a, a11a3987, 57633b5c | pure planner + `applyPaymentEvidence`/`applyRefundEvidence`/`reserveRefund`/`recordRefundDispatchOutcome`; deterministic LiPay fake |
Progress file: fbb4d01a. Every lot had a review subagent. All blockers and majors were fixed, except those listed under "Open" below.

## Tests (final HEAD, all run in cloud)
- commerce kernel vitest (`vitest.kernel.config.ts`): **278 passed, 0 failed, 1 skipped** (the Postgres test, which needs `COMMERCE_PG_URL`).
- commerce legacy `node --test` (catalog/payments/http/store): **184 pass, 0 fail** (before: 165 incl. catalog 28; catalog is now 48). Today's `lipay-plugin.ts` still works.
- commerce react vitest: 4/4. daemon connectors + integration-contracts: **102 pass**. `tsc --noEmit` is clean in commerce and daemon.

## Coverage of touched files (statements/branches/functions/lines)
100/100/100/100 for: money/money.ts; payments/kernel.ts, plugin-contribution.ts, provider-module-guard.ts; contract/{provider,risk,scope,tokens}.ts; state/status.ts; accounting/{plan-evidence,apply-evidence}.ts; ledger/{rows,repo,repo.sql,repo.memory,sql}.ts, migrations/{0001_payments_ledger,checksums,index}.ts; testkit/{index,provider-conformance,lipay-fake}.ts; catalog/{checkout,repo.rows,storefront,errors}.ts; daemon http/connectors.ts.
Type-only files (contract/evidence.ts, payments-port.ts, catalog/types.ts) have no statements to cover. No exclusions were added.

## Complexity
`eslint --rule complexity:[error,10] --rule sonarjs/cognitive-complexity:[error,10]` over packages/commerce/src: **0 errors** (16 pre-existing or style warnings).

## Deviations from the design, and why
- New entries: `@jini-ai/commerce/payments/kernel` (because the old `./payments` barrel already uses names like `PaymentProvider`), `./payments/testkit`, and `./payments/ledger/sql` (kysely and `@jini-ai/db` are optional peers, so they are kept out of the kernel entry).
- Intent `failed → authorized|succeeded` is allowed: a later success beats an earlier decline, otherwise B4 comes back. `canceled → succeeded` is quarantined as `terminal-conflict`.
- Refund `succeeded → failed` is allowed and emits `refund.failed`. A `failed → succeeded` refund is quarantined.
- Providers that do NOT echo our correlation id:
  - While one of our refunds is still waiting for its response, the evidence is deferred (the caller parks and retries).
  - A success of exactly the same amount binds to the single `unknown` (outcome lost) row.
  - A failure never binds by amount.
  - This is Opus's "park" rule, extended so a timeout cannot wait forever.
- `recordRefundDispatchOutcome` only moves `reserved` rows. A rejected retry can never release the hold on money that may have moved (this was a review blocker: double refund).
- Disputes:
  - Open and lost disputes reduce the refundable amount in `reserveRefund`.
  - The over-refund cap stays based on captured only, because real evidence is never dropped.
- Ledger additions:
  - Foreign keys use (payment_id, workspace_id, mode).
  - Every money row carries site, provider and account.
  - CHECKs for mode and non-negative amounts.
  - Status columns are free TEXT, because SQLite cannot alter a CHECK without rebuilding the table.
- L8: the host owns the catalog schema, so the physical `*_cents` columns are kept. `repo.rows.ts` is the only Money converter, and legacy lowercase rows read back UPPERCASE. Liquid `product.price` still uses minor units (unchanged); `product.currency` is now `"USD"`.
- Daemon: the whole payments slot is removed, including GET, because the `PaymentsProvider` port type carries charge and refund.
- New devDependencies:
  - `@vitest/coverage-v8` (per-file coverage, same version as sibling packages).
  - `@jini-ai/agent-plugins` (workspace; only the L0 test uses it, to run the real loader).
  - No runtime dependencies.

## LOCAL-RUN NEEDED
- `packages/commerce/src/payments/ledger/__tests__/postgres.vitest.test.ts` with `COMMERCE_PG_URL` pointing at a throwaway database. It covers:
  - the advisory-lock serialization;
  - BIGINT values returned as strings;
  - the 23505, 23503, 23514 and 23502 error mapping;
  - the composite foreign key.
- PGlite: the 25-case contract passed once in cloud from db's install (52s), but it is not committed, because PGlite does not resolve from commerce without adding a dependency.
- The concurrent-refund race is only proven serialized on memory and SQLite, plus a lock-first call-order test. True interleaving needs Postgres.

## Open questions for the owner
1. Should we add a PGlite devDependency to commerce so the Postgres-dialect contract runs in CI?
2. Unknown refunds with no evidence ever (the timed-out request never reached the provider) hold money forever. Do we want an operator "resolve" path with audit, or a reconciler rule such as "the provider has no refund for this idempotency key → failed"? I recommend L4.
3. The dispute amount check quarantines a closing update whose amount changed, so the dispute stays open. Should we apply the status and quarantine only the difference?
4. Should we alert (not cap) when succeeded refunds plus disputed money exceed captured?
5. Deprecating the `@jini-ai/capability-providers` payments port: not done (it is still exported).

## Dead or remaining code (kept on purpose until the split)
These are now superseded by the kernel but still live:
- `payments/lipay-plugin.ts`, `payments/ports.ts`, `payments/state-machine.ts`
- `catalog/webhook-inbox.ts`, `store/store-plugin.ts`
- `providers/lipay-gateway.ts`, which is reused by the LiPay fake for webhook signing

Nothing is wired to the new kernel yet. L4 deletes the old code when it builds the services.

## Known limits handed to later lots
- **L5:** a provider ref already held by ANOTHER payment throws `LedgerConstraintError`, which on Postgres poisons the transaction. The inbox worker must roll back, then dead-letter or quarantine in a new transaction.
- **L5:** `listDueInbox` does not claim rows, so v1 must run a single worker.
- **L4:** the provider registry must refuse duplicate provider ids. The loader does not bind a provider's `id` to its `pluginId`.
- **L8 follow-up:**
  - Tovu `render.ts:124-129` documents lowercase currency.
  - The `storefront.pickDisplayPrice` comparison mixes currencies.
  - Order-item currency versus order currency is not enforced by the repo.

## What L4 must start from
- `@jini-ai/commerce/payments/kernel`: `PaymentsPort` (implement it), `PaymentProvider`, `assessPreChargeRisk` and `noopRiskPort`.
- `@jini-ai/commerce/payments/ledger/sql`: `migrateCommercePayments`, `sqlPaymentsLedger`, and `memoryPaymentsLedger` for tests.
- The writer functions, each run inside `ledger.transaction`:
  - Refund: look up the idempotency key first, then redeem the grant, then `reserveRefund` (with `refundId` as the correlation id), then dispatch outside the transaction. Then settle:
    - `ok`: `applyRefundEvidence(…, { refundId })`
    - `rejected` or `unknown`: `recordRefundDispatchOutcome`
  - Intent: insert the payment as `unknown`, run the risk gate (`review` = manual capture), dispatch, then `applyPaymentEvidence`. `unknown` stays `unknown` until the reconciler `retrieve`s.
- Tests use `testkit/lipay-fake.ts` (scripted ok/timeout/reject, signed webhooks, `retrieve`) and `providerConformanceCases`.
