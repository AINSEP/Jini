/**
 * @file `PaymentsPort.capture` and `PaymentsPort.void` (lot L4): the refund skeleton applied to an
 * authorization. Tx1 (idempotency by attempt operation key → payment checks under its lock →
 * `grants.redeem` → attempt `dispatched`) → provider call outside any transaction → Tx2 (ok:
 * evidence through `applyPaymentEvidence`; rejected/unknown: the attempt records it and the
 * authorization is left as the provider last reported it).
 *
 * While a capture or void of a payment has no answer yet (its attempt is still `dispatched` or
 * `unknown`: a lost response), a conflicting capture/void of that payment is refused (retryable,
 * before its grant is redeemed) until the reconciler (`reconciler.ts`) or the late answer closes it.
 *
 * Idempotency here is keyed on the attempt row (`capture:<key>` / `void:<key>`). A replay must name
 * the same payment and, for a capture, the same amount the attempt stored (0004); anything else is
 * an `IDEMPOTENCY_CONFLICT`. A capture attempt written before 0004 has no amount and is matched on
 * the payment only; a replay moves no money either way.
 */
import type { Money } from "../../money/money.js";
import type { PaymentEvidence } from "../contract/evidence.js";
import type { IntentResult } from "../contract/payments-port.js";
import type { Outcome, PaymentProvider, ProviderContext } from "../contract/provider.js";
import type { PaymentScope } from "../contract/scope.js";
import type { IntentStatus } from "../state/status.js";
import { applyPaymentEvidence, type ApplyResult } from "../accounting/apply-evidence.js";
import type { LedgerTx } from "../ledger/repo.js";
import { OPEN_ATTEMPT_OUTCOMES, type AttemptRecord, type PaymentRecord } from "../ledger/rows.js";
import {
  NOT_ASSESSED_RISK, REPLAY_RISK, checkAmount, checkProvider, checkText, dispatch, fail, markAttempt, newAttempt, noteApplied,
  onUniqueRace, outcomeError, owned, readPayment, rejectedReplay, resolveContext, type Failure,
} from "./common.js";
import type { OpsDeps } from "./deps.js";
import { paymentView, scopeOf } from "./view.js";

export interface CaptureRequired {
  readonly scope: PaymentScope;
  readonly paymentId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly grant: string;
}

export type VoidRequired = Omit<CaptureRequired, "amount">;

type ProviderCall = (required: { providerRef: string; idempotencyKey: string; ctx: ProviderContext }) => Promise<Outcome<PaymentEvidence>>;

/**
 * The intent statuses each op acts on (`from`) and the one it leads to (`done`). Shared with the
 * reconciler, which judges a capture/void whose response was lost by the same rule.
 */
export const CAPTURE_VOID_STATUSES: Readonly<Record<"capture" | "void", { readonly from: ReadonlySet<IntentStatus>; readonly done: IntentStatus }>> = {
  capture: { from: new Set(["authorized"]), done: "succeeded" },
  void: { from: new Set(["authorized", "requires_action", "pending"]), done: "canceled" },
};

/** What differs between capture and void. */
interface OpSpec {
  readonly op: "capture" | "void";
  readonly amount: Money | null;
  /** The provider's method for this op, or null when its capabilities do not offer it. */
  readonly method: (provider: PaymentProvider) => ProviderCall | null;
  /** Intent statuses the op may act on. */
  readonly from: ReadonlySet<IntentStatus>;
}

function captureSpec(amount: Money): OpSpec {
  return {
    op: "capture", amount, from: CAPTURE_VOID_STATUSES.capture.from,
    method: (provider) => {
      const capture = provider.capture;
      if (provider.capabilities.capture !== "manual" || typeof capture !== "function") return null;
      return ({ providerRef, idempotencyKey, ctx }) => capture.call(provider, { req: { providerRef, amount, idempotencyKey }, ctx });
    },
  };
}

const VOID_SPEC: OpSpec = {
  op: "void", amount: null, from: CAPTURE_VOID_STATUSES.void.from,
  method: (provider) => {
    const release = provider.void;
    if (!provider.capabilities.void || typeof release !== "function") return null;
    return ({ providerRef, idempotencyKey, ctx }) => release.call(provider, { req: { providerRef, idempotencyKey }, ctx });
  },
};

function checkOp(
  { deps, spec, required }: { deps: OpsDeps; spec: OpSpec; required: VoidRequired }
): { readonly ok: true; readonly provider: PaymentProvider; readonly call: ProviderCall } | Failure {
  const checked = checkProvider({ deps, scope: required.scope });
  if (!checked.ok) return checked;
  const { provider } = checked;
  const problem = (spec.amount ? checkAmount({ amount: spec.amount, provider }) : null)
    ?? checkText({ fields: { paymentId: required.paymentId, idempotencyKey: required.idempotencyKey } });
  if (problem) return problem;
  const call = spec.method(provider);
  return call ? { ok: true, provider, call } : fail({ code: "CAPABILITY_UNSUPPORTED", message: `provider '${provider.id}' does not support ${spec.op}` });
}

type Done = { readonly kind: "done"; readonly result: IntentResult };
type Opened = { readonly kind: "opened"; readonly payment: PaymentRecord; readonly attempt: AttemptRecord };

/** Does the stored attempt ask for what this call asks? Same payment, and the same amount when both carry one. */
function sameRequest({ prior, spec, required }: { prior: AttemptRecord; spec: OpSpec; required: VoidRequired }): boolean {
  const amount = spec.amount;
  const sameAmount = amount === null || prior.amountMinor === null || (prior.amountMinor === amount.minorUnits && prior.currency === amount.currency);
  return prior.paymentId === required.paymentId && sameAmount;
}

async function lookupOp({ tx, spec, required }: { tx: LedgerTx; spec: OpSpec; required: VoidRequired }): Promise<Done | null> {
  const { scope } = required;
  const prior = await tx.findAttemptByOperationKey({ workspaceId: scope.workspaceId, mode: scope.mode, operationKey: `${spec.op}:${required.idempotencyKey}` });
  if (!prior) return null;
  const payment = sameRequest({ prior, spec, required }) ? await readPayment({ tx, scope, paymentId: prior.paymentId }) : null;
  if (!payment) return { kind: "done", result: fail({ code: "IDEMPOTENCY_CONFLICT", message: `idempotency key already used for a different ${spec.op} request` }) };
  const rejected = rejectedReplay({ attempt: prior });
  if (rejected) return { kind: "done", result: { ...rejected, payment: paymentView(payment) } };
  return { kind: "done", result: { ok: true, payment: paymentView(payment), replayed: true, risk: REPLAY_RISK } };
}

function paymentProblem({ payment, spec, required }: { payment: PaymentRecord | null; spec: OpSpec; required: VoidRequired }): Failure | null {
  if (!payment) return fail({ code: "INVALID_REQUEST", message: `payment '${required.paymentId}' not found in this scope` });
  if (!spec.from.has(payment.intentStatus)) return fail({ code: "INVALID_REQUEST", message: `cannot ${spec.op} a payment that is ${payment.intentStatus}` });
  const amount = spec.amount;
  if (amount && (amount.currency !== payment.currency || amount.minorUnits > payment.amountMinor)) {
    return fail({ code: "INVALID_REQUEST", message: `capture must be in ${payment.currency} and at most the authorized ${payment.amountMinor} minor units` });
  }
  return null;
}

/** A capture or void of this payment still waiting for its answer: dispatching another now could contradict it. */
async function unresolvedConflict({ tx, paymentId }: { tx: LedgerTx; paymentId: string }): Promise<Failure | null> {
  const open = (await tx.listAttempts({ paymentId })).find((a) => (a.op === "capture" || a.op === "void") && OPEN_ATTEMPT_OUTCOMES.includes(a.outcome));
  if (!open) return null;
  return fail({ code: "INVALID_REQUEST", message: `a ${open.op} of this payment is still unresolved; retry once it is reconciled` }, { retryable: true });
}

/** Under the payment lock: the payment's state, an unresolved conflicting op, then the grant (redeemed last, so a refusal never spends it). */
async function admit(
  { tx, deps, spec, required, payment }: { tx: LedgerTx; deps: OpsDeps; spec: OpSpec; required: VoidRequired; payment: PaymentRecord | null }
): Promise<Failure | null> {
  const problem = paymentProblem({ payment, spec, required }) ?? (await unresolvedConflict({ tx, paymentId: required.paymentId }));
  if (problem) return problem;
  const { scope, idempotencyKey } = required;
  const binding = { op: spec.op, workspaceId: scope.workspaceId, mode: scope.mode, paymentId: required.paymentId, amount: spec.amount, idempotencyKey };
  if (await deps.grants.redeem({ grant: required.grant, binding })) return null;
  return fail({ code: "GRANT_INVALID", message: `the ${spec.op} grant is missing, expired, used or bound to another request` });
}

async function openOp({ deps, spec, required }: { deps: OpsDeps; spec: OpSpec; required: VoidRequired }): Promise<Done | Opened> {
  const { scope, idempotencyKey } = required;
  const open = () => deps.ledger.transaction({ fn: async (tx): Promise<Done | Opened> => {
    const prior = await lookupOp({ tx, spec, required });
    if (prior) return prior;
    // The lock serializes this check against a concurrent capture/void and the evidence writers.
    const payment = owned({ record: await tx.lockPayment({ workspaceId: scope.workspaceId, mode: scope.mode, id: required.paymentId }), scope });
    const refused = await admit({ tx, deps, spec, required, payment });
    if (refused) return { kind: "done", result: refused };
    const attempt = newAttempt(
      { deps, payment: payment as PaymentRecord, op: spec.op, operationKey: `${spec.op}:${idempotencyKey}` },
      spec.amount === null ? {} : { amount: spec.amount }
    );
    await tx.insertAttempt({ attempt });
    return { kind: "opened", payment: payment as PaymentRecord, attempt };
  } });
  return onUniqueRace({ open, lookup: () => deps.ledger.transaction({ fn: (tx) => lookupOp({ tx, spec, required }) }) });
}

async function settleOp({ deps, opened, outcome }: { deps: OpsDeps; opened: Opened; outcome: Outcome<PaymentEvidence> }): Promise<IntentResult> {
  const { payment, attempt } = opened;
  const result = await deps.ledger.transaction({ fn: async (tx) => {
    await markAttempt({ tx, deps, attemptId: attempt.id, outcome });
    if (outcome.kind !== "ok") return null;
    return applyPaymentEvidence({ tx, deps: deps.writer, workspaceId: payment.workspaceId, mode: payment.mode, paymentId: payment.id, source: "response", evidence: outcome.value });
  } });
  const scope = scopeOf(payment);
  const view = paymentView((await deps.ledger.transaction({ fn: (tx) => readPayment({ tx, scope, paymentId: payment.id }) })) as PaymentRecord);
  if (outcome.kind !== "ok") return { ok: false, error: outcomeError({ outcome }), payment: view };
  // An ok outcome always went through applyPaymentEvidence above.
  if (!(await noteApplied({ deps, payment, result: result as ApplyResult }))) {
    return { ...fail({ code: "PROVIDER_ERROR", message: "the provider's response could not be applied and was quarantined for review" }), payment: view };
  }
  return { ok: true, payment: view, replayed: false, risk: NOT_ASSESSED_RISK };
}

async function runOp({ deps, spec, required }: { deps: OpsDeps; spec: OpSpec; required: VoidRequired }): Promise<IntentResult> {
  const checked = checkOp({ deps, spec, required });
  if (!checked.ok) return checked;
  const resolved = await resolveContext({ deps, scope: required.scope, provider: checked.provider });
  if (!resolved.ok) return resolved;
  const opened = await openOp({ deps, spec, required });
  if (opened.kind === "done") return opened.result;
  // Allowed statuses (authorized/pending/requires_action) only ever come from evidence, which always carries the provider ref.
  const providerRef = opened.payment.providerRef as string;
  const outcome = await dispatch({ call: () => checked.call({ providerRef, idempotencyKey: opened.attempt.id, ctx: resolved.ctx }) });
  return settleOp({ deps, opened, outcome });
}

export function capture({ deps, required }: { deps: OpsDeps; required: CaptureRequired }, _optional: Record<string, never> = {}): Promise<IntentResult> {
  return runOp({ deps, spec: captureSpec(required.amount), required });
}

export function voidPayment({ deps, required }: { deps: OpsDeps; required: VoidRequired }, _optional: Record<string, never> = {}): Promise<IntentResult> {
  return runOp({ deps, spec: VOID_SPEC, required });
}
