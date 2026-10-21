/**
 * @file `@jini-ai/commerce/payments/tools`: the payments agent tools (lot L7). Two read tools and
 * three human-approved money-moving tools over the consumer `PaymentsPort`.
 *
 * A universal entry: it imports `@jini-ai/core` and pure commerce modules only, and reaches the
 * node-side payments service solely through the injected `PaymentsPort`/`MoneyGrantPort`.
 */
import { buildDomainRegistrations, indexCatalogById, type DerivedRiskByToolId, type ToolRegistration } from "@jini-ai/core";
import {
  PAYMENTS_TOOL_IDS, PAYMENTS_TOOLS_CATALOG_MODULE, PAYMENTS_TOOLS_DOMAIN, paymentsToolCatalog, paymentsToolsDerivedRisk,
} from "./catalog.js";
import { resolveToolsDeps, type PaymentsToolsOptional, type PaymentsToolsRequired } from "./deps.js";
import { moneyToolHandlers } from "./money-tools.js";
import { getPaymentHandler, listProvidersHandler } from "./read-tools.js";

export {
  DEFAULT_PAYMENTS_TOOL_PERMISSIONS, PAYMENTS_TOOL_IDS, PAYMENTS_TOOLS_DOMAIN, paymentsToolCatalog, paymentsToolsDerivedRisk,
  type PaymentsToolPermissions,
} from "./catalog.js";
export {
  DEFAULT_GRANT_TTL_MS, type PaymentApprovalDescription, type PaymentsToolRefusal, type PaymentsToolRefusalReason,
  type PaymentsToolsOptional, type PaymentsToolsRequired,
} from "./deps.js";
export type { MoneyToolResult } from "./money-tools.js";

/**
 * Builds the five registrations behind core's build-time gates (risk corroboration, schemas, the
 * human-confirmer rule, the unwired-entry tripwire).
 * @param required - Payments port, grant minter, run scope resolver, permission evaluator, approval transport, clock, key source.
 * @param optional.grantTtlMs - Grant lifetime (default 120 000 ms).
 * @param optional.permissions - Host permission names (default `commerce.payments.read` / `.manage`).
 * @throws {RangeError} On a non-positive `grantTtlMs`; {Error} from the registration gates on a blank permission.
 * @example buildPaymentsToolRegistrations({ payments, grants, scopeFor, authorize, askHuman, now: Date.now, newIdempotencyKey: randomUUID });
 */
export function buildPaymentsToolRegistrations(required: PaymentsToolsRequired, optional: PaymentsToolsOptional = {}): ToolRegistration[] {
  const deps = resolveToolsDeps(required, optional);
  return buildDomainRegistrations({
    domain: PAYMENTS_TOOLS_DOMAIN, catalogModule: PAYMENTS_TOOLS_CATALOG_MODULE,
    catalog: indexCatalogById({ catalog: paymentsToolCatalog({}, { permissions: deps.permissions }) }),
    derivedRisk: paymentsToolsDerivedRisk,
    handlers: {
      [PAYMENTS_TOOL_IDS.get]: getPaymentHandler({ deps }),
      [PAYMENTS_TOOL_IDS.listProviders]: listProvidersHandler({ deps }),
      ...moneyToolHandlers({ deps }),
    },
  });
}

/** Installs this domain beside its sibling commerce tools (same shape as `contributeCommerceGetStatusTools`). */
export function contributePaymentsTools(
  _required: Record<string, never> = {},
  _optional: Record<string, never> = {}
): { domain: string; build: typeof buildPaymentsToolRegistrations; risk: DerivedRiskByToolId } {
  return { domain: PAYMENTS_TOOLS_DOMAIN, build: buildPaymentsToolRegistrations, risk: paymentsToolsDerivedRisk };
}
