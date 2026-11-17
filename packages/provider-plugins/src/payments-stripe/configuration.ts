import type { StripeProviderContext } from "./contract.js";

const HELPERS = ["paymentError", "moneyProblem"] as const;

/** A host registered the payments contract without the helpers the provider needs. Plain words; `details` is what Copy details shows. */
export class StripeProviderConfigError extends Error {
  readonly code = "payments_stripe_context_missing" as const;
  readonly details: string;
  constructor(required: { details: string }, _optional: Record<string, never> = {}) {
    super("The Stripe payment provider was started without the payment helpers it needs, so it cannot take payments. Restart the app; if this keeps happening, copy the details into a bug report.");
    this.name = "StripeProviderConfigError";
    this.details = required.details;
  }
}

/**
 * Reads the helpers the domain registered as `optional.context`, at initialize and never at the first payment.
 * @returns The two helpers, by reference.
 * @throws StripeProviderConfigError naming each helper that is absent or not a function.
 */
export function readStripeContext({ context }: { context: unknown }, _optional: Record<string, never> = {}): StripeProviderContext {
  const record = context !== null && typeof context === "object" ? context as Record<string, unknown> : {};
  const missing = HELPERS.filter(name => typeof record[name] !== "function");
  if (missing.length > 0) throw new StripeProviderConfigError({ details: `optional.context is missing: ${missing.join(", ")}` });
  return { paymentError: record.paymentError as StripeProviderContext["paymentError"], moneyProblem: record.moneyProblem as StripeProviderContext["moneyProblem"] };
}
