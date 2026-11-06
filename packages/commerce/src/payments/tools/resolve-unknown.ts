import { adaptLegacyAuthorize, buildDomainRegistrations, createApprovalHandler, indexCatalogById, requireToolPermission, ToolInputError,
  type AgentToolDefinition, type ApprovalSteps, type DerivedRiskByToolId, type LegacyToolAuthorizeFn, type ToolExecutionContext, type ToolRegistration } from '@jini-ai/core';
import type { Money } from '../../money/money.js';
import type { PaymentScope } from '../contract/scope.js';
import type { PaymentsOperatorPort } from '../ops/service.js';
import { requiredText, strictInput } from './input.js';

interface ResolutionTarget { readonly scope: PaymentScope; readonly paymentId: string; readonly amount: Money }
/** The host renders these stored payment facts with the proposed, human-verified outcome. */
export interface CommerceResolutionApprovalDescription {
  readonly orderId: string;
  readonly paymentId: string;
  readonly amount: Money;
  readonly mode: PaymentScope['mode'];
  readonly outcome: 'succeeded' | 'failed';
  readonly reason: string;
}
export interface CommerceResolutionToolsRequired {
  readonly workspaceId: string;
  readonly authorize: LegacyToolAuthorizeFn;
  readonly operator: Pick<PaymentsOperatorPort, 'resolveUnknown'>;
  readonly askHuman: ApprovalSteps<unknown, CommerceResolutionApprovalDescription>['askHuman'];
  /** Host derives the original payment scope and amount from storage, never tool input. */
  readonly targetFor: (required: { orderId: string }) => Promise<ResolutionTarget | null>;
}
const permission = 'commerce.payments.manage';
const name = 'commerce_resolve_unknown';
const catalog: AgentToolDefinition[] = [{
  name, sideEffects: 'mutates-durable-state', authorization: { permission }, actorClassRule: 'confirmer-must-equal-own-delegatedBy',
  description: 'Records a human-verified outcome for a stuck order payment after a confirmation card naming order, amount, mode and outcome. First verify the payment in the provider dashboard or with provider support; never infer failure from an expired replay window. Requires the buyer order ID, succeeded/failed and verification reason. Writes audited ledger evidence only after approval; does not contact the provider or move money.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['orderId', 'outcome', 'reason'], properties: {
    orderId: { type: 'string', minLength: 1, maxLength: 200 },
    outcome: { type: 'string', enum: ['succeeded', 'failed'] },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
  } },
}];
const derivedRisk: DerivedRiskByToolId = new Map([[name, 'mutates-durable-state']]);
const notFound = { ok: false, reason: 'order-payment-not-found', message: 'No payment is recorded for this order in the current shop. Use the buyer’s original order link.' };
interface Ready { target: ResolutionTarget; description: CommerceResolutionApprovalDescription }

function authorizeResolution(required: CommerceResolutionToolsRequired, ctx: ToolExecutionContext): Promise<void> {
  return requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: required.authorize }), workspaceId: required.workspaceId,
    principalId: ctx.principal.id, permission }, { entityType: 'payment' });
}

/** Validate and authorize before looking up the stored payment; no effects occur in preparation. */
async function prepareResolution(required: CommerceResolutionToolsRequired, ctx: ToolExecutionContext): Promise<Ready | null> {
  await authorizeResolution(required, ctx);
  const input = strictInput({ input: ctx.input, allowed: ['orderId', 'outcome', 'reason'] });
  const orderId = requiredText({ input, key: 'orderId' }, { max: 200 });
  const reason = requiredText({ input, key: 'reason' }, { max: 500 });
  const outcome = input.outcome;
  if (outcome !== 'succeeded' && outcome !== 'failed') throw new ToolInputError({ message: 'outcome must be succeeded or failed after verification with the payment provider' });
  const target = await required.targetFor({ orderId });
  if (!target || target.scope.workspaceId !== required.workspaceId) return null;
  return { target, description: { orderId, paymentId: target.paymentId, amount: target.amount, mode: target.scope.mode, outcome, reason } };
}

/** Exposes audited resolution behind the existing approval lifecycle, with no remembered approval.
 * Input and actor snapshots are owned by core. Permission is checked again after the human wait.
 * @complexity O(1) target reads and one existing writer transaction; no provider HTTP. */
export function buildCommerceResolutionRegistrations(required: CommerceResolutionToolsRequired, _optional: Record<string, never> = {}): ToolRegistration[] {
  const handler = createApprovalHandler<Ready | null, CommerceResolutionApprovalDescription | null>({
    prepare: ({ ctx }) => prepareResolution(required, ctx),
    describe: ({ prepared }) => ({ ask: prepared !== null, description: prepared?.description ?? null }),
    // A missing target skips the card and returns notFound in run, as in the money tools.
    askHuman: ({ ctx, description }, options) => required.askHuman({ ctx, description: description as CommerceResolutionApprovalDescription }, options),
    run: async ({ ctx, prepared, confirmer }) => {
      if (!prepared) return notFound;
      await authorizeResolution(required, ctx);
      if (ctx.signal.aborted) return { ok: false, reason: 'abandoned', message: 'The run ended before payment resolution. Nothing was changed.' };
      const { outcome, reason } = prepared.description;
      return required.operator.resolveUnknown({ scope: prepared.target.scope, paymentId: prepared.target.paymentId, outcome, actor: confirmer.id, reason });
    },
    notConfirmed: ({ reason }) => ({ ok: false, reason, message: `Payment resolution was ${reason}. Nothing was changed; wait for a new explicit request before retrying.` }),
  });
  return buildDomainRegistrations({ domain: 'commerce-resolution', catalogModule: 'commerce/payments/tools/resolve-unknown.ts',
    catalog: indexCatalogById({ catalog }), derivedRisk, handlers: { [name]: handler } });
}
