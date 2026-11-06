# Commerce cloud job — 2026-11-05

Status: PARTIAL, blocked by execution-environment loss. Stages 2–5 feature work and focused verification were committed and pushed. The final Jini-first relocation of reusable worker/drain logic was written locally but remains uncommitted and unverified. Do not treat that relocation as delivered.

Instructions used: Jini `origin/cloud-plans-1105:cloud/jobs/COMMON.md`, `cloud/jobs/commerce.md`, `cloud/plans/C-commerce-plan-result.md`, and `cloud/plans/TRIM.md`. The commerce job explicitly authorizes stages 2–5 and overrides the trim hold. Exact bases: Jini `6f507852d`, Tovu `e327c07c8`. Only `cloud/commerce` was pushed in either repository. No main push, force-push, merge, deployment, npm publication, live payment, or owner-data operation occurred.

The shell disconnected around 11:41 AM PST. `exec_command` then reported “No usable execution environment is available”; `wait_for_environment` reported that the environment was neither ready nor starting. The managed status endpoint still reported running/connected, which did not restore shell access. Reports were therefore saved through the GitHub contents API on the already-authorized branches. The two-hour hard stop is 12:48 PM PST (20:48 UTC).

Delivered behavior:

- Durable credential-free intent dispatch snapshots, original provider idempotency/correlation keys and callback URLs, atomic concurrent recovery claims, at most three recovery attempts, and provider-defined replay retention (Stripe: 23 hours). Recovery completion and evidence application commit atomically. Legacy rows without a snapshot remain visibly unresolved; provider extras and snapshots above 16 KiB are not eligible for automatic replay.
- Dormant `@jini-ai/agent-plugins/commerce` payload and Node server subpath, with no Stripe-plugin import. Existing provider leases, sealed settings and versioned activation readers are reused. Catalog setup/status tools use existing authorization.
- Activation-only eight-table catalog migration through the existing ADR-066 runner, with its own migration history. New indexes coexist with archived index identities; money columns use BIGINT for safe numeric parity. Historical migration checksums and legacy rows are preserved.
- Authenticated pending-order creation and payment/resume of the same owned order. Workspace/member/account/mode and return URLs are host-controlled. Purchase requests must originate at the configured deployed shop; desktop product views link there. Return/cancel pages read ledger truth.
- Raw signed webhooks before JSON parsing, durable inbox/outbox processing and idempotent order projection. One database owner schedules settlement; native PostgreSQL uses a dedicated session lock with liveness checks, while local stores use the existing owner lock. Disable stops new purchases and retains settlement drain, including restart and late-webhook wake-up.
- A bounded two-query storefront (at most 24 product/price summaries), currency-aware display, and a small shared checkout script. Double submission, uncertain outcomes and reloads retain the order ID. Unavailable/definitively failed orders offer an explicit new-order action; no automatic fresh charge follows a timeout or 5xx.
- Legacy store/payment executable modules and the demo store route moved intact into test fixtures. All test assertions remain; historical manifests and namespace/portability declarations remain in production.

Verification completed before the uncommitted relocation:

| Check | Result |
| --- | --- |
| Jini full recursive workspace build after repairing installed dependencies | PASS |
| Subsequent commerce build, agent-plugins typecheck, DB build/typecheck | PASS |
| Affected commerce payments tests | 436/436 PASS |
| Real PostgreSQL recovery plus memory/SQLite cases | 22/22 PASS, including 7 PostgreSQL cases |
| Stripe kernel/provider/currency tests | 85/85 PASS |
| Catalog/server/setup/status/origin tests | 53 PASS |
| Checkout browser tests | 18 PASS |
| Storefront projection/mapping/money tests | 16 + 12 + 6 PASS |
| Plugin isolation / manifest validation / payload dry run | 2 PASS / 1 PASS / four payload files, zero test files |
| Tovu purchase + signed settlement HTTP tests | 10/10 PASS across SQLite, PGlite and PostgreSQL 17 |
| Actual host activation/restart/merchant-transition integration | 2/2 PASS across SQLite/PGlite |
| Additional host/provider/worker/settings/drain/origin tests | 66 PASS |
| Catalog migration, archive coexistence and >int32 money | 3/3 PASS across SQLite/PGlite/PostgreSQL |
| Migration checksum tests | 4/4 PASS |
| Tool-catalog integration / purchase markup gates | 2 PASS / 5 PASS |
| Retired plugin and route tests | Five plugin test files PASS; 8 route tests PASS |
| Changed production function complexity/cognitive complexity <=10 | PASS |
| Full Tovu TypeScript check | FAIL only at unchanged publish-credentials/store.ts:410 |

No tests, rules or checks were disabled, skipped, deleted or weakened to produce these results. Updated product fixtures use the new catalog adapter; retired-runtime tests use the unchanged moved fixture implementations.

Principal commands (run in the container; PostgreSQL was disposable and local):

```sh
# Initial user command, then explicit tracking ref because the checkout's fetch refspec is narrow.
git -C /workspace/Jini fetch origin cloud-plans-1105
git -C /workspace/Jini fetch origin cloud-plans-1105:refs/remotes/origin/cloud-plans-1105
git -C /workspace/Jini show origin/cloud-plans-1105:cloud/jobs/COMMON.md
git -C /workspace/Jini show origin/cloud-plans-1105:cloud/jobs/commerce.md

# Setup scripts specified by COMMON were absent. Installed snapshot links were incomplete.
# pnpm 10.33.2 was installed in a workspace-local npm cache; pnpm 11 is incompatible.
# The pnpm store was copied to /workspace/work/pnpm-store because the default store is read-only.
cd /workspace/Jini
CI=true PATH=/workspace/work/npm-cache/_npx/ed17c428e728397e/node_modules/.bin:$PATH pnpm --store-dir /workspace/work/pnpm-store --cache-dir /workspace/work/pnpm-cache install --ignore-scripts --no-frozen-lockfile --fetch-retries=0
PATH=/workspace/work/npm-cache/_npx/ed17c428e728397e/node_modules/.bin:$PATH pnpm -r --workspace-concurrency=2 --if-present run build
npm --prefix packages/commerce run build

cd /workspace/Tovu
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
npm --cache /workspace/work/npm-cache run agent-plugins:compose
npm --prefix packages/contracts run build
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
COMMERCE_PG_URL=postgres://postgres@127.0.0.1:55432/commerce_test node --import tsx --test apps/website/src/server/inbound/public-http/routes/commerce/__tests__/purchase.integration.test.ts apps/website/src/server/inbound/public-http/routes/commerce/__tests__/settlement.integration.test.ts

cd /workspace/Jini/packages/commerce
./node_modules/.bin/vitest run -c vitest.kernel.config.ts src/payments/ledger/__tests__/migrations.vitest.test.ts src/payments/ledger/__tests__/rows.vitest.test.ts src/payments/ledger/__tests__/memory.vitest.test.ts src/payments/ledger/__tests__/sqlite.vitest.test.ts src/payments/ops/__tests__ src/payments/__tests__/kernel/provider-contract.vitest.test.ts src/payments/__tests__/kernel/provider-module-guard.vitest.test.ts --maxWorkers=2 --minWorkers=1
COMMERCE_PG_URL='postgres://postgres@127.0.0.1:55432/commerce_test?options=-csearch_path%3Dcommerce_payment_recovery' ./node_modules/.bin/vitest run -c vitest.kernel.config.ts src/payments/ops/__tests__/intent-recovery.vitest.test.ts --maxWorkers=1 --minWorkers=1
COMMERCE_PG_URL='postgres://postgres@127.0.0.1:55432/commerce_test?options=-csearch_path%3Dcommerce_payment_recovery' ./node_modules/.bin/vitest run -c vitest.kernel.config.ts src/payments/ledger/__tests__/postgres.vitest.test.ts --maxWorkers=1 --minWorkers=1

cd /workspace/Jini/packages/provider-plugins
node /workspace/Jini/node_modules/vitest/vitest.mjs run src/payments-stripe/__tests__/payments-stripe-kernel.test.ts src/payments-stripe/__tests__/provider.test.ts src/payments-stripe/__tests__/amount.test.ts --maxWorkers=2 --minWorkers=1
```

Further focused commands were direct `node --import tsx <test-file>` runs for Tovu's commerce worker, settings, drain, origin, composition and provider-host files; Vitest with `-c vitest.kernel.config.ts` for commerce catalog/browser/money files; and ESLint with `--no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'` on changed production files. The final relocation's additional direct Jini tests/build command did NOT start after the transport disconnected; no success is claimed for it.

Observed failures left open, each independently:

- Existing PostgreSQL ledger `listOpenAttempts({ops:[]})` emits `IN ()`; the ledger contract passed 54/55. Recovery cases all passed. No unrelated query fix was made.
- Existing Tovu TypeScript error: `apps/website/src/features/deployments/publish-credentials/store.ts:410`, optional string passed as a required ID. The file is unchanged from the base.
- Existing stage-1 retention snapshot normalizes SQLite's renamed double-quoted identifiers but leaves expected backticks. The populated-archive case fails on SQL spelling only; rows, indexes, references, bookkeeping and archive names show no difference. Historical migration/test files were not changed.
- Existing commerce-strip parity goldens omit `owner_recovery_codes`, already present in base migration 0039. Two parity assertions remain failing; goldens were not weakened.
- Route fixtures emitted unrelated charts-recharts integrity warnings. Product rendering assertions passed.
- Real deployed HTTPS callback reachability and live provider acceptance were not exercised; deployments/live data were forbidden and no real payment credentials were used.

Final unfinished work in the detached workspace:

- Jini `packages/commerce/src/payments/ingest/settlement-worker.ts`: reusable scheduling/ownership state machine, with injected ports; `payments/kernel.ts` export.
- Jini `packages/commerce/src/catalog/merchant-drain.ts`: reusable original merchant query/selection and configuration shape; `catalog/repo.ts` export.
- Tovu `commerce-worker.ts` reduced to the local owner-lock/timer adapter, `commerce-drain.ts` reduced to reexports, and `commerce-settings.ts` aliases the generic configuration type.
- A disabled-drain migration guard in Tovu composition was being tightened so an existing payments ledger does not create an absent catalog while commerce is off.
- These local edits were not committed, built or tested after relocation. Prepared direct Jini test files in the failed tool call were not persisted. Inspect the actual diff before continuing.

Resume by restoring the SAME execution environment, checkpointing those explicit paths, then building Jini commerce before Tovu tests (new exports are otherwise absent). Pull/rebase `origin cloud/commerce` before pushing; this report was committed remotely while the local shell was unavailable. Rerun the retained worker/drain/composition assertions, direct Jini engine/SQL tests, touched-package TypeScript and complexity checks. Update this report and push only `cloud/commerce`. Cleanup of disposable Docker container `commerce-pg-1105` could not be confirmed after disconnect; stop it on resume. No production service was deployed.

State cost, before relocation (the move preserves it): default-off does one settings-definition ensure, versioned activation read and table metadata probe, with no commerce DDL, credentials, provider HTTP or recurring timer. Active/draining ownership runs at most once/5 seconds, with <=25 inbox rows and <=25 outbox rows per cycle and one PostgreSQL liveness probe. Reconciliation scans 3 bounded categories x2 modes/minute, <=10 rows each (<=60 candidates; current intent subset <=20). Merchant transitions/restarts read <=1 pending scope/snapshot; unchanged configuration skips that query. PostgreSQL reserves one pool connection and needs pool capacity >=2. First buyer submission makes order+pay calls; retries make only pay, with one small sessionStorage write and no UI polling. Payload budgets are design estimates, not measured traffic.

Pushed code head for Jini: `e6145ebf19862acfc116ca31cb6e09b294621bfd` on `cloud/commerce`. The report itself is a later documentation commit.

All pushed code commits in Jini for this job, oldest first:

- `63d656b26b43ae513bc1bed8e7c4e5af10e9f855` feat(commerce): recover unknown intents with original provider keys
- `28cbe98ac27a3765e4414cc97289070020a979d8` feat(commerce): add dormant plugin and owned order server
- `dd16d5fb38b1872980c04f87ab30ac8a434e6489` feat(commerce): add bounded storefront projection and currency display
- `281b362203777603ea834eb9a1bdcb5593d8b7c2` test(commerce): verify storefront currency precision
- `56bc6fab6b6fb8caffebddc7b838da9b3028ad9b` feat(commerce): add authorized catalog setup tools
- `686b60078987a8dc491cb146f4c7f3a045650c0f` feat(db): serialize background owners with pooled session locks
- `c52f4c527b31c794386b8a550b70b543c4d3ab07` fix(commerce): commit recovered evidence with attempt completion
- `0eb9152021488321c5571a204a897868690cf51f` fix(commerce): preserve status envelope with checkout readiness
- `672daa2b9e8f52d9a4e7fa5aa764965f48ec5c89` feat(commerce): add resumable buyer checkout browser behavior
- `7aa5deddc1299e47aec35ef8ba31d81cc9607c82` test(commerce): verify intent recovery on isolated PostgreSQL schemas
- `c1ae4f2e1e8a0375f5d9f92364f0bee9b0096ad6` fix(commerce): bind checkout forms only once
- `f4d4430b7a4e770f71b7c5f513fea0bb06415746` fix(commerce): exclude plugin tests from published payload
- `5adfe3d0441c17478874899f1e6c69a65e03a429` chore(commerce): lock optional server peer dependency
- `6c9ab47ff44be78292d337353c2720489c69deff` fix(db): detect lost background owner sessions without process crashes
- `b728f189256453a74eee06064c9e3544ae98b719` docs(commerce): clarify status readiness and read-only effects
- `d7c69a3cf4dd8889594051217418299dfa161fd4` fix(commerce): preserve owned ledger reads across merchant changes
- `1fe2fd5c33fecb11b46f3d7670ca027f6d280ea8` fix(commerce): offer explicit recovery for unavailable or declined orders
- `aabba6f2d89a6dd5ac39f165f1a6a7b9a4f56ca9` feat(commerce): expose trusted callback address and setup guidance
- `2945b9143fd173941f7b3896218019e51c2ac06f` feat(commerce): share normalized HTTPS origin policy with hosts
- `e6145ebf19862acfc116ca31cb6e09b294621bfd` docs(db): clarify background session owner pool and probe contract
