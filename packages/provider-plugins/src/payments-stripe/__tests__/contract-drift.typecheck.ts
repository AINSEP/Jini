/**
 * Two-way drift guard (a type-level check; `tsc` runs it through `pnpm typecheck`). The plugin's structural copy of the
 * commerce provider port (`../contract.ts`) must neither be narrower nor wider than the domain's: each member is asserted
 * `Local extends Domain` AND `Domain extends Local`. A plugin cannot import the domain, so the proof lives here, in a test
 * file, which may. It is not runtime code and nothing imports it.
 */
import type * as Domain from "@jini-ai/commerce/payments/kernel";
import type { paymentsProviderContract } from "@jini-ai/commerce/payments/kernel";
import type * as Local from "../contract.js";

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type PaymentContractDrift = [
  Assert<Mutual<Local.Money, Domain.Money>>,
  Assert<Mutual<Local.PaymentMode, Domain.PaymentMode>>,
  Assert<Mutual<Local.ProviderAccountScope, Domain.ProviderAccountScope>>,
  Assert<Mutual<Local.ProviderPaymentStatus, Domain.ProviderPaymentStatus>>,
  Assert<Mutual<Local.NextAction, Domain.NextAction>>,
  Assert<Mutual<Local.RefundEvidence, Domain.RefundEvidence>>,
  Assert<Mutual<Local.DisputeEvidence, Domain.DisputeEvidence>>,
  Assert<Mutual<Local.PaymentEvidence, Domain.PaymentEvidence>>,
  Assert<Mutual<Local.WebhookFact, Domain.WebhookFact>>,
  Assert<Mutual<Local.PaymentErrorCode, Domain.PaymentErrorCode>>,
  Assert<Mutual<Local.PaymentError, Domain.PaymentError>>,
  Assert<Mutual<Local.Outcome<Local.PaymentEvidence>, Domain.Outcome<Domain.PaymentEvidence>>>,
  Assert<Mutual<Local.ProviderCapabilities, Domain.ProviderCapabilities>>,
  Assert<Mutual<Local.ProviderContext, Domain.ProviderContext>>,
  Assert<Mutual<Local.IntentRequest, Domain.IntentRequest>>,
  Assert<Mutual<Local.RefundRequest, Domain.RefundRequest>>,
  Assert<Mutual<Local.PaymentProvider, Domain.PaymentProvider>>,
  // The helpers the domain's contract registration hands the factory as `optional.context`.
  Assert<Mutual<Local.StripeProviderContext, typeof paymentsProviderContract.context>>,
];
