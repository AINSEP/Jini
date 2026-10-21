/**
 * @file Shared steps of every payments operation: typed refusals, request checks, the provider
 * context, the provider-call wrapper, attempt rows, alerts and the idempotency-race retry.
 *
 * Runtime conditions are returned as typed `PaymentError`s, never thrown. What still throws is a
 * composition or storage fault (a ledger that cannot write), which the host must see.
 */
import { moneyProblem, type Money } from "../../money/money.js";
import type { PaymentsAlertKind } from "../contract/alerts.js";
import {
  paymentError, supportsCurrency, type Outcome, type PaymentError, type PaymentErrorCode, type PaymentProvider, type ProviderContext,
} from "../contract/provider.js";
import type { RiskDecision } from "../contract/risk.js";
import { sameScope, scopeProblem, type PaymentScope } from "../contract/scope.js";
import type { ApplyResult } from "../accounting/apply-evidence.js";
import { LedgerConstraintError, type LedgerTx } from "../ledger/repo.js";
import type { AttemptOp, AttemptRecord, PaymentRecord } from "../ledger/rows.js";
import type { OpsDeps } from "./deps.js";
import { scopeOf } from "./view.js";

export interface Failure {
  readonly ok: false;
  readonly error: PaymentError;
}

export function fail(code: PaymentErrorCode, message: string): Failure {
  return { ok: false, error: paymentError({ code, message }) };
}

/** A replayed operation re-reads its result; the original risk decision is not stored, so this says so. */
export const REPLAY_RISK: RiskDecision = { verdict: "allow", reasons: ["idempotent-replay"], fallback: false };
/** Capture/void act on an intent the risk gate already passed (and a person approved). */
export const NOT_ASSESSED_RISK: RiskDecision = { verdict: "allow", reasons: ["not-assessed"], fallback: false };

/** The scope is usable and names a registered provider. */
export function checkProvider(
  { deps, scope }: { deps: OpsDeps; scope: PaymentScope }
): { readonly ok: true; readonly provider: PaymentProvider } | Failure {
  const problem = scopeProblem({ scope });
  if (problem) return fail("INVALID_REQUEST", problem);
  const registered = deps.providers.get({ id: scope.providerId });
  if (!registered) return fail("PROVIDER_NOT_REGISTERED", `no payment provider '${scope.providerId}' is registered`);
  return { ok: true, provider: registered.provider };
}

/** Valid, positive Money in a currency the provider accepts. */
export function checkAmount({ amount, provider }: { amount: Money; provider: PaymentProvider }): Failure | null {
  const problem = moneyProblem({ money: amount });
  if (problem) return fail("INVALID_REQUEST", `amount: ${problem}`);
  if (!supportsCurrency({ capabilities: provider.capabilities, currency: amount.currency })) {
    return fail("CURRENCY_UNSUPPORTED", `provider '${provider.id}' does not accept ${amount.currency}`);
  }
  return null;
}

/** Each named field must be a non-empty string. */
export function checkText(fields: Readonly<Record<string, unknown>>): Failure | null {
  const blank = Object.entries(fields).find(([, value]) => typeof value !== "string" || value.trim().length === 0);
  return blank ? fail("INVALID_REQUEST", `${blank[0]} must be a non-empty string`) : null;
}

export async function resolveContext(
  { deps, scope, provider }: { deps: OpsDeps; scope: PaymentScope; provider: PaymentProvider }
): Promise<{ readonly ok: true; readonly ctx: ProviderContext } | Failure> {
  const resolved = await deps.contexts.resolve({ scope, provider });
  return resolved.ok ? resolved : { ok: false, error: resolved.error };
}

/** The record when it belongs to `scope` in full (site, provider account too), else null. */
export function owned<R extends PaymentRecord | null>(record: R, scope: PaymentScope): R | null {
  return record !== null && sameScope({ a: scopeOf(record), b: scope }) ? record : null;
}

export function readPayment(
  { tx, scope, paymentId }: { tx: LedgerTx; scope: PaymentScope; paymentId: string }
): Promise<PaymentRecord | null> {
  return tx.getPayment({ workspaceId: scope.workspaceId, mode: scope.mode, id: paymentId }).then((record) => owned(record, scope));
}

function unknownOutcome(message: string): { readonly kind: "unknown"; readonly error: PaymentError } {
  return { kind: "unknown", error: paymentError({ code: "PROVIDER_ERROR", message }, { retryable: true }) };
}

/**
 * Calls the provider. Its contract is to return an Outcome and never throw; a plugin that throws,
 * or answers something that is not a readable Outcome, is treated as `unknown` — money MAY have
 * moved, so it is reconciled, never marked failed.
 */
export async function dispatch<T>(call: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
  let outcome: Outcome<T> | null | undefined;
  try {
    outcome = await call();
  } catch (error) {
    return unknownOutcome(`provider threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  return readable(outcome) ? outcome : unknownOutcome("provider returned no readable Outcome");
}

/** `ok`, or a `rejected`/`unknown` that carries a PaymentError. A rejection we cannot read is NOT trusted as "no money moved". */
function readable<T>(outcome: Outcome<T> | null | undefined): outcome is Outcome<T> {
  if (outcome?.kind === "ok") return true;
  return (outcome?.kind === "rejected" || outcome?.kind === "unknown") && typeof outcome.error?.code === "string";
}

/** A `dispatched` attempt row, written BEFORE the provider call. */
export function newAttempt(
  { deps, payment, op, operationKey }: { deps: OpsDeps; payment: PaymentRecord; op: AttemptOp; operationKey: string },
  optional: { refundId?: string } = {}
): AttemptRecord {
  const at = deps.now();
  return {
    id: deps.newId(), paymentId: payment.id, workspaceId: payment.workspaceId, siteId: payment.siteId, providerId: payment.providerId,
    providerAccountId: payment.providerAccountId, mode: payment.mode, op, operationKey, refundId: optional.refundId ?? null,
    outcome: "dispatched", errorCode: null, errorMessage: null, createdAt: at, updatedAt: at,
  };
}

/** Records what the provider call answered on its attempt row. */
export async function markAttempt({ tx, deps, attemptId, outcome }: { tx: LedgerTx; deps: OpsDeps; attemptId: string; outcome: Outcome<unknown> }): Promise<void> {
  const error = outcome.kind === "ok" ? {} : { errorCode: outcome.error.code, errorMessage: outcome.error.message };
  await tx.updateAttempt({ id: attemptId, patch: { outcome: outcome.kind, ...error, updatedAt: deps.now() } });
}

/** Raises an alert; a failing sink never fails the money operation that raised it. */
export async function raiseAlert(
  { deps, kind, payment, detail }: { deps: OpsDeps; kind: PaymentsAlertKind; payment: Pick<PaymentRecord, "workspaceId" | "mode" | "id">; detail: string }
): Promise<void> {
  const alert = { kind, workspaceId: payment.workspaceId, mode: payment.mode, paymentId: payment.id, detail };
  await deps.alerts.raise({ alert }).catch(() => undefined);
}

/**
 * True when the single writer applied the observation's subject (the intent, or the refund). Any
 * quarantine — of the subject or of a refund/dispute riding along — raises a `quarantine` alert.
 */
export async function noteApplied(
  { deps, payment, result }: { deps: OpsDeps; payment: Pick<PaymentRecord, "workspaceId" | "mode" | "id">; result: ApplyResult }
): Promise<boolean> {
  const applied = result.kind === "applied";
  if (!applied || result.quarantined.length > 0) {
    await raiseAlert({ deps, kind: "quarantine", payment, detail: `evidence not applied cleanly: ${JSON.stringify(result)}` });
  }
  return applied;
}

/**
 * Runs `open`; when it loses an idempotency race (a concurrent call with the same key inserted
 * first, so the unique key refused this one), re-reads with `lookup` in a fresh transaction and
 * returns that call's result instead. Any other failure propagates.
 */
export async function onUniqueRace<T>(open: () => Promise<T>, lookup: () => Promise<T | null>): Promise<T> {
  try {
    return await open();
  } catch (error) {
    if (!(error instanceof LedgerConstraintError) || error.kind !== "unique") throw error;
    const winner = await lookup();
    if (winner === null) throw error;
    return winner;
  }
}
