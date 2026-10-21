/**
 * @file The two read tools: `commerce_payments_get` (one payment's view) and
 * `commerce_payments_list_providers`. Neither writes anything or reveals a credential; both still
 * need the run's payment scope and the read permission.
 */
import { requireNoInput, type ToolHandler } from "@jini-ai/core";
import { NO_SCOPE, paymentNotFound, requirePaymentsPermission, type ToolsDeps } from "./deps.js";
import { requiredText, strictInput } from "./input.js";

export function getPaymentHandler({ deps }: { deps: ToolsDeps }, _optional: Record<string, never> = {}): ToolHandler {
  return async (ctx) => {
    const paymentId = requiredText({ input: strictInput({ input: ctx.input, allowed: ["paymentId"] }), key: "paymentId" });
    const scope = await deps.scopeFor({ ctx });
    if (!scope) return NO_SCOPE;
    await requirePaymentsPermission({ deps, ctx, scope, permission: deps.permissions.read }, { paymentId });
    const payment = await deps.payments.getPayment({ scope, paymentId });
    return payment ? { ok: true, payment } : paymentNotFound(paymentId);
  };
}

export function listProvidersHandler({ deps }: { deps: ToolsDeps }, _optional: Record<string, never> = {}): ToolHandler {
  return async (ctx) => {
    requireNoInput({ input: ctx.input });
    const scope = await deps.scopeFor({ ctx });
    if (!scope) return NO_SCOPE;
    await requirePaymentsPermission({ deps, ctx, scope, permission: deps.permissions.read });
    return { ok: true, providers: deps.payments.listProviders() };
  };
}
