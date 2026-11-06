import type { IntentRequest, PaymentProvider, ProviderContext } from "../contract/provider.js";
import type { AttemptRecord, PaymentRecord } from "../ledger/rows.js";
import { dispatch, markAttempt } from "./common.js";
import type { OpsDeps } from "./deps.js";
import { scopeOf } from "./view.js";
import type { Snapshot } from "./reconcile-snapshot.js";

/** Only request data and URLs: credentials and provider-specific extras are never stored. */
export interface IntentDispatchSnapshot {
  readonly req: IntentRequest;
  readonly webhookUrl: string;
  readonly returnUrl: string;
  readonly cancelUrl: string;
}

/** Captures exactly the request sent; provider extras may contain secrets, so those cannot replay.
 * @complexity O(n) time/space in display text; no I/O. */
export function intentDispatchSnapshot(
  { req, ctx, provider }: { req: IntentRequest; ctx: ProviderContext; provider: PaymentProvider },
  _optional: Record<string, never> = {}
): string | null {
  if (!provider.intentReplayWindowMs || req.providerOptions !== undefined) return null;
  const money = { minorUnits: req.amount.minorUnits, currency: req.amount.currency };
  const line = req.line === undefined ? {} : { line: {
    description: req.line.description, quantity: req.line.quantity,
    unitAmount: { minorUnits: req.line.unitAmount.minorUnits, currency: req.line.unitAmount.currency },
    ...(req.line.providerPriceRef === undefined ? {} : { providerPriceRef: req.line.providerPriceRef }),
  } };
  const snapshot: IntentDispatchSnapshot = {
    req: { amount: money, idempotencyKey: req.idempotencyKey, correlationId: req.correlationId, captureMode: req.captureMode,
      ...(req.partyId === undefined ? {} : { partyId: req.partyId }), ...line },
    webhookUrl: ctx.webhookUrl, returnUrl: ctx.returnUrl, cancelUrl: ctx.cancelUrl,
  };
  const json = JSON.stringify(snapshot);
  return new TextEncoder().encode(json).length <= 16_384 ? json : null;
}

/** A claim is durable before network I/O. The payment lock serializes processes, not just timers.
 * @complexity O(1) ledger operations; no provider I/O inside a transaction. */
async function claimReplay({ deps, payment, windowMs }: { deps: OpsDeps; payment: PaymentRecord; windowMs: number }): Promise<AttemptRecord | null> {
  return deps.ledger.transaction({ fn: async tx => {
    const current = await tx.lockPayment({ ...scopeOf(payment), id: payment.id });
    if (current?.intentStatus !== "unknown" || current.providerRef !== null) return null;
    const attempt = await tx.findAttemptByOperationKey({ ...scopeOf(payment), operationKey: `intent:${payment.idempotencyKey}` });
    if (attempt === null || !eligible({ attempt, now: deps.now(), windowMs })) return null;
    const recoveryAttempts = attempt.recoveryAttempts + 1;
    const recoveryClaimUntil = deps.now() + 60_000;
    await tx.updateAttempt({ id: attempt.id, patch: { recoveryAttempts, recoveryClaimUntil, updatedAt: deps.now() } });
    return { ...attempt, recoveryAttempts, recoveryClaimUntil };
  } });
}

function eligible({ attempt, now, windowMs }: { attempt: AttemptRecord | null; now: number; windowMs: number }): boolean {
  if (!attempt?.dispatchJson || attempt.recoveryAttempts >= 3) return false;
  if (attempt.outcome !== "unknown" && attempt.outcome !== "dispatched") return false;
  if (attempt.recoveryClaimUntil !== null && attempt.recoveryClaimUntil > now) return false;
  // Persisted attempt count places retries across the retention window, surviving restarts.
  const nextReplayAt = attempt.createdAt + attempt.recoveryAttempts * windowMs / 3;
  return now >= nextReplayAt && now - attempt.createdAt < windowMs;
}

/** Replays only the original key during the provider's promised retention window.
 * Credentials are freshly scoped; original URL parameters are retained for strict idempotency.
 * @complexity O(n) snapshot bytes, O(1) ledger operations and one bounded provider call. */
export async function recoverIntentSnapshot(
  { deps, payment, provider, ctx }: { deps: OpsDeps; payment: PaymentRecord; provider: PaymentProvider; ctx: ProviderContext },
  _optional: Record<string, never> = {}
): Promise<Snapshot> {
  const windowMs = provider.intentReplayWindowMs;
  if (!Number.isSafeInteger(windowMs) || (windowMs ?? 0) <= 0) return { ok: false, why: "no provider reference (the provider never answered)" };
  const attempt = await claimReplay({ deps, payment, windowMs: windowMs! });
  if (!attempt) return { ok: false, why: "intent recovery is unavailable, in progress, exhausted or outside the provider replay window" };
  const snapshot = JSON.parse(attempt.dispatchJson!) as IntentDispatchSnapshot;
  const outcome = await dispatch({ call: () => provider.createIntent({
    req: snapshot.req, ctx: { ...ctx, webhookUrl: snapshot.webhookUrl, returnUrl: snapshot.returnUrl, cancelUrl: snapshot.cancelUrl },
  }) });
  if (outcome.kind !== "ok") {
    // A later refusal cannot prove the first ambiguous dispatch moved no money. Keep it unknown.
    const recorded = { ...outcome, kind: "unknown" as const };
    await deps.ledger.transaction({ fn: async tx => {
      await tx.lockPayment({ ...scopeOf(payment), id: payment.id });
      await markAttempt({ tx, deps, attemptId: attempt.id, outcome: recorded });
      await tx.updateAttempt({ id: attempt.id, patch: { recoveryClaimUntil: null, updatedAt: deps.now() } });
    } });
    return { ok: false, why: outcome.error.message };
  }
  // The writer closes the attempt atomically with evidence. A crash here leaves a replayable claim.
  const evidence = outcome.value.evidence.next ? outcome.value.evidence : { ...outcome.value.evidence, next: outcome.value.next };
  return { ok: true, evidence, provider, recoveryAttemptId: attempt.id };
}
