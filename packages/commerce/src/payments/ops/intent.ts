/**
 * @file `PaymentsPort.createIntent` (lot L4). The order is the design's:
 *
 *   checks → idempotency lookup → risk gate → provider context →
 *   Tx1 (payment `unknown` + attempt `dispatched`) → provider call OUTSIDE any transaction →
 *   Tx2 (ok: evidence through the single writer; rejected: `failed`, no money moved; unknown: stays
 *   `unknown` for the reconciler).
 *
 * Nothing is written before the risk gate and the context resolve pass, so a denied or
 * unconfigured charge leaves no row. The attempt row is written BEFORE the call so a crash
 * mid-call leaves something to reconcile.
 */
import { moneyProblem, type Money } from "../../money/money.js";
import type { PaymentEvidence, NextAction } from "../contract/evidence.js";
import type { IntentResult } from "../contract/payments-port.js";
import type { IntentLine, Outcome, PaymentProvider } from "../contract/provider.js";
import { assessPreChargeRisk, type RiskDecision } from "../contract/risk.js";
import { sameScope, type PaymentScope } from "../contract/scope.js";
import { applyPaymentEvidence, recordIntentDispatchOutcome } from "../accounting/apply-evidence.js";
import type { AttemptRecord, PaymentRecord } from "../ledger/rows.js";
import {
  REPLAY_RISK, checkAmount, checkProvider, checkText, dispatch, fail, markAttempt, newAttempt, noteApplied, onUniqueRace,
  readPayment, rejectedReplay, resolveContext, type Failure,
} from "./common.js";
import type { OpsDeps } from "./deps.js";
import { paymentView, scopeOf } from "./view.js";

export interface IntentRequired {
  readonly scope: PaymentScope;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly reference: string;
}

export interface IntentOptional {
  /** Forwarded display snapshot only: never persisted or compared when replaying. */
  readonly line?: IntentLine;
  readonly captureMode?: "auto" | "manual";
  readonly partyId?: string;
  readonly providerOptions?: Readonly<Record<string, unknown>>;
}

type CaptureMode = "auto" | "manual";
const ALLOW: RiskDecision = { verdict: "allow", reasons: [], fallback: false };

/** Refuse inconsistent display snapshots before opening a payment or dispatching money. */
function checkLine(
  { amount, line }: { amount: Money; line: IntentLine | undefined },
  _optional: Record<string, never> = {}
): Failure | null {
  if (line === undefined) return null;
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
    return fail({ code: "INVALID_REQUEST", message: "line.quantity must be a safe integer greater than zero" });
  }
  const problem = moneyProblem({ money: line.unitAmount });
  if (problem) return fail({ code: "INVALID_REQUEST", message: `line.unitAmount: ${problem}` });
  if (line.unitAmount.currency !== amount.currency || line.unitAmount.minorUnits * line.quantity !== amount.minorUnits) {
    return fail({ code: "INVALID_REQUEST", message: "line must equal the intent amount in the same currency" });
  }
  return null;
}

function checkIntent(
  { deps, required, optional }: { deps: OpsDeps; required: IntentRequired; optional: IntentOptional }
): { readonly ok: true; readonly provider: PaymentProvider } | Failure {
  const checked = checkProvider({ deps, scope: required.scope });
  if (!checked.ok) return checked;
  const problem = checkAmount({ amount: required.amount, provider: checked.provider })
    ?? checkText({ fields: { idempotencyKey: required.idempotencyKey, reference: required.reference } })
    ?? checkLine({ amount: required.amount, line: optional.line });
  if (problem) return problem;
  if (optional.captureMode === "manual" && checked.provider.capabilities.capture !== "manual") {
    return fail({ code: "CAPABILITY_UNSUPPORTED", message: `provider '${checked.provider.id}' cannot authorize without capturing` });
  }
  return checked;
}

/**
 * Same key + same scope, amount, currency and reference = replay; anything else = conflict.
 * Rejected attempts keep their original error; replay never dispatches to the provider.
 * @complexity O(1) ledger lookups and additional space; storage errors propagate.
 */
async function lookupIntent({ deps, required }: { deps: OpsDeps; required: IntentRequired }): Promise<IntentResult | null> {
  const { scope, amount } = required;
  const prior = await deps.ledger.transaction({ fn: (tx) =>
    tx.findPaymentByIdempotencyKey({ workspaceId: scope.workspaceId, mode: scope.mode, key: required.idempotencyKey }) });
  if (!prior) return null;
  const same = sameScope({ a: scopeOf(prior), b: scope }) && prior.amountMinor === amount.minorUnits
    && prior.currency === amount.currency && prior.reference === required.reference;
  if (!same) return fail({ code: "IDEMPOTENCY_CONFLICT", message: "idempotency key already used for a different payment request" });
  const attempt = await deps.ledger.transaction({ fn: tx => tx.findAttemptByOperationKey({
    workspaceId: scope.workspaceId, mode: scope.mode, operationKey: `intent:${required.idempotencyKey}`,
  }) });
  const rejection = attempt ? rejectedReplay({ attempt }) : null;
  if (rejection) return { ...rejection, payment: paymentView(prior) };
  return { ok: true, payment: paymentView(prior), replayed: true, risk: REPLAY_RISK };
}

/** The risk verdict and the capture mode it leaves. `review` = authorize only, held for a person. */
async function riskGate(
  { deps, required, optional, paymentId, provider }: {
    deps: OpsDeps; required: IntentRequired; optional: IntentOptional; paymentId: string; provider: PaymentProvider;
  }
): Promise<{ readonly ok: true; readonly risk: RiskDecision; readonly captureMode: CaptureMode } | Failure> {
  const input = { scope: required.scope, amount: required.amount, paymentId, ...(optional.partyId === undefined ? {} : { partyId: optional.partyId }) };
  const risk = deps.risk ? await assessPreChargeRisk({ deps: deps.risk, input }) : ALLOW;
  const codes = risk.reasons.join(", ");
  if (risk.verdict === "deny") return fail({ code: "RISK_DENIED", message: `the pre-charge risk gate denied this payment (${codes})` });
  if (risk.verdict === "allow") return { ok: true, risk, captureMode: optional.captureMode ?? "auto" };
  if (provider.capabilities.capture !== "manual") {
    return fail({ code: "RISK_DENIED", message: `held for risk review (${codes}), but provider '${provider.id}' cannot authorize without capturing` });
  }
  return { ok: true, risk, captureMode: "manual" };
}

function newPaymentRecord(
  { deps, required, optional, paymentId }: { deps: OpsDeps; required: IntentRequired; optional: IntentOptional; paymentId: string }
): Omit<PaymentRecord, "version"> {
  const at = deps.now();
  return {
    id: paymentId, ...required.scope, idempotencyKey: required.idempotencyKey, reference: required.reference,
    partyId: optional.partyId ?? null, currency: required.amount.currency, amountMinor: required.amount.minorUnits, capturedMinor: 0,
    intentStatus: "unknown", refundedMinor: 0, refundHeldMinor: 0, disputedMinor: 0, status: "unknown", providerRef: null,
    nextActionJson: null, feeCurrency: null, feeMinor: null, netCurrency: null, netMinor: null, settlementCurrency: null,
    settlementMinor: null, createdAt: at, updatedAt: at,
  };
}

type Opened = { readonly kind: "opened"; readonly payment: PaymentRecord; readonly attempt: AttemptRecord } | { readonly kind: "done"; readonly result: IntentResult };

/** Tx1. A concurrent call with the same key that inserted first turns this into its replay/conflict. */
function openIntent(
  { deps, required, optional, paymentId }: { deps: OpsDeps; required: IntentRequired; optional: IntentOptional; paymentId: string }
): Promise<Opened> {
  const open = () => deps.ledger.transaction({ fn: async (tx): Promise<Opened> => {
    const payment = await tx.insertPayment({ payment: newPaymentRecord({ deps, required, optional, paymentId }) });
    const attempt = newAttempt({ deps, payment, op: "intent", operationKey: `intent:${required.idempotencyKey}` });
    await tx.insertAttempt({ attempt });
    return { kind: "opened", payment, attempt };
  } });
  const lookup = async (): Promise<Opened | null> => {
    const result = await lookupIntent({ deps, required });
    return result ? { kind: "done", result } : null;
  };
  return onUniqueRace({ open, lookup });
}

function withNext(value: { readonly evidence: PaymentEvidence; readonly next: NextAction }): PaymentEvidence {
  return value.evidence.next ? value.evidence : { ...value.evidence, next: value.next };
}

/** Tx2: what the provider answered, through the single writer; then the caller's view. */
async function settleIntent(
  { deps, opened, outcome, risk }: {
    deps: OpsDeps; opened: { payment: PaymentRecord; attempt: AttemptRecord }; risk: RiskDecision;
    outcome: Outcome<{ readonly evidence: PaymentEvidence; readonly next: NextAction }>;
  }
): Promise<IntentResult> {
  const { payment, attempt } = opened;
  const scope = scopeOf(payment);
  const target = { deps: deps.writer, workspaceId: payment.workspaceId, mode: payment.mode, paymentId: payment.id };
  const result = await deps.ledger.transaction({ fn: async (tx) => {
    await markAttempt({ tx, deps, attemptId: attempt.id, outcome });
    if (outcome.kind === "ok") return applyPaymentEvidence({ ...target, tx, source: "response", evidence: withNext(outcome.value) });
    return recordIntentDispatchOutcome({ ...target, tx, outcome: outcome.kind });
  } });
  // The payment row was inserted by Tx1 and payments are never deleted.
  const view = paymentView((await deps.ledger.transaction({ fn: (tx) => readPayment({ tx, scope, paymentId: payment.id }) })) as PaymentRecord);
  if (outcome.kind !== "ok") return { ok: false, error: outcome.error, payment: view };
  if (!(await noteApplied({ deps, payment, result }))) {
    return { ...fail({ code: "PROVIDER_ERROR", message: "the provider's response could not be applied and was quarantined for review" }), payment: view };
  }
  return { ok: true, payment: view, replayed: false, risk };
}

export async function createIntent(
  { deps, required }: { deps: OpsDeps; required: IntentRequired },
  optional: IntentOptional = {}
): Promise<IntentResult> {
  const checked = checkIntent({ deps, required, optional });
  if (!checked.ok) return checked;
  const replay = await lookupIntent({ deps, required });
  if (replay) return replay;
  const paymentId = deps.newId();
  const { provider } = checked;
  const gate = await riskGate({ deps, required, optional, paymentId, provider });
  if (!gate.ok) return gate;
  const resolved = await resolveContext({ deps, scope: required.scope, provider });
  if (!resolved.ok) return resolved;
  const opened = await openIntent({ deps, required, optional, paymentId });
  if (opened.kind === "done") return opened.result;
  const req = {
    amount: required.amount, idempotencyKey: opened.attempt.id, correlationId: paymentId, captureMode: gate.captureMode,
    ...(optional.partyId === undefined ? {} : { partyId: optional.partyId }),
    ...(optional.providerOptions === undefined ? {} : { providerOptions: optional.providerOptions }),
    ...(optional.line === undefined ? {} : { line: optional.line }),
  };
  const outcome = await dispatch({ call: () => provider.createIntent({ req, ctx: resolved.ctx }) });
  return settleIntent({ deps, opened, outcome, risk: gate.risk });
}
