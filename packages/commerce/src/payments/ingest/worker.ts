/**
 * @file The webhook INBOX WORKER (lot L5): turns recorded webhook facts into ledger writes through
 * the ONE writer (`applyPaymentEvidence`). Receive (`receive.ts`) only records; everything that can
 * fail slowly or race lives here, where it can be retried.
 *
 * Per due row: parse the fact → find the payment (provider ref first, then our correlation id) →
 * apply in ONE transaction together with the row's own state change (applied rows are purged in
 * that same transaction, so the fact never outlives its apply). What cannot be applied yet — a
 * webhook that beat our own insert, an unmatched refund, a provider that cannot be reached — is
 * parked with backoff, and dead-lettered with an alert after `maxAttempts`. A row is never lost:
 * any unexpected throw parks it, and a dead letter KEEPS its fact — `requeue` (an operator, once the
 * cause is fixed) or a verified redelivery of the same event (`receive.ts`) reopens it.
 *
 * `LedgerConstraintError` (a provider ref already held by ANOTHER payment, L3 known limit) is
 * fatal for its transaction — on Postgres it poisons it — so the apply is rolled back and the
 * dead-letter + quarantine are written in a NEW transaction.
 *
 * SINGLE WORKER in v1: `listDueInbox` is a plain read, not a claim, so two workers would apply the
 * same rows (harmless to money — the writer is idempotent and serialized by the payment lock — but
 * double attempts and alerts). A multi-worker host needs a lease column / `SKIP LOCKED` first.
 */
import { noopAlertPort, type PaymentsAlert, type PaymentsAlertPort } from "../contract/alerts.js";
import type { PaymentEvidence, WebhookFact } from "../contract/evidence.js";
import type { PaymentProvider } from "../contract/provider.js";
import type { PaymentScope } from "../contract/scope.js";
import { applyPaymentEvidence, type ApplyResult } from "../accounting/apply-evidence.js";
import { LedgerConstraintError, type LedgerTx, type PaymentsLedger } from "../ledger/repo.js";
import type { EvidenceSource, InboxRecord, PaymentRecord } from "../ledger/rows.js";
import type { KernelProviderRegistry, ProviderContextPort } from "../provider-registry.js";

export interface InboxWorkerDeps {
  readonly ledger: PaymentsLedger;
  readonly providers: KernelProviderRegistry;
  readonly contexts: ProviderContextPort;
  readonly now: () => number;
  readonly newId: () => string;
}

export interface InboxWorkerOptions {
  /** Where dead letters and quarantines are reported. Default: dropped (`noop`). */
  readonly alerts?: PaymentsAlertPort;
  /** Total tries before a row is dead-lettered. Default 8. */
  readonly maxAttempts?: number;
  /** Delay in ms before retry number `attempt + 1`, given the 1-based attempt that just failed. */
  readonly backoff?: (attempt: number) => number;
}

/** What one `runOnce` did. `applied`/`parked`/`dead` partition the rows; `quarantined` counts rows whose evidence was quarantined. */
export interface InboxRunCounts {
  readonly seen: number;
  readonly applied: number;
  readonly parked: number;
  readonly dead: number;
  readonly quarantined: number;
}

export interface InboxWorker {
  runOnce(required: { limit: number }, optional?: Record<string, never>): Promise<InboxRunCounts>;
  /**
   * Operator recovery: reopens a dead letter from its kept fact, due now. False (nothing changed)
   * for a missing, open or applied row, or a dead letter with no fact to replay (wait for the
   * provider to redeliver it instead).
   */
  requeue(required: { id: string }, optional?: Record<string, never>): Promise<boolean>;
}

const DEFAULT_MAX_ATTEMPTS = 8;
/** 30 s, doubling, capped at one hour. */
const defaultBackoff = (attempt: number): number => Math.min(30_000 * 2 ** (attempt - 1), 3_600_000);

interface Quarantine {
  readonly reason: string;
  readonly evidenceJson: string;
}

const RETRY_REASON: Readonly<Record<Exclude<ApplyResult["kind"], "quarantined">, string>> = {
  applied: "refund evidence deferred (not matchable yet)",
  deferred: "evidence deferred",
  missing: "payment vanished under its lock",
};

/** What processing a row decided; `settle` turns it into the row's state change. */
type Verdict =
  | { readonly kind: "applied"; readonly paymentId: string; readonly quarantined: readonly string[] }
  | { readonly kind: "retry"; readonly error: string; readonly paymentId: string | null }
  | { readonly kind: "dead"; readonly error: string; readonly paymentId: string | null; readonly quarantine?: Quarantine };

interface Settled {
  readonly state: "applied" | "parked" | "dead";
  readonly quarantined: boolean;
  readonly alerts: readonly PaymentsAlert[];
}

interface Env {
  readonly deps: InboxWorkerDeps;
  readonly alerts: PaymentsAlertPort;
  readonly maxAttempts: number;
  readonly backoff: (attempt: number) => number;
}

interface Located {
  readonly evidence: PaymentEvidence;
  readonly source: EvidenceSource;
}

const scopeOf = (row: InboxRecord): PaymentScope => ({
  workspaceId: row.workspaceId, siteId: row.siteId, providerId: row.providerId, providerAccountId: row.providerAccountId, mode: row.mode,
});

/** The recorded fact, or null when the row's payload is missing or unreadable (it can never apply). */
function parseFact(factsJson: string | null): WebhookFact | null {
  try {
    const fact = JSON.parse(factsJson ?? "null") as WebhookFact | null;
    return typeof fact?.providerRef === "string" ? fact : null;
  } catch {
    return null;
  }
}

/** Ids, counts and our own messages only — never a provider's error text (it may echo credentials). */
function alertFor(row: InboxRecord, kind: PaymentsAlert["kind"], paymentId: string | null, detail: string): PaymentsAlert {
  return { kind, workspaceId: row.workspaceId, mode: row.mode, paymentId, detail: `inbox ${row.id} (${row.providerId} event ${row.providerEventId}): ${detail}` };
}

async function deadLetter(
  { env, tx, row, verdict }: { env: Env; tx: LedgerTx; row: InboxRecord; verdict: { error: string; paymentId: string | null; quarantine?: Quarantine } }
): Promise<Settled> {
  const now = env.deps.now();
  await tx.deadInbox({ id: row.id, error: verdict.error });
  if (verdict.quarantine) {
    await tx.insertQuarantine({
      entry: {
        id: env.deps.newId(), workspaceId: row.workspaceId, mode: row.mode, paymentId: verdict.paymentId, subject: "payment",
        reason: verdict.quarantine.reason, evidenceJson: verdict.quarantine.evidenceJson, createdAt: now,
      },
    });
  }
  return { state: "dead", quarantined: verdict.quarantine !== undefined, alerts: [alertFor(row, "inbox-dead-letter", verdict.paymentId, verdict.error)] };
}

/** Writes the row's state change for a verdict, inside `tx`. */
async function settle({ env, tx, row, verdict }: { env: Env; tx: LedgerTx; row: InboxRecord; verdict: Verdict }): Promise<Settled> {
  const attempt = row.attempts + 1;
  if (verdict.kind === "dead") return deadLetter({ env, tx, row, verdict });
  if (verdict.kind === "retry") {
    if (attempt >= env.maxAttempts) return deadLetter({ env, tx, row, verdict: { ...verdict, error: `${verdict.error} (gave up after ${attempt} attempts)` } });
    await tx.parkInbox({ id: row.id, error: verdict.error, nextAttemptAt: env.deps.now() + env.backoff(attempt) });
    return { state: "parked", quarantined: false, alerts: [] };
  }
  // The writer already quarantined what it refused (kept, never dropped); the row itself is done.
  await tx.markInboxApplied({ id: row.id, appliedAt: env.deps.now() });
  const quarantined = verdict.quarantined.length > 0;
  const alerts = quarantined ? [alertFor(row, "quarantine", verdict.paymentId, `evidence quarantined: ${verdict.quarantined.join(", ")}`)] : [];
  return { state: "applied", quarantined, alerts };
}

const settleAlone = (env: Env, row: InboxRecord, verdict: Verdict): Promise<Settled> =>
  env.deps.ledger.transaction({ fn: (tx) => settle({ env, tx, row, verdict }) });

/** The evidence to apply: the fact's own, or a `retrieve` snapshot for an id-only event. */
async function evidenceFor(env: Env, row: InboxRecord, fact: WebhookFact, provider: PaymentProvider): Promise<Located | { error: string }> {
  if (fact.evidence) return { evidence: fact.evidence, source: "webhook" };
  // The method's presence is what matters; the module guard ties it to `capabilities.retrieve` at load.
  if (!provider.retrieve) return { error: `id-only event and provider '${provider.id}' cannot retrieve` };
  try {
    const resolved = await env.deps.contexts.resolve({ scope: scopeOf(row), provider });
    if (!resolved.ok) return { error: `provider context unavailable: ${resolved.error.code}` };
    const snapshot = await provider.retrieve({ providerRef: fact.providerRef, ctx: resolved.ctx });
    return snapshot.kind === "ok" ? { evidence: snapshot.value, source: "retrieve" } : { error: `retrieve ${snapshot.kind}: ${snapshot.error.code}` };
  } catch (error) {
    return { error: `retrieve threw ${(error as Error)?.name ?? "a non-error"}` };
  }
}

/**
 * The payment this evidence is about: the provider ref (fenced by the row's workspace, mode,
 * provider and account) first, else our correlation id. A correlation hit at another provider
 * account is not ours to touch. The SITE is deliberately not fenced: one provider account shared
 * by two sites delivers each event to both endpoints, the inbox keeps whichever arrived first, and
 * the payment may belong to the other site.
 */
async function locate(tx: LedgerTx, row: InboxRecord, evidence: PaymentEvidence): Promise<PaymentRecord | null | "foreign"> {
  const byRef = await tx.findPaymentByProviderRef({ ...scopeOf(row), providerRef: evidence.providerRef });
  if (byRef) return byRef;
  if (!evidence.correlationId) return null;
  const byId = await tx.getPayment({ workspaceId: row.workspaceId, mode: row.mode, id: evidence.correlationId });
  if (!byId) return null;
  return byId.providerId === row.providerId && byId.providerAccountId === row.providerAccountId ? byId : "foreign";
}

async function applyInTx(env: Env, tx: LedgerTx, row: InboxRecord, found: Located, seen: { paymentId: string | null }): Promise<Verdict> {
  const payment = await locate(tx, row, found.evidence);
  if (payment === "foreign") {
    return { kind: "dead", error: "correlation id names a payment at another provider account", paymentId: null, quarantine: { reason: "scope-mismatch", evidenceJson: JSON.stringify(found.evidence) } };
  }
  // A webhook can beat our own insert of the payment: wait for it.
  if (!payment) return { kind: "retry", error: "payment not found yet", paymentId: null };
  seen.paymentId = payment.id;
  const result = await applyPaymentEvidence(
    // The writer raises `over-withdrawn` through the worker's own alert sink (L4: alert, never cap).
    { tx, deps: { now: env.deps.now, newId: env.deps.newId, alerts: env.alerts }, workspaceId: row.workspaceId, mode: row.mode, paymentId: payment.id, source: found.source, evidence: found.evidence },
    { inboxId: row.id }
  );
  if (result.kind === "quarantined") return { kind: "applied", paymentId: payment.id, quarantined: [result.reason] };
  if (result.kind === "applied" && result.deferred === 0) return { kind: "applied", paymentId: payment.id, quarantined: result.quarantined };
  // A refund not matchable yet: retry the whole observation (the writer is idempotent). The
  // lookup also names the kinds `applyPaymentEvidence` does not return today, without a branch each.
  return { kind: "retry", error: RETRY_REASON[result.kind], paymentId: payment.id };
}

/** A throw out of the apply transaction (already rolled back) → what to write in a NEW transaction. */
function verdictForThrow(error: unknown, paymentId: string | null, evidence: PaymentEvidence): Verdict {
  if (error instanceof LedgerConstraintError) {
    const reason = error.kind === "unique" ? "ref-conflict" : `constraint-${error.kind}`;
    return { kind: "dead", error: error.message, paymentId, quarantine: { reason, evidenceJson: JSON.stringify(evidence) } };
  }
  return { kind: "retry", error: `apply threw ${(error as Error)?.name ?? "a non-error"}`, paymentId };
}

async function applyAndSettle(env: Env, row: InboxRecord, found: Located): Promise<Settled> {
  const seen: { paymentId: string | null } = { paymentId: null };
  try {
    return await env.deps.ledger.transaction({ fn: async (tx) => settle({ env, tx, row, verdict: await applyInTx(env, tx, row, found, seen) }) });
  } catch (error) {
    return settleAlone(env, row, verdictForThrow(error, seen.paymentId, found.evidence));
  }
}

async function processRow(env: Env, row: InboxRecord): Promise<Settled> {
  const fact = parseFact(row.factsJson);
  if (!fact) return settleAlone(env, row, { kind: "dead", error: "inbox row has no readable fact", paymentId: null });
  const registered = env.deps.providers.get({ id: row.providerId });
  if (!registered) return settleAlone(env, row, { kind: "retry", error: `provider '${row.providerId}' is not registered`, paymentId: null });
  const found = await evidenceFor(env, row, fact, registered.provider);
  if ("error" in found) return settleAlone(env, row, { kind: "retry", error: found.error, paymentId: null });
  return applyAndSettle(env, row, found);
}

/** Alerts go out after the commit; a failing alert port must not stop the worker (the row is already settled). */
async function raiseAll(port: PaymentsAlertPort, alerts: readonly PaymentsAlert[]): Promise<void> {
  for (const alert of alerts) await port.raise({ alert }).catch(() => undefined);
}

/**
 * Builds the worker. Call `runOnce` on a timer; one runner per database (see the file header).
 * @complexity O(limit) rows per run, one or two ledger transactions per row.
 */
export function createInboxWorker(deps: InboxWorkerDeps, optional: InboxWorkerOptions = {}): InboxWorker {
  const env: Env = {
    deps, alerts: optional.alerts ?? noopAlertPort, maxAttempts: optional.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, backoff: optional.backoff ?? defaultBackoff,
  };
  return {
    runOnce: async ({ limit }) => {
      const due = await deps.ledger.transaction({ fn: (tx) => tx.listDueInbox({ now: deps.now(), limit }) });
      const counts = { seen: due.length, applied: 0, parked: 0, dead: 0, quarantined: 0 };
      for (const row of due) {
        const settled = await processRow(env, row);
        counts[settled.state] += 1;
        if (settled.quarantined) counts.quarantined += 1;
        await raiseAll(env.alerts, settled.alerts);
      }
      return counts;
    },
    requeue: ({ id }) => deps.ledger.transaction({ fn: async (tx) => {
      const row = await tx.getInbox({ id });
      if (row?.state !== "dead" || row.factsJson === null) return false;
      return tx.reviveInbox({ id, nextAttemptAt: deps.now() });
    } }),
  };
}
