import { moneyProblem, paymentError } from "@jini-ai/commerce/payments/kernel";
import type { PaymentError, StripeProviderContext } from "../../contract.js";

/** The domain's own helpers: what a host hands the provider as `optional.context` in production. */
export const realHelpers: StripeProviderContext = { paymentError, moneyProblem };

/** Recording fakes of the two helpers. `paymentError` prefixes the message so a result is provably the helper's output. */
export function recordingHelpers(required: { problem?: string | null } = {}): {
  helpers: StripeProviderContext;
  calls: { paymentError: unknown[][]; moneyProblem: unknown[][] };
} {
  const calls = { paymentError: [] as unknown[][], moneyProblem: [] as unknown[][] };
  const helpers: StripeProviderContext = {
    paymentError: (...args): PaymentError => {
      calls.paymentError.push(args);
      const [{ code, message }, optional = {}] = args;
      return { code, message: `fake:${message}`, retryable: optional.retryable ?? false,
        ...(optional.providerStatus === undefined ? {} : { providerStatus: optional.providerStatus }) };
    },
    moneyProblem: (...args) => { calls.moneyProblem.push(args); return required.problem ?? null; },
  };
  return { helpers, calls };
}
