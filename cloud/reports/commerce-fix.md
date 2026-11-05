# commerce-fix — in progress

Branch cloud/commerce; base origin/cloud/commerce. Work began 2026-11-05 23:13 UTC; cap 2 hours.

M2: generic settlement ownership/scheduling state machine and merchant-drain selection moved from Tovu into Jini. Ledger owns deterministic scoped findOpenPayment/hasOpenPayment with one IntentStatus-typed list. Direct worker/policy tests retained in Jini. Open-payment tests failed before implementation and pass for memory and SQLite.

Validation: `npm --prefix packages/commerce run build` passes. `cd packages/commerce && ./node_modules/.bin/vitest run -c vitest.kernel.config.ts src/payments/ledger/__tests__/open-payments.vitest.test.ts --maxWorkers=1 --minWorkers=1` passes 2. `node --import tsx src/payments/ingest/__tests__/settlement-worker.unit.test.ts` passes 9; `node --import tsx src/catalog/__tests__/unit/merchant-drain.unit.test.ts` passes 6 after correcting copied import path.

Required recursive baseline build attempted; provider-plugins build failed; diagnosis in progress. No live provider or live data used. Other findings remain in progress.
