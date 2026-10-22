/**
 * @file `@jini-ai/commerce/payments/kernel`: the generic payments kernel (design 2026-10-21) —
 * Money, the provider contract, the consumer `PaymentsPort`, evidence, the risk gate, the derived
 * status model and DI tokens. A separate entry from `./payments` because the legacy lipay
 * contracts there (`ports.ts`, `state-machine.ts`) reuse names like `PaymentProvider`; the two
 * converge when `lipay-plugin.ts` is split (L4).
 */
export * from "../money/money.js";
export * from "./contract/scope.js";
export * from "./contract/evidence.js";
export * from "./contract/provider.js";
export * from "./contract/payments-port.js";
export * from "./contract/risk.js";
export * from "./contract/alerts.js";
export * from "./contract/tokens.js";
export * from "./state/status.js";
export * from "./plugin-contribution.js";
export * from "./provider-module-guard.js";
export * from "./provider-registry.js";
// The payments ledger (L2): storage records, the `PaymentsLedger` port and its in-memory adapter.
// The SQL adapter and the migrations are in `./ledger/sql.ts`, not here: they load `kysely` and
// `@jini-ai/db` at runtime, both optional peers a provider plugin importing this entry lacks.
export * from "./ledger/rows.js";
export * from "./ledger/repo.js";
export * from "./ledger/repo.memory.js";
export * from "./accounting/plan-evidence.js";
export * from "./accounting/apply-evidence.js";
// Webhook ingest (L5): receive (verify + record), the inbox worker (apply) and the outbox relay.
export * from "./ingest/receive.js";
export * from "./ingest/worker.js";
export * from "./ingest/outbox-relay.js";
// The payments operations (L4): the consumer `PaymentsPort` service, the back-office operator port, money grants.
export * from "./ops/grants.js";
export { createPaymentsService, createPaymentsOperator, type PaymentsOperatorPort } from "./ops/service.js";
export type { PaymentsServiceOptional, PaymentsServiceRequired } from "./ops/deps.js";
export type { ReconcileCounts, ReconcileReport } from "./ops/reconciler.js";
export type { ResolveUnknownRequired, ResolveUnknownResult } from "./ops/operator.js";
