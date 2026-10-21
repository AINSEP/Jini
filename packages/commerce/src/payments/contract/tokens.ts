/**
 * @file Core DI tokens for the payments kernel (design: adopt `@jini-ai/core` `token`/`manyToken`
 * instead of a commerce-private registry). Providers are a MANY token: every loaded provider
 * plugin contributes one; the kernel builds its registry from all of them.
 */
import { manyToken, token } from "@jini-ai/core";
import type { PaymentProvider } from "./provider.js";
import type { PaymentsPort } from "./payments-port.js";
import type { PreChargeRiskPort } from "./risk.js";

export const PaymentProviderToken = manyToken<PaymentProvider, "commerce.payments.provider">({ id: "commerce.payments.provider" });
export const PaymentsPortToken = token<PaymentsPort, "commerce.payments.port">({ id: "commerce.payments.port" });
export const PreChargeRiskPortToken = token<PreChargeRiskPort, "commerce.payments.preChargeRisk">({ id: "commerce.payments.preChargeRisk" });
