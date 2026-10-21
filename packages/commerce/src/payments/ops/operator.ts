/**
 * @file Operator resolution of an `unknown` payment or refund (lot L4; owner question 2 of the L3
 * report). When the reconciler cannot settle a row (the provider cannot `retrieve`, the call never
 * reached it, its snapshot is ambiguous), a person who checked the provider's dashboard or support
 * records the outcome here.
 *
 * Audited: the state change (through the single writer, evidence source `operator`) and an
 * append-only `commerce_operator_actions` row are written in ONE transaction, so there is never a
 * resolution without its audit or an audit without its resolution. Only an `unknown` record may be
 * resolved; anything else already has provider evidence, which outranks a person's assertion.
 */
import type { PaymentView, RefundView } from "../contract/payments-port.js";
import type { PaymentScope } from "../contract/scope.js";
import { settleUnknownIntent, settleUnknownRefund, type SettleResult } from "../accounting/apply-evidence.js";
import type { LedgerTx } from "../ledger/repo.js";
import type { PaymentRecord, RefundRecord } from "../ledger/rows.js";
import { checkProvider, checkText, fail, readPayment, type Failure } from "./common.js";
import type { OpsDeps } from "./deps.js";
import { paymentView, refundView } from "./view.js";

export interface ResolveUnknownRequired {
  readonly scope: PaymentScope;
  readonly paymentId: string;
  /** Set to resolve one of the payment's refunds instead of its intent. */
  readonly refundId?: string;
  readonly outcome: "succeeded" | "failed";
  /** Opaque operator id (never an email); recorded in the audit row. */
  readonly actor: string;
  /** Why, in the operator's words (e.g. "provider support ticket 1234: never received"). */
  readonly reason: string;
}

export type ResolveUnknownResult =
  | { readonly ok: true; readonly payment: PaymentView; readonly refund: RefundView | null }
  | Failure;

function checkResolve({ deps, required }: { deps: OpsDeps; required: ResolveUnknownRequired }): Failure | null {
  const checked = checkProvider({ deps, scope: required.scope });
  if (!checked.ok) return checked;
  const blank = checkText({ fields: { paymentId: required.paymentId, actor: required.actor, reason: required.reason, ...(required.refundId === undefined ? {} : { refundId: required.refundId }) } });
  if (blank) return blank;
  return required.outcome === "succeeded" || required.outcome === "failed" ? null : fail({ code: "INVALID_REQUEST", message: 'outcome must be "succeeded" or "failed"' });
}

function settle({ tx, deps, required }: { tx: LedgerTx; deps: OpsDeps; required: ResolveUnknownRequired }): Promise<SettleResult> {
  const target = { tx, deps: deps.writer, workspaceId: required.scope.workspaceId, mode: required.scope.mode, paymentId: required.paymentId, source: "operator" as const };
  return required.refundId === undefined
    ? settleUnknownIntent({ ...target, status: required.outcome })
    : settleUnknownRefund({ ...target, refundId: required.refundId, status: required.outcome });
}

function refused(required: ResolveUnknownRequired, settled: Exclude<SettleResult, { kind: "settled" }>): Failure {
  const subject = required.refundId === undefined ? `payment ${required.paymentId}` : `refund ${required.refundId}`;
  const why = "status" in settled ? `is ${settled.status}; only an unknown outcome can be resolved` : "not found";
  return fail({ code: "INVALID_REQUEST", message: `${subject} ${why}` });
}

type Resolved = { readonly payment: PaymentRecord; readonly refund: RefundRecord | null };

async function resolveInTx({ tx, deps, required }: { tx: LedgerTx; deps: OpsDeps; required: ResolveUnknownRequired }): Promise<Resolved | Failure> {
  const before = await readPayment({ tx, scope: required.scope, paymentId: required.paymentId });
  if (!before) return fail({ code: "INVALID_REQUEST", message: `payment ${required.paymentId} not found in this scope` });
  const settled = await settle({ tx, deps, required });
  if (settled.kind !== "settled") return refused(required, settled);
  await tx.appendOperatorAction({
    action: {
      id: deps.newId(), paymentId: before.id, workspaceId: before.workspaceId, siteId: before.siteId, providerId: before.providerId,
      providerAccountId: before.providerAccountId, mode: before.mode, refundId: required.refundId ?? null, action: "resolve-unknown",
      outcome: required.outcome, actor: required.actor, reason: required.reason, createdAt: deps.now(),
    },
  });
  // Both rows exist: the writer just settled them under the payment lock.
  const payment = (await readPayment({ tx, scope: required.scope, paymentId: before.id })) as PaymentRecord;
  const refund = required.refundId === undefined ? null : await tx.findRefund({ paymentId: before.id }, { correlationId: required.refundId });
  return { payment, refund };
}

/** Resolve an `unknown` payment intent or refund, audited. Refusals are typed errors. */
export async function resolveUnknown(
  { deps, required }: { deps: OpsDeps; required: ResolveUnknownRequired },
  _optional: Record<string, never> = {}
): Promise<ResolveUnknownResult> {
  const problem = checkResolve({ deps, required });
  if (problem) return problem;
  const resolved = await deps.ledger.transaction((tx) => resolveInTx({ tx, deps, required }));
  if ("ok" in resolved) return resolved;
  return { ok: true, payment: paymentView(resolved.payment), refund: resolved.refund ? refundView(resolved.refund) : null };
}
