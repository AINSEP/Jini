# commerce-fix — final report

Status: all requested review findings implemented. Existing check failures remain explicitly open below. Commerce stays off by default.

Work began November 5, 2026 at 15:13 America/Los_Angeles (23:13 UTC); code and focused verification finished within the two-hour cap. Only cloud/commerce was pushed in Jini and Tovu. No merge of another branch, main push, force-push, tag, deployment, npm publication, live payment or owner-data operation.

## Branches and provenance

Read origin/cloud-plans-1105:cloud/jobs/COMMON.md, cloud/jobs/commerce-fix.md, cloud/plans/commerce-review.md, and both prior cloud/reports/commerce.md reports. Software-architect, programmer and TDD personas loaded from the plans archive. Findings were checked against actual code before implementation; none was rejected as false.

Bases were fetched origin/cloud/commerce: Jini c34aea4cd and Tovu 7d58e6a95. Verified remote code heads:
- Jini cloud/commerce: 8c7719a90e2f5d7de4c5622424d592fd0e22ec91.
- Tovu cloud/commerce: 4252dee2ce15e03b56af509ba268f2e6b7039d4b.

Every code checkpoint below was successfully pushed. Initial H2 pushes encountered transient fatal error in commit_refs; subsequent pushes included that commit and succeeded. Every Git push was preceded by pull/rebase. Clean detached worktrees were used while independent workers still edited the working branches.

The execution environment disconnected during the final report-save command. No code was lost: the GitHub connector independently confirmed both code heads above. This final report was therefore saved through the GitHub contents API on the already-authorized cloud/commerce branches using the current report blob SHA. Final report commit IDs are returned in the final response. Local disposable PostgreSQL cleanup and optional output-file copy could not be confirmed after disconnect.

## Pushed code commits, oldest first

Jini, all on cloud/commerce:
- 9cd8fdc9be8b153492eb72683271ff114c00a4d2 refactor(commerce): own settlement scheduling and merchant drain in engine
- 95df51af3c8e6618554b8e549880f445a859d3b3 fix(commerce): recover stale payments and preserve merchant settlement scope
- 7a76b6c1de53503e5d2ac0084558270f5a49b856 fix(commerce): bound storefront reads and expose accurate buyer and owner state
- 8c7719a90e2f5d7de4c5622424d592fd0e22ec91 refactor(commerce): share deployed endpoint hostname policy

Tovu, all on cloud/commerce:
- ccffa68af8793b6e30c35b25af9f6b5286d30a40 test(commerce): cover dormant storefront and catalog boundaries
- cc7af578b40270b9e9c68e2170e583fa9a81109e fix(commerce): preserve dormant CMS routes and delegate settlement policy
- a24d56fd36119420ed5b055d3c91e2509d2f2412 fix(commerce): acknowledge alerted settlement mismatches and continue relay
- 7ca34871b4336c911db0cda647f3c552e1f912b0 fix(commerce): refresh provider leases and prepare changed merchant configuration
- df7f6c57e4f62c575f7b01bc40d5368b957ee4f3 fix(commerce): share request readiness and render owned purchase status
- 4252dee2ce15e03b56af509ba268f2e6b7039d4b test(commerce): verify composed provider status and shared origin policy

## Each finding

| ID | Result and reason |
| --- | --- |
| H1 | Fixed: commerce-off product paths call next, preserving real CMS pages including nested paths. Real HTTP regression first returned404, now200. |
| M1 | Fixed: disabled drain runs payment migrations only and projects only when catalog exists. Payment-only restart keeps catalog absent and outbox queued; existing active-catalog drain still works. |
| M2 | Fixed: generic settlement ownership/scheduling and merchant-drain policy moved into Jini with direct tests. Ledger owns hasOpenPayment/findOpenPayment and one IntentStatus-typed open list. Tovu keeps timer/owner-lock/kernel adapters. Hostname policy moved into existing Jini platform endpoint-policy module; Tovu origin logic now composes Jini functions. |
| H2 | Fixed: alerted blocked/not_succeeded outcomes acknowledge messages; only thrown storage/alert failures stop delivery. Real SQL host test puts a blocked message before a valid payment and proves the later order becomes paid. |
| H3 | Fixed: existing bounded cursor scan includes pending/requires_action older than15min. Retrieve evidence uses the single writer. Tests cover missed paid/expired webhooks, grace, cursor progress and mode isolation. |
| H4 | Fixed using authorized owner-resolution alternative: three persisted replay attempts span provider retention. commerce_resolve_unknown accepts orderId/outcome/verification reason, authorizes before lookup, derives stored original scope, uses authenticated actor and commits resolution plus audit together. Expired ambiguous outcomes remain unknown until owner verification; verified failed resolution enables existing new-order behavior. A lost initial response may hide a provider-created session, so no unsupported automatic no-charge inference or unsafe fresh-order offer was added. |
| H5 | Fixed with requested newest-price-replaces-older choice: new active price atomically archives prior active prices under product lock. New checkout rejects archived IDs; existing order snapshots and started-order payment amounts survive. No archive tools added. |
| H6 | Fixed: bindings resolve from current provider leases per lookup. Direct context test plus real host/lease/sealed-settings fixture prove configuration-before-keys recovers without restart. |
| M3 | Fixed: deterministic scoped lookup; accepted webhook scopes include open rows and configured scope. Abandoned requires_action sessions release mode changes. Account switches sharing the exact provider/mode endpoint remain blocked until old work settles because that path cannot distinguish accounts safely. Removed settings reconstruct original drain from stored snapshot. Host tests cover SQLite/PGlite. |
| M4 | Fixed: one scoped product ID/slug point query works beyond24-item grid. Priceless rows no longer consume grid slots. Existing setup tools warn beyond24 active products via bounded25-row read. No pagination. |
| M5 | Fixed: one GET readiness/origin snapshot serves guard, point lookup and purchase controls. POST forRequest closure shares binding/readiness across origin/admission/action; no global cache. Host regression asserts one provider-config read. Final activation checks before money remain. |
| M6 | Fixed: enabled binding resolution prepares server, including runtime enable/configuration changes. Regression first ready=false, now recovers without setup tool/restart. |
| M7 | Fixed: themed private return/cancel HTML, including signed-out status and shop link. GET order API allowlist omits scope/provider references/next. POST pay retains continuation. URL claims never confirm payment. |
| M8 | Fixed: lock key includes workspace/site as JSON tuple. Ownership rejects pools smaller than2 before reserving connection; ordinary max1 queries remain supported. Unit and native PostgreSQL tests prove isolation/capacity. |
| M9 | Fixed: current provider discovery injected; retired lipay port removed; reconciliation availability follows checkout.ready. Composed host status test checks provider/runtime facts. Real regressions cover H2/H3/H4/H6. Requested old parity/tsc checks rerun honestly. |
| M10 | Fixed: retired executable fixtures and fixture-only tests removed; historical manifests retained/directly tested. Removed unused contributor, dead status constant/port and obsolete browser-markup fallback. Off boot probes named tables instead of all-table metadata. Existing unrelated assertions/rules/goldens remain intact. |

## Focused verification and exact commands

Commands ran inside container with source /workspace/.tovu-build/env.sh. Local listeners used sandbox network permission. No live provider credentials.

Setup repaired stale installed links/build outputs using a copied writable pnpm store:
```sh
# Jini root
CI=true pnpm --store-dir /workspace/work/pnpm-store install --ignore-scripts --frozen-lockfile --fetch-retries=0
pnpm -r --no-bail --workspace-concurrency=2 --if-present run build
# Tovu root
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
```
Recursive build passed after repair. Final commerce, DB and platform build/typecheck commands passed.

Jini packages/commerce main affected run:292/292, including native PostgreSQL recovery:
```sh
COMMERCE_PG_URL='postgresql://agent@localhost/postgres?host=%2Ftmp&port=5432' ./node_modules/.bin/vitest run -c vitest.kernel.config.ts src/catalog/__tests__/unit/repo.vitest.test.ts src/catalog/__tests__/unit/repo.storefront.vitest.test.ts src/catalog/__tests__/unit/catalog-tools.vitest.test.ts src/catalog/__tests__/unit/status-tools.vitest.test.ts src/catalog/__tests__/unit/buyer-order.vitest.test.ts src/catalog/__tests__/unit/merchant-drain-ledger.vitest.test.ts src/browser/__tests__/checkout.vitest.test.ts src/payments/__tests__/kernel/provider-contexts.vitest.test.ts src/payments/ledger/__tests__/open-payments.vitest.test.ts src/payments/ledger/__tests__/memory.vitest.test.ts src/payments/ledger/__tests__/sqlite.vitest.test.ts src/payments/ops/__tests__/intent-recovery.vitest.test.ts src/payments/ops/__tests__/reconciler-stale.vitest.test.ts src/payments/ops/__tests__/reconciler.vitest.test.ts src/payments/ops/__tests__/operator.vitest.test.ts src/payments/tools/__tests__/resolve-unknown.vitest.test.ts --maxWorkers=1 --minWorkers=1
```
Final drain guard refinement additionally passed its1-case focused test and host4-case integration suite. Direct Jini tests passed9+6+3+2:
```sh
# Jini packages/commerce
node --import tsx src/payments/ingest/__tests__/settlement-worker.unit.test.ts
node --import tsx src/catalog/__tests__/unit/merchant-drain.unit.test.ts
node --import tsx src/catalog/__tests__/unit/status-tool.unit.test.ts
node --import tsx src/catalog/__tests__/unit/status.unit.test.ts
./node_modules/.bin/vitest run -c vitest.kernel.config.ts src/catalog/__tests__/unit/merchant-drain-ledger.vitest.test.ts --maxWorkers=1 --minWorkers=1
```

Jini packages/platform adjacent hostname policy tests131/131:
```sh
node /workspace/Jini/node_modules/vitest/vitest.mjs run src/net/__tests__/endpoint-policy.boundaries.test.ts src/net/__tests__/endpoint-policy.contract.test.ts src/net/__tests__/endpoint-policy.parity.test.ts --maxWorkers=1 --minWorkers=1
npm run build
npm run typecheck
```

Jini packages/db ownership unit4/4 and native4/4:
```sh
node /workspace/Jini/node_modules/vitest/vitest.mjs run src/__tests__/kernel-session-lock.test.ts --maxWorkers=1 --minWorkers=1
COMMERCE_PG_URL='postgres://agent@localhost/postgres?host=/tmp&port=5432' node /workspace/Jini/node_modules/vitest/vitest.mjs run -c vitest.postgres.config.ts src/__tests__/kernel-session-lock.postgres.test.ts --maxWorkers=1 --minWorkers=1
```

Tovu final combined focused run47/47:
```sh
node --import tsx --test --test-concurrency=1 apps/website/src/server/runtime/composition/__tests__/commerce-composition.unit.test.ts apps/website/src/server/runtime/composition/__tests__/commerce.integration.test.ts apps/website/src/server/runtime/composition/__tests__/commerce-http.unit.test.ts apps/website/src/server/inbound/public-http/routes/commerce/__tests__/purchase.integration.test.ts apps/website/src/server/inbound/public-http/routes/site/__tests__/products.route.test.ts apps/website/src/server/inbound/public-http/routes/site/__tests__/product-checkout.unit.test.ts
```

Additional exact commands/results:
```sh
# Tovu: settlement3/3 dialects, real SQL/signed webhook, fake outbound HTTP.
COMMERCE_PG_URL='postgresql://agent@localhost/postgres?host=%2Ftmp&port=5432' node --import tsx apps/website/src/server/inbound/public-http/routes/commerce/__tests__/settlement.integration.test.ts
# Tovu: composed provider status assertion1/1.
node --import tsx --test-name-pattern='configuration before provider keys' apps/website/src/server/runtime/composition/__tests__/commerce.integration.test.ts
# Tovu: origin2/2, historical manifest2/2, request-cost15/15.
node --import tsx apps/website/src/server/runtime/composition/__tests__/commerce-origin.unit.test.ts
node --import tsx apps/website/src/features/plugins/lipay/__tests__/manifest.test.ts
node --import tsx apps/website/src/server/__tests__/routes/request-cost-cacheability.measurement.test.ts
# Jini root, all passed:
npm --prefix packages/commerce run build
npm --prefix packages/commerce run typecheck
npm --prefix packages/db run build
npm --prefix packages/db run typecheck
npm --prefix packages/platform run build
npm --prefix packages/platform run typecheck
```

Strict ESLint on every changed production file used --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'. Zero errors; one existing memory-ledger expression-complexity warning at line151. git diff --check passed. No full test suite run.

Failing tests preceded bug fixes. Setup failures were distinguished from bug reproduction. New real-theme HTTP tests import the existing isolated-home helper; final combined47/47 passes under node test runner. Deletions are M10-authorized retired fixtures/fixture-only tests plus test of removed cached-markup fallback. No surviving assertion, coverage scope/threshold, lint rule or golden was weakened.

## Open checks and limits

BUG: Tovu node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit still fails only at unchanged apps/website/src/features/deployments/publish-credentials/store.ts:410: optional string used as required ID. File unchanged from commerce base; final rerun confirmed same sole error.

BUG: node --import tsx apps/website/src/server/inbound/public-http/routes/site/__tests__/commerce-strip-parity.test.ts passes7/9; old golden assertions omit owner_recovery_codes. Point-lookup fixture adapted, original assertions retained, product route test passes. Goldens unchanged.

BUG: node --import tsx apps/website/src/server/runtime/composition/__tests__/commerce-data-retention.integration.test.ts passes2/3; populated archive assertion differs on SQL identifier spelling/backticks. Rows/objects retained; test unchanged. No schema migration added.

BUG: DB adjacent node /workspace/Jini/node_modules/vitest/vitest.mjs run src/__tests__/postgres-driver.test.ts --maxWorkers=1 --minWorkers=1 passes8/9; unchanged idle-close warning assertion line131 failed twice with no progress, so stopped per COMMON. Not claimed as proven baseline failure; unresolved. Session-lock suites independently pass.

Observed warning: existing charts-recharts integrity warnings during host fixtures; rendering assertions pass. Left outside scope.

Prior report also lists existing native PostgreSQL listOpenAttempts({ops:[]}) IN() issue; no unrelated query fix/new native empty-list parity claim.

Provider retrieve/replay/expiry/retry identity/key attachment behavior proven only against scripted/fake transport. Tests exercise real provider module/lease wiring, signed raw webhook, sealed settings and real SQLite/PGlite/native PostgreSQL where noted. Live-provider acceptance/deployed callback reachability/production credentials were not exercised.

## State cost

Off boot: two named-table metadata probes, no catalog DDL/provider HTTP/recurring timer absent durable work. Active/draining worker: at most cycle/5sec, <=25 inbox and <=25 outbox, one native ownership connection plus spare. Reconcile retains3 bounded categories x2 modes/minute, <=10 candidates each; stale sessions join payment category after15min. Replay capped3 across retention.

Transition drain selection returns <=2 payment candidates plus one credential-free attempt snapshot. Accepted webhook adds one scoped open-payment lookup. Product detail uses one product/price point query plus one request readiness/provider-config snapshot; grid<=24 product/price results in2 reads. Setup warnings add<=25 summaries per invocation. Owner resolution uses one association lookup plus existing audited writer transaction, no provider HTTP. Buyer pages add normal theme/title reads and HTML document. No new poll/table/user configuration option/framework.

Existing session ownership still requires session-capable PostgreSQL connections; transaction-mode poolers are not newly supported.
