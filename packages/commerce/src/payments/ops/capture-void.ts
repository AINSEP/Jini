/**
 * @file `PaymentsPort.capture` and `PaymentsPort.void` (lot L4): the refund skeleton applied to an
 * authorization. Tx1 (idempotency by attempt operation key → payment checks under its lock →
 * `grants.redeem` → attempt `dispatched`) → provider call outside any transaction → Tx2 (ok:
 * evidence through `applyPaymentEvidence`; rejected/unknown: the attempt records it and the
 * authorization is left as the provider last reported it).
 *
 * Idempotency here is keyed on the attempt row (`capture:<key>` / `void:<key>`). Attempt rows carry
 * no amount, so a replay is matched on the payment only; it moves no money either way.
 */
import type { Money } from "../../money/money.js";
import type { PaymentEvidence } from "../contract/evidence.js";
import type { IntentResult } from "../contract/payments-port.js";
import type { Outcome, PaymentProvider, ProviderContext } from "../contract/provider.js";
import type { PaymentScope } from "../contract/scope.js";
import type { IntentStatus } from "../state/status.js";
import { applyPaymentEvidence, type ApplyResult } from "../accounting/apply-evidence.js";
import type { LedgerTx } from "../ledger/repo.js";
import type { AttemptRecord, PaymentRecord } from "../ledger/rows.js";
import {
  NOT_ASSESSED_RISK, REPLAY_RISK, checkAmount, checkProvider, checkText, dispatch, fail, markAttempt, newAttempt, noteApplied,
  onUniqueRace, owned, readPayment, resolveContext, type Failure,
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
    op: "capture", amount, from: new Set(["authorized"]),
    method: (provider) => {
      const capture = provider.capture;
      if (provider.capabilities.capture !== "manual" || typeof capture !== "function") return null;
      return ({ providerRef, idempotencyKey, ctx }) => capture.call(provider, { req: { providerRef, amount, idempotencyKey }, ctx });
    },
  };
}

const VOID_SPEC: OpSpec = {
  op: "void", amount: null, from: new Set(["authorized", "requires_action", "pending"]),
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
    ?? checkText({ paymentId: required.paymentId, idempotencyKey: required.idempotencyKey });
  if (problem) return problem;
  const call = spec.method(provider);
  return call ? { ok: true, provider, call } : fail("CAPABILITY_UNSUPPORTED", `provider '${provider.id}' does not support ${spec.op}`);
}

type Done = { readonly kind: "done"; readonly result: IntentResult };
type Opened = { readonly kind: "opened"; readonly payment: PaymentRecord; readonly attempt: AttemptRecord };

async function lookupOp({ tx, spec, required }: { tx: LedgerTx; spec: OpSpec; required: VoidRequired }): Promise<Done | null> {
  const { scope } = required;
  const prior = await tx.findAttemptByOperationKey({ workspaceId: scope.workspaceId, mode: scope.mode, operationKey: `${spec.op}:${required.idempotencyKey}` });
  if (!prior) return null;
  const payment = prior.paymentId === required.paymentId ? await readPayment({ tx, scope, paymentId: prior.paymentId }) : null;
  if (!payment) return { kind: "done", result: fail("IDEMPOTENCY_CONFLICT", `idempotency key already used for a different ${spec.op} request`) };
  return { kind: "done", result: { ok: true, payment: paymentView(payment), replayed: true, risk: REPLAY_RISK } };
}

function paymentProblem({ payment, spec, required }: { payment: PaymentRecord | null; spec: OpSpec; required: VoidRequired }): Failure | null {
  if (!payment) return fail("INVALID_REQUEST", `payment '${required.paymentId}' not found in this scope`);
  if (!spec.from.has(payment.intentStatus)) return fail("INVALID_REQUEST", `cannot ${spec.op} a payment that is ${payment.intentStatus}`);
  const amount = spec.amount;
  if (amount && (amount.currency !== payment.currency || amount.minorUnits > payment.amountMinor)) {
    return fail("INVALID_REQUEST", `capture must be in ${payment.currency} and at most the authorized ${payment.amountMinor} minor units`);
  }
  return null;
}

async function openOp({ deps, spec, required }: { deps: OpsDeps; spec: OpSpec; required: VoidRequired }): Promise<Done | Opened> {
  const { scope, idempotencyKey } = required;
  const open = () => deps.ledger.transaction(async (tx): Promise<Done | Opened> => {
    const prior = await lookupOp({ tx, spec, required });
    if (prior) return prior;
    // The lock serializes this check against a concurrent capture/void and the evidence writers.
    const payment = owned(await tx.lockPayment({ workspaceId: scope.workspaceId, mode: scope.mode, id: required.paymentId }), scope);
    const problem = paymentProblem({ payment, spec, required });
    if (problem) return { kind: "done", result: problem };
    const binding = { op: spec.op, workspaceId: scope.workspaceId, mode: scope.mode, paymentId: required.paymentId, amount: spec.amount, idempotencyKey };
    if (!(await deps.grants.redeem({ grant: required.grant, binding }))) {
      return { kind: "done", result: fail("GRANT_INVALID", `the ${spec.op} grant is missing, expired, used or bound to another request`) };
    }
    const attempt = newAttempt({ deps, payment: payment as PaymentRecord, op: spec.op, operationKey: `${spec.op}:${idempotencyKey}` });
    await tx.insertAttempt({ attempt });
    return { kind: "opened", payment: payment as PaymentRecord, attempt };
  });
  return onUniqueRace(open, () => deps.ledger.transaction((tx) => lookupOp({ tx, spec, required })));
}

async function settleOp({ deps, opened, outcome }: { deps: OpsDeps; opened: Opened; outcome: Outcome<PaymentEvidence> }): Promise<IntentResult> {
  const { payment, attempt } = opened;
  const result = await deps.ledger.transaction(async (tx) => {
    await markAttempt({ tx, deps, attemptId: attempt.id, outcome });
    if (outcome.kind !== "ok") return null;
    return applyPaymentEvidence({ tx, deps: deps.writer, workspaceId: payment.workspaceId, mode: payment.mode, paymentId: payment.id, source: "response", evidence: outcome.value });
  });
  const scope = scopeOf(payment);
  const view = paymentView((await deps.ledger.transaction((tx) => readPayment({ tx, scope, paymentId: payment.id }))) as PaymentRecord);
  if (outcome.kind !== "ok") return { ok: false, error: outcome.error, payment: view };
  // An ok outcome always went through applyPaymentEvidence above.
  if (!(await noteApplied({ deps, payment, result: result as ApplyResult }))) {
    return { ...fail("PROVIDER_ERROR", "the provider's response could not be applied and was quarantined for review"), payment: view };
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
  const outcome = await dispatch(() => checked.call({ providerRef, idempotencyKey: opened.attempt.id, ctx: resolved.ctx }));
  return settleOp({ deps, opened, outcome });
}

export function capture({ deps, required }: { deps: OpsDeps; required: CaptureRequired }, _optional: Record<string, never> = {}): Promise<IntentResult> {
  return runOp({ deps, spec: captureSpec(required.amount), required });
}

export function voidPayment({ deps, required }: { deps: OpsDeps; required: VoidRequired }, _optional: Record<string, never> = {}): Promise<IntentResult> {
  return runOp({ deps, spec: VOID_SPEC, required });
}
