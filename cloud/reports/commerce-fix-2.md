# commerce-fix-2 — completed

Completed within the two-hour cap. Work completed on `cloud/commerce` only in Jini and Tovu, from Jini `eb4baf982` and Tovu `60049a5ae`. Job authority: `origin/cloud-plans-1105:cloud/jobs/COMMON.md`, `cloud/jobs/commerce-fix-2.md`, and `cloud/plans/commerce-review-2.md`. All findings were checked against the code; none was rejected as incorrect. No other branch was merged. No main push, force push, publish, tag, deployment, live provider call or owner data was used. Commerce stays off by default.

## Findings

| Finding | Result |
| --- | --- |
| N-H1 | Fixed. The existing core approval lifecycle gates resolution. Catalog declares `confirmer-must-equal-own-delegatedBy`, checks `commerce.payments.manage` before lookup and again after approval, and uses the authenticated confirmer in the audit. The real host card shows stored order/payment IDs, a formatted currency amount, mode, outcome and verification reason. A declined card changes no payment/evidence/audit state. |
| N-H2 | Fixed as directed. Alerts dedupe by kind + payment (detail fallback for null IDs) in a bounded 1,000-entry set and retain IDs/detail. Blocked/not-succeeded projections enter existing quarantine before acknowledgement; deterministic message-based IDs survive acknowledgement retries. Own projection evidence records the trusted host site, so a missing payment row does not hide the blocked order. Failed quarantine writes leave outbox work queued. `commerce_get_status.checkout.needsAttention` contains at most ten distinct order IDs, fenced to the host site. |
| N-M1 | Fixed conservatively. Requires-action sessions keep the original merchant when provider/account changes, including across modes. Same-account mode changes remain allowed. No automatic 25-hour release was added; settlement or approved manual closure releases the old merchant. |
| N-M2 | Fixed in the scheduled operator lifecycle. Unknown payments have an independent scan. Successful unconfirmed retrieves occur at age milestones 15 minutes, one hour and 25 hours; repeated accepted observations with no material changes append no evidence and perform no payment/version write. First observations and changed action/settlement/refund/dispute facts remain recorded. Failed retrieves and storage failures preserve existing retries. |
| N-M3 | Fixed. Manual resolution validates stored scope without requiring a registered provider or credentials. Unknown payments and pending/requires-action payments older than 25 hours can be resolved. Final provider evidence remains authoritative. |
| N-M4 | Fixed. Buyer guidance reads terminal failed/canceled payment status instead of unreachable order branches. |
| N-M5 | Fixed. POST pay uses the buyer projection and exposes only the required provider continuation plus intent ok/error. View order opens `/commerce/return?orderId=`. |
| N-M6 | Fixed. An inactive price cannot start a first payment association. Existing association/replay behavior is retained. |
| N-M7 | Fixed. Existing payment/catalog storage is probed in both activation modes, allowing active restarts with removed settings to drain original work and accept late webhooks. |
| N-M8 | Fixed. Payment migration preparation is memoized across warmup, full schema preparation and disabled worker cycles; failures remain retryable. |
| N-M9 | Intentionally not fixed, by owner instruction. |
| N-M10 | Fixed. Resolution returns `order-payment-not-found` when association storage is absent. |
| N-M11 | Fixed. A registered PostgreSQL pool below two connections reports not ready and refuses create/pay/activate admission before order/payment writes. The worker's dedicated ownership connection still requires a second pool connection. |
| N-M12 | Fixed. Every Stripe HTTP request carries `Stripe-Version: 2024-06-20`; the existing commerce setup skill requires the same webhook endpoint version. |
| N-M13 | Completed only the requested tests: H1 decline, H2 discoverability/durable failure records, and the real four-tool runtime registration list. No unrelated test expansion from the review was attempted. |

## Validation

All commands use `source /workspace/.tovu-build/env.sh`. Provider calls are fake/scripted HTTP or LiPay fake transport. Persistence coverage includes memory, SQLite and the existing PGlite composition tests. The PostgreSQL pool-admission fixture uses registered fake pool capacity with SQLite-backed SQL: it does not prove the real PostgreSQL settlement worker or real advisory-lock behavior.

Setup and final integration commands (Jini root unless noted):

```sh
pnpm install --frozen-lockfile
pnpm --filter @jini-ai/core build
pnpm --no-bail -r build
# Tovu root, after Jini rebuild:
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
npm --prefix packages/contracts run build
```

Targeted baselines passed before production edits: resolution 8 tests, catalog/browser 35, reconciliation/operator 22, Stripe HTTP 33, Tovu composition/status 16. New bug regressions were observed failing before fixes. No tests were disabled, skipped, deleted or weakened; existing cross-account assertions were updated to require the corrected merchant-preservation behavior. No rule/threshold/exclusion was weakened. Full repository test suites were not run, as instructed.

Jini root:

```sh
pnpm --filter @jini-ai/commerce exec vitest run -c vitest.kernel.config.ts src/payments/tools/__tests__/resolve-unknown.vitest.test.ts src/payments/tools/__tests__/money-tools.vitest.test.ts src/payments/tools/__tests__/read-tools.vitest.test.ts --maxWorkers=2 --minWorkers=1
# 44 passed; resolution suite grew from 8 to 10.
pnpm --filter @jini-ai/commerce exec vitest run -c vitest.kernel.config.ts src/catalog/__tests__/unit/merchant-drain-ledger.vitest.test.ts src/catalog/__tests__/unit/buyer-order.vitest.test.ts src/catalog/__tests__/unit/pay-order.vitest.test.ts src/browser/__tests__/checkout.vitest.test.ts --maxWorkers=2 --minWorkers=1
# 42 passed; baseline 35, seven added regressions failed before fixes.
pnpm --filter @jini-ai/commerce exec vitest run -c vitest.kernel.config.ts src/catalog/__tests__/unit/load-payable-order.vitest.test.ts src/catalog/__tests__/unit/plugin-server.vitest.test.ts src/catalog/__tests__/unit/order-projection.vitest.test.ts --maxWorkers=2 --minWorkers=1
# 55 passed.
node --import tsx --test packages/commerce/src/catalog/__tests__/unit/merchant-drain.unit.test.ts
# Passed.
pnpm --filter @jini-ai/commerce typecheck
pnpm --filter @jini-ai/provider-plugins typecheck
# Passed.
pnpm exec eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/commerce/src/catalog/merchant-drain.ts packages/commerce/src/catalog/buyer-order.ts packages/commerce/src/catalog/pay-order.ts packages/commerce/src/browser/checkout.ts
pnpm exec eslint packages/commerce/src/payments/tools/resolve-unknown.ts packages/commerce/src/payments/tools/index.ts
pnpm exec eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/provider-plugins/src/payments-stripe/http.ts packages/commerce/src/payments/ops/operator.ts packages/commerce/src/payments/accounting/apply-evidence.ts packages/commerce/src/payments/ops/reconciler.ts packages/commerce/src/payments/ledger/repo.memory.ts
# No lint/complexity errors. Existing style warnings are recorded below.
```

From Jini `packages/commerce`:

```sh
pnpm exec vitest run -c vitest.kernel.config.ts src/payments/ops/__tests__/reconciler-stale.vitest.test.ts src/payments/ops/__tests__/reconciler.vitest.test.ts --maxWorkers=2 --minWorkers=1
# 52 passed: stale suite 8 -> 22; existing reconciliation 30.
pnpm exec vitest run -c vitest.kernel.config.ts src/payments/ops/__tests__/operator.vitest.test.ts src/payments/accounting/__tests__/apply-evidence-ops.vitest.test.ts src/payments/accounting/__tests__/writer-boundaries.vitest.test.ts --maxWorkers=2 --minWorkers=1
# 72 passed: operator suite 14 -> 24.
pnpm exec vitest run -c vitest.kernel.config.ts src/payments/ops/__tests__/reconciler-stale.vitest.test.ts src/payments/accounting/__tests__/apply-evidence.vitest.test.ts --maxWorkers=2 --minWorkers=1
# 63 passed at that checkpoint, including 45 writer tests.
pnpm exec vitest run -c vitest.kernel.config.ts src/payments/ledger/__tests__/memory.vitest.test.ts src/payments/ledger/__tests__/sqlite.vitest.test.ts --maxWorkers=2 --minWorkers=1
# 117 passed.
```

From Jini `packages/provider-plugins`:

```sh
pnpm exec vitest run src/payments-stripe/__tests__/http.test.ts src/payments-stripe/__tests__/provider.test.ts src/payments-stripe/__tests__/checkout-session.test.ts src/payments-stripe/__tests__/payments-stripe-kernel.test.ts --maxWorkers=2 --minWorkers=1
# 93 passed. Exact request-header assertions require the pinned version.
```

Additional Jini status/quarantine/db verification, from Jini root:

```sh
pnpm --dir packages/commerce exec vitest run -c vitest.kernel.config.ts src/catalog/__tests__/unit/status-tools.vitest.test.ts src/payments/ledger/__tests__/quarantine-limit.vitest.test.ts
# 15 passed.
pnpm --dir packages/db exec vitest run src/__tests__/kernel-session-lock.test.ts
# 5 passed, including registered fake pool capacity and wrapper inheritance.
pnpm --dir packages/commerce build
pnpm --dir packages/db build
pnpm --dir packages/db typecheck
pnpm exec eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/db/src/kernel/session-lock.ts packages/db/src/kernel/index.ts
pnpm exec eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/commerce/src/tools.ts packages/commerce/src/catalog/contracts.ts packages/commerce/src/payments/tools/resolve-unknown.ts packages/commerce/src/payments/tools/index.ts
# All passed; final status/approval/db lint has no warnings or errors.
```

Tovu root, final source after all fixes:

```sh
node --import tsx --test --experimental-test-module-mocks apps/website/src/server/runtime/composition/__tests__/commerce-attention.unit.test.ts apps/website/src/server/runtime/composition/__tests__/commerce-composition.unit.test.ts apps/website/src/server/runtime/composition/__tests__/commerce.integration.test.ts apps/website/src/server/runtime/composition/__tests__/tool-catalog-commerce.unit.test.ts apps/website/src/server/inbound/public-http/routes/commerce/__tests__/purchase.integration.test.ts
# 32 passed, 0 failed, 0 skipped. New attention suite has 9 tests.
npx eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/server/runtime/composition/commerce.ts apps/website/src/server/runtime/composition/tool-catalog-manifest.ts apps/website/src/server/inbound/public-http/routes/commerce/purchase.ts apps/website/src/contracts/core/tool-metadata/commerce.ts apps/website/src/contracts/core/tool-metadata/index.ts apps/website/src/assistant/host-contracts.ts
# Exit 0, no errors, one missing-else style warning in warmup.
npm --prefix packages/contracts run build
npx tsc -p tsconfig.json --noEmit
# Exit 2: exactly one error in unchanged deployment credential code, detailed below.
npx tsc -p tsconfig.tests.json --noEmit
# Fails with 54 diagnostics outside touched files; no touched-path diagnostics.
git diff 60049a5ae -- apps/website/src/features/deployments/publish-credentials/store.ts
# Empty: unrelated production typecheck error's source is unchanged from the supplied base.
```

The final Jini whole-workspace `pnpm --no-bail -r build` and subsequent Tovu relink both passed after all Jini code changes. Tovu production and broad test typechecks are **not globally green**; the exact failures are disclosed rather than suppressed.

## Cost and limits

- The existing operator adds one bounded unconfirmed scan per reconciliation pass. Unknown rows cannot be starved by abandoned checkouts. Successful unchanged sessions add no durable history/write per poll. Milestones are remembered in a bounded 1,000-entry in-memory map: restart or eviction can repeat a check. Exported one-shot `reconcileUnknown` remains stateless; scheduled hosts use the existing operator/cursor lifecycle. Provider/storage failures retain the existing retry cadence.
- Attention reads occur on status requests, without a new poll: four bounded scans plus at most twenty quarantined-payment lookups, and at most ten returned IDs. The list is bounded, not exhaustive. Site filtering prevents foreign-site ID exposure; other-site rows can occupy early scan batches in a shared database.
- Each blocked/not-succeeded outbox message adds one durable quarantine record before acknowledgement. No new table, migration, payment state, tool, service or product configuration was added. Existing quarantine scans gained a bound for the required status list.
- Alerts use at most 1,000 dedupe keys; restart/eviction can repeat a warning. Logs retain payment/order detail.
- Quarantine makes blocked fulfillment durable and visible. No new automatic fulfillment repair path or new resolution tool was added.

## Open findings

BUG N-M9: Separate site databases sharing a Stripe account still retry/dead-letter each other's events. Explicitly deferred by the owner.
BUG attention-list limitation: In a shared database, foreign-site rows can fill the bounded earliest scan batches before host filtering. The list remains site-safe but may omit another attention item. Listed, not expanded into new query machinery.
BUG unrelated production typecheck: Tovu `apps/website/src/features/deployments/publish-credentials/store.ts(410,88)` reports TS2322 (`string | undefined` assigned to `string`). That path has no diff from base `60049a5ae`; it was left unchanged per job scope. After rebuilding contracts, it is the only production typecheck diagnostic.
BUG broad test typecheck: `npx tsc -p tsconfig.tests.json --noEmit` reports 54 diagnostics outside touched files. No touched-path diagnostics remain; unrelated tests were not changed.
Minor lint findings: Existing no-inconsistent-returns warnings in the evidence writer and expression-complexity warning in the memory ledger; a missing-else style warning in Tovu warmup. Complexity/error checks pass; no eslint-disable was added.

## Required before any site enables commerce

Only fakes prove provider behavior here. With a real Stripe **test-mode** account and webhook endpoint version `2024-06-20`, verify:

1. Checkout Session creation, redirect/continuation, exact currency/amount, successful payment and return/cancel pages.
2. Signed webhook delivery, duplicate delivery and redelivery after restart/disable; original merchant/account/mode remains bound to old sessions.
3. Failed/expired checkout outcomes, delayed payment, missed-webhook retrieval, same-key replay without duplicate charge, and recoverable provider failures.
4. Unknown/expired manual resolution after independent dashboard verification: amount/mode/outcome on the real card, decline writes nothing, approval writes the authenticated audit, and settlement follows ledger evidence.
5. Owner status discovers stuck orders; blocked fulfillment remains quarantined before acknowledgement.

Also verify the actual production PostgreSQL settlement worker's ownership/drain behavior with pool capacity >=2; this job's pool test is a fake admission test. No site was enabled by this job.

## Branches and commits

Only `refs/heads/cloud/commerce` was pushed in either repository. These implementation/progress commits were pushed successfully; the final report-only commit is identified by the branch HEAD and final response.

### Jini

Branch: `cloud/commerce`; final implementation HEAD: `e25e8f6591fe3e880056b28e010eb74709e4c89f`.

- `4240ba19b` fix(commerce): pin payment API and webhook versions
- `cb6a5e3ec` fix(commerce): preserve checkout recovery and corrected prices
- `46784de35` refactor(commerce): keep merchant drain checks within complexity limit
- `31602f589` refactor(commerce): combine equivalent drain selections
- `3742bf1e5` fix(commerce): require human approval for payment resolution
- `027ee654c` fix(commerce): resolve expired sessions without provider access
- `4f3b1c36d` fix(db): expose registered session pool capacity
- `13a04f4f7` fix(commerce): bound abandoned checkout reconciliation
- `038a42054` style(commerce): align quarantined observation write
- `8d7f5c2f8` test(commerce): require pinned API version on payment retrieval
- `f27a3816c` fix(commerce): expose bounded settlement attention status
- `e25e8f659` fix(commerce): retry unsuccessful checkout reconciliation

### Tovu

Branch: `cloud/commerce`; final implementation HEAD: `752d876c3cc2d9141b785c190018b8963b43ca6e`.

- `9023c6220` fix(commerce): limit payment response to buyer fields
- `fcd0d6c2d` docs(commerce): record payment review fix progress
- `ae1691994` fix(commerce): retain settlement failures and require human resolution
- `ae800a3bd` test(commerce): verify recovery and settlement retry boundaries
- `752d876c3` fix(commerce): discover quarantined orders without payment rows

