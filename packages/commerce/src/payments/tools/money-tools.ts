/**
 * @file The three money-moving tools (`commerce_payments_refund`, `_capture`, `_void`), each built on
 * core's `createApprovalHandler`:
 *
 *   prepare  — strict input, the run's scope (never input), the manage permission, the payment as
 *              the ledger has it, and the idempotency key, fixed ONCE here so the request the human
 *              approves and the effect that runs share it;
 *   describe — always asks; names the exact payment, reference, amount, operation, live/test mode
 *              and key. No `rememberKey`: a money movement is irreversible, so a yes is never
 *              remembered and every call needs its own;
 *   run      — only after an explicit human yes: the permission again (it may have been revoked
 *              while the card was open), then `grants.mint` bound to exactly op + workspace + mode +
 *              payment + amount + key, then the `PaymentsPort` call with that grant and the same
 *              values.
 *
 * The tool is not the enforcement point. The payments service redeems the grant itself, against the
 * binding it derives from its OWN arguments, so a tool that minted for one amount and asked for
 * another, or presented a grant twice, is refused there (design item 8: double enforcement).
 *
 * A declined, expired or abandoned approval, or an abort at any point before the call, mints
 * nothing and moves nothing.
 */
import { createApprovalHandler, type ApprovalSteps, type ToolExecutionContext, type ToolHandler } from "@jini-ai/core";
import { toMajorString, type Money } from "../../money/money.js";
import type { IntentResult, PaymentView, RefundView } from "../contract/payments-port.js";
import type { PaymentError } from "../contract/provider.js";
import type { PaymentScope } from "../contract/scope.js";
import type { MoneyGrantBinding } from "../ops/grants.js";
import { MAX_REASON_LENGTH, PAYMENTS_TOOL_IDS } from "./catalog.js";
import {
  NO_SCOPE, paymentNotFound, requirePaymentsPermission, type PaymentApprovalDescription, type PaymentsToolRefusal, type ToolsDeps,
} from "./deps.js";
import { optionalText, readAmount, requiredText, strictInput } from "./input.js";

type MoneyOp = MoneyGrantBinding["op"];

export type MoneyToolResult =
  | { readonly ok: true; readonly operation: MoneyOp; readonly replayed: boolean; readonly idempotencyKey: string; readonly payment: PaymentView; readonly refund?: RefundView }
  | { readonly ok: false; readonly reason: "payment-error"; readonly error: PaymentError; readonly idempotencyKey: string; readonly message: string; readonly payment?: PaymentView }
  | { readonly ok: false; readonly reason: "declined" | "expired" | "abandoned"; readonly message: string }
  | PaymentsToolRefusal;

/** Everything the effect uses, fixed in `prepare` and shown to the human in `describe`. */
interface Ready {
  readonly kind: "ready";
  readonly scope: PaymentScope;
  readonly payment: PaymentView;
  /** Non-null exactly for the ops whose spec has an amount (refund, capture). */
  readonly amount: Money | null;
  readonly idempotencyKey: string;
  readonly reason: string | undefined;
}
type Prepared = Ready | { readonly kind: "refused"; readonly result: PaymentsToolRefusal };

interface Effect extends Ready {
  readonly grant: string;
}

interface OpSpec {
  readonly op: MoneyOp;
  readonly toolId: string;
  readonly fields: readonly string[];
  readonly hasAmount: boolean;
  readonly headline: (shown: { amount: string | null; paymentAmount: string; paymentId: string }) => string;
  readonly call: (required: { deps: ToolsDeps; effect: Effect }) => Promise<MoneyToolResult>;
}

const display = (money: Money): string => `${money.currency} ${toMajorString({ money })}`;

function failure(
  { op, error, idempotencyKey }: { op: MoneyOp; error: PaymentError; idempotencyKey: string },
  { payment }: { payment?: PaymentView | undefined } = {}
): MoneyToolResult {
  const message = `the ${op} did not complete (${error.code}): ${error.message}. Retrying with the same idempotencyKey is safe.`;
  return { ok: false, reason: "payment-error", error, idempotencyKey, message, ...(payment ? { payment } : {}) };
}

function fromIntent({ op, result, idempotencyKey }: { op: MoneyOp; result: IntentResult; idempotencyKey: string }): MoneyToolResult {
  if (!result.ok) return failure({ op, error: result.error, idempotencyKey }, { payment: result.payment });
  return { ok: true, operation: op, replayed: result.replayed, idempotencyKey, payment: result.payment };
}

// `effect.amount as Money` below: refund and capture specs have `hasAmount`, so `prepare` read a
// non-null amount for them (`readRequest`).
const SPECS: readonly OpSpec[] = [
  {
    op: "refund", toolId: PAYMENTS_TOOL_IDS.refund, fields: ["paymentId", "amount", "reason", "idempotencyKey"], hasAmount: true,
    headline: ({ amount, paymentId }) => `refund ${amount} of payment ${paymentId}`,
    call: async ({ deps, effect: { scope, payment, amount, idempotencyKey, grant, reason } }) => {
      const result = await deps.payments.refund(
        { scope, paymentId: payment.id, amount: amount as Money, idempotencyKey, grant }, reason === undefined ? {} : { reason }
      );
      if (!result.ok) return failure({ op: "refund", error: result.error, idempotencyKey });
      return { ok: true, operation: "refund", replayed: result.replayed, idempotencyKey, payment: result.payment, refund: result.refund };
    },
  },
  {
    op: "capture", toolId: PAYMENTS_TOOL_IDS.capture, fields: ["paymentId", "amount", "idempotencyKey"], hasAmount: true,
    headline: ({ amount, paymentId }) => `capture ${amount} of payment ${paymentId}`,
    call: async ({ deps, effect: { scope, payment, amount, idempotencyKey, grant } }) => fromIntent({
      op: "capture", idempotencyKey, result: await deps.payments.capture({ scope, paymentId: payment.id, amount: amount as Money, idempotencyKey, grant }),
    }),
  },
  {
    op: "void", toolId: PAYMENTS_TOOL_IDS.void, fields: ["paymentId", "idempotencyKey"], hasAmount: false,
    headline: ({ paymentAmount, paymentId }) => `void the uncaptured authorization (${paymentAmount}) of payment ${paymentId}`,
    call: async ({ deps, effect: { scope, payment, idempotencyKey, grant } }) => fromIntent({
      op: "void", idempotencyKey, result: await deps.payments.void({ scope, paymentId: payment.id, idempotencyKey, grant }),
    }),
  },
];

function notConfirmed(reason: "declined" | "expired" | "abandoned"): MoneyToolResult {
  return { ok: false, reason, message: `the human did not confirm (${reason}); no money moved and no grant was issued` };
}

function readRequest({ spec, input }: { spec: OpSpec; input: unknown }) {
  const record = strictInput({ input, allowed: spec.fields });
  return {
    paymentId: requiredText({ input: record, key: "paymentId" }),
    amount: spec.hasAmount ? readAmount({ input: record }) : null,
    idempotencyKey: optionalText({ input: record, key: "idempotencyKey" }),
    // Absent for capture/void: `strictInput` refused the field there.
    reason: optionalText({ input: record, key: "reason" }, { max: MAX_REASON_LENGTH }),
  };
}

async function prepareOp({ deps, spec, ctx }: { deps: ToolsDeps; spec: OpSpec; ctx: ToolExecutionContext }): Promise<Prepared> {
  const request = readRequest({ spec, input: ctx.input });
  const scope = await deps.scopeFor({ ctx });
  if (!scope) return { kind: "refused", result: NO_SCOPE };
  await requirePaymentsPermission({ deps, ctx, scope, permission: deps.permissions.manage }, { paymentId: request.paymentId });
  const payment = await deps.payments.getPayment({ scope, paymentId: request.paymentId });
  if (!payment) return { kind: "refused", result: paymentNotFound(request.paymentId) };
  if (request.amount && request.amount.currency !== payment.amount.currency) {
    const message = `the ${spec.op} is in ${request.amount.currency} but payment '${payment.id}' is in ${payment.amount.currency}; nothing was changed`;
    return { kind: "refused", result: { ok: false, reason: "currency-mismatch", message } };
  }
  const idempotencyKey = request.idempotencyKey ?? deps.newIdempotencyKey();
  return { kind: "ready", scope, payment, amount: request.amount, idempotencyKey, reason: request.reason };
}

function describeOp({ spec, ready }: { spec: OpSpec; ready: Ready }): PaymentApprovalDescription {
  const { scope, payment, amount, idempotencyKey } = ready;
  const live = scope.mode === "live";
  const amountDisplay = amount ? display(amount) : null;
  const paymentAmountDisplay = display(payment.amount);
  const reason = ready.reason ?? null;
  const headline = spec.headline({ amount: amountDisplay, paymentAmount: paymentAmountDisplay, paymentId: payment.id });
  const summary = `${live ? "LIVE MODE (real money)" : "Test mode"}: ${headline} (reference ${payment.reference}, provider ${scope.providerId}). `
    + `Idempotency key ${idempotencyKey}.${reason === null ? "" : ` Reason: ${reason}.`} This cannot be undone.`;
  return {
    toolId: spec.toolId, operation: spec.op, mode: scope.mode, live, paymentId: payment.id, reference: payment.reference,
    providerId: scope.providerId, amount, amountDisplay, paymentAmount: payment.amount, paymentAmountDisplay, idempotencyKey,
    reason, irreversible: true, summary,
  };
}

async function runOp({ deps, spec, ctx, prepared }: { deps: ToolsDeps; spec: OpSpec; ctx: ToolExecutionContext; prepared: Prepared }): Promise<MoneyToolResult> {
  if (prepared.kind === "refused") return prepared.result;
  const { scope, payment, amount, idempotencyKey } = prepared;
  // Fresh, after the human wait: a permission revoked while the card was open stops the effect.
  await requirePaymentsPermission({ deps, ctx, scope, permission: deps.permissions.manage }, { paymentId: payment.id });
  if (ctx.signal.aborted) return notConfirmed("abandoned");
  const binding: MoneyGrantBinding = { op: spec.op, workspaceId: scope.workspaceId, mode: scope.mode, paymentId: payment.id, amount, idempotencyKey };
  const grant = await deps.grants.mint({ binding, expiresAt: deps.now() + deps.grantTtlMs });
  // Aborted while minting: the grant is never presented and lapses at its expiry.
  if (ctx.signal.aborted) return notConfirmed("abandoned");
  return spec.call({ deps, effect: { ...prepared, grant } });
}

function stepsFor({ deps, spec }: { deps: ToolsDeps; spec: OpSpec }): ApprovalSteps<Prepared, PaymentApprovalDescription | null> {
  return {
    prepare: ({ ctx }) => prepareOp({ deps, spec, ctx }),
    // A refusal asks nobody; `run` returns it. No `rememberKey` on purpose (see the file comment).
    describe: ({ prepared }) => (prepared.kind === "ready" ? { ask: true, description: describeOp({ spec, ready: prepared }) } : { ask: false, description: null }),
    // Core calls askHuman only for a plan with `ask: true`, which `describe` builds only with a description.
    askHuman: ({ ctx, description }, options) => deps.askHuman({ ctx, description: description as PaymentApprovalDescription }, options),
    run: ({ ctx, prepared }) => runOp({ deps, spec, ctx, prepared }),
    notConfirmed: ({ reason }) => notConfirmed(reason),
  };
}

/** The three approval-gated handlers, keyed by tool id. Each is built once, with no remembered-grant store. */
export function moneyToolHandlers({ deps }: { deps: ToolsDeps }, _optional: Record<string, never> = {}): Record<string, ToolHandler> {
  return Object.fromEntries(SPECS.map((spec) => [spec.toolId, createApprovalHandler(stepsFor({ deps, spec }))]));
}
