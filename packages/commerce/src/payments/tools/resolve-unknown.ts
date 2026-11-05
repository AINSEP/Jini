import { adaptLegacyAuthorize, buildDomainRegistrations, indexCatalogById, requireToolPermission, ToolInputError,
  type AgentToolDefinition, type DerivedRiskByToolId, type LegacyToolAuthorizeFn, type ToolRegistration } from '@jini-ai/core';
import type { PaymentScope } from '../contract/scope.js';
import type { PaymentsOperatorPort } from '../ops/service.js';
import { requiredText, strictInput } from './input.js';

interface ResolutionTarget { readonly scope: PaymentScope; readonly paymentId: string }
export interface CommerceResolutionToolsRequired {
  readonly workspaceId: string;
  readonly authorize: LegacyToolAuthorizeFn;
  readonly operator: Pick<PaymentsOperatorPort, 'resolveUnknown'>;
  /** Host derives the original payment scope from its order association, never tool input. */
  readonly targetFor: (required: { orderId: string }) => Promise<ResolutionTarget | null>;
}
const permission = 'admin.integrations.manage';
const name = 'commerce_resolve_unknown';
const catalog: AgentToolDefinition[] = [{
  name, sideEffects: 'mutates-durable-state', authorization: { permission },
  description: 'Records an owner-verified outcome for an order whose payment remains unknown. First verify the payment in the provider dashboard or with provider support; never infer failure from an expired replay window. Requires the buyer order ID, succeeded/failed and the verification reason. Writes audited ledger evidence; does not contact the provider or move money.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['orderId', 'outcome', 'reason'], properties: {
    orderId: { type: 'string', minLength: 1, maxLength: 200 },
    outcome: { type: 'string', enum: ['succeeded', 'failed'] },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
  } },
}];
const derivedRisk: DerivedRiskByToolId = new Map([[name, 'mutates-durable-state']]);

/** Exposes the existing audited operator operation without a model-selected merchant scope.
 * Authorization precedes order lookup and every mutation. Actor identity is authenticated.
 * @complexity O(1) target reads and one existing writer transaction; no provider HTTP. */
export function buildCommerceResolutionRegistrations(required: CommerceResolutionToolsRequired, _optional: Record<string, never> = {}): ToolRegistration[] {
  return buildDomainRegistrations({ domain: 'commerce-resolution', catalogModule: 'commerce/payments/tools/resolve-unknown.ts',
    catalog: indexCatalogById({ catalog }), derivedRisk, handlers: { [name]: async ctx => {
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: required.authorize }), workspaceId: required.workspaceId,
        principalId: ctx.principal.id, permission }, { entityType: 'integration' });
      const input = strictInput({ input: ctx.input, allowed: ['orderId', 'outcome', 'reason'] });
      const orderId = requiredText({ input, key: 'orderId' }, { max: 200 });
      const reason = requiredText({ input, key: 'reason' }, { max: 500 });
      const outcome = input.outcome;
      if (outcome !== 'succeeded' && outcome !== 'failed') throw new ToolInputError({ message: 'outcome must be succeeded or failed after verification with the payment provider' });
      const target = await required.targetFor({ orderId });
      if (!target || target.scope.workspaceId !== required.workspaceId) return { ok: false, reason: 'order-payment-not-found', message: 'No payment is recorded for this order in the current shop. Use the buyer’s original order link.' };
      return required.operator.resolveUnknown({ ...target, outcome, actor: ctx.principal.id, reason });
    } },
  });
}
