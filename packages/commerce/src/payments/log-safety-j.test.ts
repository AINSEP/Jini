import { expect, test } from "vitest";
import { LedgerConstraintError, type PaymentsLedger } from "./ledger/repo.js";
import { dispatch, markAttempt } from "./ops/common.js";
import { world, SCRIPTED, USD } from "./ops/__tests__/harness.js";
import { ingestWorld } from "./ingest/__tests__/harness.js";
import { createInboxWorker } from "./ingest/worker.js";

const SECRET = "j-provider-token-private-driver-text";
const COPY = "Payment provider operation failed.";
const failure = () => Object.assign(new Error(SECRET), { stack: `Error: ${SECRET}\n at ${SECRET}` });

test.each(["error", "string"])("J: thrown provider %s remains unknown with safe public copy", async kind => {
  const result = await dispatch({ call: async () => { throw kind === "error" ? failure() : SECRET; } });
  expect(result).toEqual({ kind: "unknown", error: { code: "PROVIDER_ERROR", retryable: true, message: COPY } });
});

test.each(["rejected", "unknown"] as const)("J: returned provider %s preserves codes and persists safe copy", async kind => {
  const w = await world();
  w.scripted.queue("createIntent", { kind, error: { code: "TRANSPORT_ERROR", message: SECRET, retryable: true, providerStatus: 503 } });
  const request = { scope: SCRIPTED, amount: USD(200), idempotencyKey: "safe", reference: "order" };
  const result = await w.service.createIntent(request);
  expect(result).toMatchObject({ ok: false, error: { code: "TRANSPORT_ERROR", message: COPY },
    payment: { status: kind === "unknown" ? "unknown" : "failed" } });
  if (result.ok || !result.payment) throw new Error("expected provider failure");
  const stored = await w.read(result.payment.id);
  expect(stored.attempts).toEqual([expect.objectContaining({ outcome: kind, errorCode: "TRANSPORT_ERROR", errorMessage: COPY })]);
  expect(stored.evidence).toEqual([]);
  expect(stored.outbox).toEqual([]);
  const replay = await w.service.createIntent(request);
  expect(w.scripted.calls).toHaveLength(1);
  expect(JSON.stringify([result, stored, replay])).not.toContain(SECRET);
  if (kind === "rejected") expect(replay).toMatchObject({ ok: false, error: { code: "TRANSPORT_ERROR", retryable: false } });
  else expect(replay).toMatchObject({ ok: true, replayed: true });
});

test("J: the attempt persistence boundary refuses raw provider text independently of dispatch", async () => {
  const w = await world();
  const result = await w.service.createIntent({ scope: SCRIPTED, amount: USD(200), idempotencyKey: "boundary", reference: "order" });
  if (!result.ok) throw new Error("expected a prepared payment");
  const before = await w.read(result.payment.id);
  expect(before.attempts).toHaveLength(1);
  await w.ledger.transaction({ fn: tx => markAttempt({ tx, deps: w.deps, attemptId: before.attempts[0]!.id,
    outcome: { kind: "rejected", error: { code: "DECLINED", message: SECRET, retryable: false } } }) });
  const stored = await w.read(result.payment.id);
  expect(stored.attempts).toEqual([expect.objectContaining({ outcome: "rejected", errorCode: "DECLINED", errorMessage: COPY })]);
  expect(JSON.stringify(stored)).not.toContain(SECRET);
});

test.each(["unique", "foreign-key", "check"] as const)("J: ledger %s failures persist kind and preserve quarantine", async kind => {
  const w = await ingestWorld();
  await w.insertPayment();
  const fact = { providerEventId: "event", providerRef: "ch_1", evidence: {
    providerRef: "ch_1", correlationId: "pay_1", status: "succeeded", amount: USD(200), refunds: [], disputes: [],
  } };
  const row = await w.insertInbox({ providerEventId: "event", fact });
  const error = new LedgerConstraintError({ kind, table: SECRET }, { cause: failure() });
  error.message = SECRET;
  error.stack = SECRET;
  const ledger: PaymentsLedger = { transaction: ({ fn }) => w.ledger.transaction({ fn: tx => fn(new Proxy(tx, {
    get(target, key) {
      if (key === "lockPayment") return async () => { throw error; };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  })) }) };
  expect(await createInboxWorker({ ...w, ledger }).runOnce({ limit: 10 }))
    .toEqual({ seen: 1, applied: 0, parked: 0, dead: 1, quarantined: 1 });
  const inbox = await w.inbox(row.id);
  const stored = await w.read();
  expect(inbox).toMatchObject({ state: "dead", lastError: `Ledger constraint failed (${kind}).`, factsJson: JSON.stringify(fact) });
  expect(stored.quarantine).toEqual([expect.objectContaining({ reason: kind === "unique" ? "ref-conflict" : `constraint-${kind}` })]);
  expect(stored.evidence).toEqual([]);
  expect(stored.payment.capturedMinor).toBe(0);
  expect(JSON.stringify([inbox, stored])).not.toContain(SECRET);
});
