/**
 * @file The model-facing catalog of the payments agent tools (lot L7) and this layer's own risk
 * classification of them.
 *
 * Two read tools (a payment's view, the registered providers) and three money-moving tools
 * (`refund`, `capture`, `void`). The money tools carry `confirmer-must-equal-own-delegatedBy`, so
 * the registration kit refuses to wire them unless their handler asks a human through the host's
 * confirmation transport; nothing in a tool input can approve a money movement.
 *
 * Every schema is strict (`additionalProperties: false`): a field the model invents is refused, not
 * ignored, so it can never believe an option it made up was applied.
 */
import type { AgentToolDefinition, DerivedRiskByToolId } from "@jini-ai/core";

export const PAYMENTS_TOOLS_DOMAIN = "commerce-payments";
export const PAYMENTS_TOOLS_CATALOG_MODULE = "packages/commerce/src/payments/tools/catalog.ts";

export const PAYMENTS_TOOL_IDS = {
  get: "commerce_payments_get",
  listProviders: "commerce_payments_list_providers",
  refund: "commerce_payments_refund",
  capture: "commerce_payments_capture",
  void: "commerce_payments_void",
} as const;

/** The two permissions the tools check; a host maps them onto its own role model. */
export interface PaymentsToolPermissions {
  /** Read a payment or the provider list. */
  readonly read: string;
  /** Refund, capture or void (each still needs a human yes). */
  readonly manage: string;
}

export const DEFAULT_PAYMENTS_TOOL_PERMISSIONS: PaymentsToolPermissions = {
  read: "commerce.payments.read",
  manage: "commerce.payments.manage",
};

/** Upper bounds the handlers enforce too (`input.ts`); the schema only advises the model. */
export const MAX_ID_LENGTH = 200;
export const MAX_REASON_LENGTH = 500;

const PAYMENT_ID = { type: "string", minLength: 1, maxLength: MAX_ID_LENGTH, description: "The payment id, as commerce_payments_get returns it." } as const;
const AMOUNT = {
  type: "object",
  additionalProperties: false,
  required: ["minorUnits", "currency"],
  description: "The exact amount, in the payment's currency.",
  properties: {
    minorUnits: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: "Whole minor units (cents for USD, yen for JPY). Never a decimal." },
    currency: { type: "string", pattern: "^[A-Z]{3}$", description: "Uppercase ISO-4217 code, e.g. USD." },
  },
} as const;
const IDEMPOTENCY_KEY = {
  type: "string", minLength: 1, maxLength: MAX_ID_LENGTH,
  description: "Optional. Pass the key an earlier call returned to retry that exact request safely; omit it for a new request and one is generated.",
} as const;
const REASON = { type: "string", minLength: 1, maxLength: MAX_REASON_LENGTH, description: "Optional note recorded with the refund." } as const;

function strict(properties: Readonly<Record<string, unknown>>, required: readonly string[]): Readonly<Record<string, unknown>> {
  return { type: "object", additionalProperties: false, required, properties };
}

const APPROVAL = "Shows the human a confirmation card naming the payment, amount, mode (live/test) and idempotency key; nothing happens unless they confirm. Returns {ok:false, reason} when refused, declined, expired or abandoned.";

/**
 * Builds the catalog with the host's permission names.
 * @param optional.permissions - Permission names; defaults to {@link DEFAULT_PAYMENTS_TOOL_PERMISSIONS}.
 * @returns Five definitions with fixed ids, schemas and risk.
 * @example paymentsToolCatalog({}, { permissions: { read: "shop.read", manage: "shop.money" } });
 */
export function paymentsToolCatalog(
  _required: Record<string, never> = {},
  { permissions = DEFAULT_PAYMENTS_TOOL_PERMISSIONS }: { permissions?: PaymentsToolPermissions } = {}
): AgentToolDefinition[] {
  const read = { permission: permissions.read };
  const manage = { permission: permissions.manage };
  const human = "confirmer-must-equal-own-delegatedBy" as const;
  return [
    {
      name: PAYMENTS_TOOL_IDS.get,
      description: "Reads one payment of the run's payment account: status, amount, captured, refunded, held and disputed money, reference and any next action. Read-only.",
      sideEffects: "none", authorization: read, inputSchema: strict({ paymentId: PAYMENT_ID }, ["paymentId"]),
    },
    {
      name: PAYMENTS_TOOL_IDS.listProviders,
      description: "Lists the registered payment providers and what each supports (refunds none/full/partial, capture auto/manual). Read-only; says nothing about credentials.",
      sideEffects: "none", authorization: read, inputSchema: strict({}, []),
    },
    {
      name: PAYMENTS_TOOL_IDS.refund,
      description: `Refunds money from a succeeded payment back to the payer. Irreversible. ${APPROVAL}`,
      sideEffects: "mutates-durable-state", authorization: manage, actorClassRule: human,
      inputSchema: strict({ paymentId: PAYMENT_ID, amount: AMOUNT, reason: REASON, idempotencyKey: IDEMPOTENCY_KEY }, ["paymentId", "amount"]),
    },
    {
      name: PAYMENTS_TOOL_IDS.capture,
      description: `Captures (collects) an authorized manual-capture payment, up to the authorized amount. Irreversible. ${APPROVAL}`,
      sideEffects: "mutates-durable-state", authorization: manage, actorClassRule: human,
      inputSchema: strict({ paymentId: PAYMENT_ID, amount: AMOUNT, idempotencyKey: IDEMPOTENCY_KEY }, ["paymentId", "amount"]),
    },
    {
      name: PAYMENTS_TOOL_IDS.void,
      description: `Voids (releases) an uncaptured authorization so the payer is never charged. Irreversible. ${APPROVAL}`,
      sideEffects: "mutates-durable-state", authorization: manage, actorClassRule: human,
      inputSchema: strict({ paymentId: PAYMENT_ID, idempotencyKey: IDEMPOTENCY_KEY }, ["paymentId"]),
    },
  ];
}

/**
 * Independently derived from what each handler calls (`read-tools.ts`, `money-tools.ts`).
 *
 * Core's side-effect vocabulary has no money member, so a money movement is classified as the
 * strongest fitting one, `mutates-durable-state` (it writes ledger rows and moves money at the
 * provider). Its irreversibility is carried by the human-confirmation rule and by the approval
 * plan never offering a remembered grant, not by this word.
 */
export const paymentsToolsDerivedRisk: DerivedRiskByToolId = new Map([
  // PaymentsPort.getPayment: one ledger read.
  [PAYMENTS_TOOL_IDS.get, "none"],
  // PaymentsPort.listProviders: the in-memory provider registry.
  [PAYMENTS_TOOL_IDS.listProviders, "none"],
  // MoneyGrantPort.mint + PaymentsPort.refund / capture / void: ledger writes and a provider call.
  [PAYMENTS_TOOL_IDS.refund, "mutates-durable-state"],
  [PAYMENTS_TOOL_IDS.capture, "mutates-durable-state"],
  [PAYMENTS_TOOL_IDS.void, "mutates-durable-state"],
]);
