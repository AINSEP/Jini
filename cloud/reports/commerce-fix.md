# commerce-fix — in progress

Branch cloud/commerce; base origin/cloud/commerce. Work began 2026-11-05 23:13 UTC; cap 2 hours.

M2: generic settlement ownership/scheduling state machine and merchant-drain selection moved from Tovu into Jini. Ledger owns deterministic scoped findOpenPayment/hasOpenPayment with one IntentStatus-typed list. Direct worker/policy tests retained in Jini. Open-payment tests failed before implementation and pass for memory and SQLite.

Validation: `npm --prefix packages/commerce run build` passes. `cd packages/commerce && ./node_modules/.bin/vitest run -c vitest.kernel.config.ts src/payments/ledger/__tests__/open-payments.vitest.test.ts --maxWorkers=1 --minWorkers=1` passes 2. `node --import tsx src/payments/ingest/__tests__/settlement-worker.unit.test.ts` passes 9; `node --import tsx src/catalog/__tests__/unit/merchant-drain.unit.test.ts` passes 6 after correcting copied import path.

Required recursive baseline build attempted; provider-plugins build failed; diagnosis in progress. No live provider or live data used. Other findings remain in progress.

Progress checkpoint: H2 host regression passes blocked-first then valid-paid projection. H3/H4 focused 81 tests pass (fake provider, memory/SQLite); stale requires_action/pending retrieve after15min, replay attempts spread across retention window, existing audited resolveUnknown exposed as owner tool keyed by order. Expired ambiguous rows require owner verification before buyer new-order offer; no unsafe inference of failed money movement. H5 price correction atomically archives old active price; H6 per-resolution bindings recover after keys attach; focused 27 Jini tests pass. M3 deterministic scoped endpoints and abandoned-session merchant transition, M6 runtime preparation regressions pass in SQLite. M4–M10 in progress.

Dependency snapshot repaired with a writable copied pnpm store and `CI=true pnpm --store-dir /workspace/work/pnpm-store install --ignore-scripts --frozen-lockfile --fetch-retries=0`; recursive build rerun completed. Full Tovu tsc earlier was blocked by stale later Jini package outputs; rerun after rebuild pending. No live provider claims.
