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
export * from "./contract/tokens.js";
export * from "./state/status.js";
export * from "./plugin-contribution.js";
export * from "./provider-module-guard.js";
