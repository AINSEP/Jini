import { describe, expect, test } from "vitest";

import { LedgerConstraintError, type LedgerTx, type PaymentsLedger } from "../repo.js";
import type {
  AttemptRecord, DisputeRecord, EvidenceRecord, NewInbox, NewOutbox, NewPayment, NewQuarantine, PaymentPatch, RefundRecord,
} from "../rows.js";

/**
 * @file THE contract every `PaymentsLedger` adapter must pass: run by `memory.vitest.test.ts`
 * (in-memory), `sqlite.vitest.test.ts` (SQL over better-sqlite3) and `postgres.vitest.test.ts`
 * (SQL over a real Postgres, local only). One suite, so the fake used by L3/L4 tests cannot drift
 * from the database.
 */

export interface LedgerHarness {
  ledger: PaymentsLedger;
  close(): Promise<void>;
}

const WS = "ws-1";

export function payment(overrides: Partial<NewPayment> = {}): NewPayment {
  return {
    id: "pay-1", workspaceId: WS, siteId: "site-1", providerId: "stripe", providerAccountId: "acct-1", mode: "live",
    idempotencyKey: "idem-1", reference: "order-1", partyId: null, currency: "USD", amountMinor: 10_000, capturedMinor: 0,
    intentStatus: "pending", refundedMinor: 0, refundHeldMinor: 0, disputedMinor: 0, status: "pending", providerRef: null,
    nextActionJson: null, feeCurrency: null, feeMinor: null, netCurrency: null, netMinor: null, settlementCurrency: null,
    settlementMinor: null, createdAt: 1_000, updatedAt: 1_000, ...overrides,
  };
}

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id: "att-1", paymentId: "pay-1", workspaceId: WS, mode: "live", op: "intent", operationKey: "op-1", refundId: null,
    outcome: "dispatched", errorCode: null, errorMessage: null, createdAt: 1_000, updatedAt: 1_000, ...overrides,
  };
}

function refund(overrides: Partial<RefundRecord> = {}): RefundRecord {
  return {
    id: "ref-1", paymentId: "pay-1", workspaceId: WS, siteId: "site-1", providerId: "stripe", providerAccountId: "acct-1",
    mode: "live", idempotencyKey: "ridem-1", providerRefundRef: null, currency: "USD", amountMinor: 3_000, status: "reserved",
    reason: null, createdAt: 2_000, updatedAt: 2_000, ...overrides,
  };
}

function dispute(overrides: Partial<DisputeRecord> = {}): DisputeRecord {
  return {
    id: "dis-1", paymentId: "pay-1", workspaceId: WS, providerId: "stripe", providerAccountId: "acct-1", mode: "live",
    providerDisputeRef: "dp_1", currency: "USD", amountMinor: 10_000, status: "open", dueBy: 9_000, createdAt: 3_000,
    updatedAt: 3_000, ...overrides,
  };
}

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "ev-1", paymentId: "pay-1", workspaceId: WS, mode: "live", source: "webhook", subject: "refund", subjectRef: "re_1",
    observedStatus: "succeeded", currency: "USD", amountMinor: 3_000, inboxId: "in-1", recordedAt: 4_000, ...overrides,
  };
}

function inbox(overrides: Partial<NewInbox> = {}): NewInbox {
  return {
    id: "in-1", workspaceId: WS, siteId: "site-1", providerId: "stripe", providerAccountId: "acct-1", mode: "live",
    providerEventId: "evt_1", factsJson: '{"facts":[]}', bodySha256: "ab".repeat(32), nextAttemptAt: 5_000, receivedAt: 5_000,
    ...overrides,
  };
}

function outbox(overrides: Partial<NewOutbox> = {}): NewOutbox {
  return {
    id: "out-1", workspaceId: WS, mode: "live", topic: "refund.succeeded", aggregateId: "ref-1", payloadJson: "{}", createdAt: 6_000,
    ...overrides,
  };
}

function quarantine(overrides: Partial<NewQuarantine> = {}): NewQuarantine {
  return {
    id: "q-1", workspaceId: WS, mode: "live", paymentId: "pay-1", subject: "refund", reason: "over-refund", evidenceJson: "{}",
    createdAt: 7_000, ...overrides,
  };
}

async function expectConstraint(promise: Promise<unknown>, kind: "unique" | "foreign-key", table: string): Promise<void> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(LedgerConstraintError);
  expect((error as LedgerConstraintError).kind).toBe(kind);
  expect((error as LedgerConstraintError).table).toBe(table);
  expect((error as LedgerConstraintError).name).toBe("LedgerConstraintError");
}

export function ledgerContract(adapter: string, open: () => Promise<LedgerHarness>): void {
  describe(`PaymentsLedger contract: ${adapter}`, () => {
    /** One fresh ledger per test; `fn` runs inside a transaction. */
    async function within<T>(fn: (tx: LedgerTx, ledger: PaymentsLedger) => Promise<T>): Promise<T> {
      const harness = await open();
      try {
        return await harness.ledger.transaction((tx) => fn(tx, harness.ledger));
      } finally {
        await harness.close();
      }
    }

    async function withLedger(fn: (ledger: PaymentsLedger) => Promise<void>): Promise<void> {
      const harness = await open();
      try {
        await fn(harness.ledger);
      } finally {
        await harness.close();
      }
    }

    describe("payments", () => {
      test("round-trips every column, starting at version 1", async () => {
        await within(async (tx) => {
          const full = payment({
            partyId: "party-9", providerRef: "pi_1", nextActionJson: '{"kind":"none"}', feeCurrency: "USD", feeMinor: 320,
            netCurrency: "USD", netMinor: 9_680, settlementCurrency: "EUR", settlementMinor: 9_100, capturedMinor: 10_000,
            intentStatus: "succeeded", status: "succeeded", amountMinor: Number.MAX_SAFE_INTEGER,
          });
          const stored = await tx.insertPayment({ payment: full });
          expect(stored).toEqual({ ...full, version: 1 });
          expect(await tx.getPayment({ workspaceId: WS, mode: "live", id: "pay-1" })).toEqual({ ...full, version: 1 });
        });
      });

      test("lookups are fenced by workspace and mode", async () => {
        await within(async (tx) => {
          await tx.insertPayment({ payment: payment({ providerRef: "pi_1" }) });
          expect(await tx.getPayment({ workspaceId: WS, mode: "test", id: "pay-1" })).toBeNull();
          expect(await tx.getPayment({ workspaceId: "ws-2", mode: "live", id: "pay-1" })).toBeNull();
          expect(await tx.getPayment({ workspaceId: WS, mode: "live", id: "missing" })).toBeNull();
          expect((await tx.findPaymentByIdempotencyKey({ workspaceId: WS, mode: "live", key: "idem-1" }))?.id).toBe("pay-1");
          expect(await tx.findPaymentByIdempotencyKey({ workspaceId: WS, mode: "test", key: "idem-1" })).toBeNull();
          const refScope = { workspaceId: WS, mode: "live", providerId: "stripe", providerAccountId: "acct-1" } as const;
          expect((await tx.findPaymentByProviderRef({ ...refScope, providerRef: "pi_1" }))?.id).toBe("pay-1");
          expect(await tx.findPaymentByProviderRef({ ...refScope, providerAccountId: "acct-2", providerRef: "pi_1" })).toBeNull();
          expect(await tx.findPaymentByProviderRef({ ...refScope, providerRef: "pi_2" })).toBeNull();
        });
      });

      test("the idempotency key is unique per workspace + mode, and may repeat across them", async () => {
        await withLedger(async (ledger) => {
          await ledger.transaction(async (tx) => {
            await tx.insertPayment({ payment: payment() });
            await tx.insertPayment({ payment: payment({ id: "pay-2", mode: "test" }) });
            await tx.insertPayment({ payment: payment({ id: "pay-3", workspaceId: "ws-2" }) });
          });
          await expectConstraint(ledger.transaction((tx) => tx.insertPayment({ payment: payment({ id: "pay-4" }) })), "unique", "commerce_payments");
          await expectConstraint(ledger.transaction((tx) => tx.insertPayment({ payment: payment({ idempotencyKey: "other" }) })), "unique", "commerce_payments");
        });
      });

      test("the provider ref is unique per workspace + mode + provider account; NULL refs never collide", async () => {
        await withLedger(async (ledger) => {
          await ledger.transaction(async (tx) => {
            await tx.insertPayment({ payment: payment() });
            await tx.insertPayment({ payment: payment({ id: "pay-2", idempotencyKey: "idem-2" }) });
            await tx.insertPayment({ payment: payment({ id: "pay-3", idempotencyKey: "idem-3", providerRef: "pi_1" }) });
            await tx.insertPayment({ payment: payment({ id: "pay-4", idempotencyKey: "idem-4", providerRef: "pi_1", providerAccountId: "acct-2" }) });
            await tx.insertPayment({ payment: payment({ id: "pay-5", idempotencyKey: "idem-5", providerRef: "pi_1", mode: "test" }) });
          });
          await expectConstraint(
            ledger.transaction((tx) => tx.insertPayment({ payment: payment({ id: "pay-6", idempotencyKey: "idem-6", providerRef: "pi_1" }) })),
            "unique", "commerce_payments"
          );
          // An update that takes another payment's ref breaks the same key.
          await expectConstraint(
            ledger.transaction((tx) => tx.updatePayment({ id: "pay-2", expectedVersion: 1, patch: { providerRef: "pi_1", updatedAt: 2 } })),
            "unique", "commerce_payments"
          );
        });
      });

      test("updatePayment is optimistic: applies the patch and bumps the version only at the expected version", async () => {
        await within(async (tx) => {
          await tx.insertPayment({ payment: payment() });
          const patch: PaymentPatch = { intentStatus: "succeeded", status: "succeeded", capturedMinor: 10_000, providerRef: "pi_1", updatedAt: 2_000 };
          expect(await tx.updatePayment({ id: "pay-1", expectedVersion: 1, patch })).toBe(true);
          const after = await tx.getPayment({ workspaceId: WS, mode: "live", id: "pay-1" });
          expect(after).toEqual({ ...payment(), ...patch, version: 2 });
          // A writer that read version 1 lost the race: nothing changes.
          expect(await tx.updatePayment({ id: "pay-1", expectedVersion: 1, patch: { status: "failed", updatedAt: 3_000 } })).toBe(false);
          expect((await tx.getPayment({ workspaceId: WS, mode: "live", id: "pay-1" }))?.status).toBe("succeeded");
          expect(await tx.updatePayment({ id: "missing", expectedVersion: 1, patch: { updatedAt: 3_000 } })).toBe(false);
        });
      });

      test("a patch field that is undefined leaves the stored value alone", async () => {
        await within(async (tx) => {
          await tx.insertPayment({ payment: payment({ partyId: "party-1" }) });
          const patch = { partyId: undefined, updatedAt: 2_000 } as unknown as PaymentPatch;
          expect(await tx.updatePayment({ id: "pay-1", expectedVersion: 1, patch })).toBe(true);
          expect((await tx.getPayment({ workspaceId: WS, mode: "live", id: "pay-1" }))?.partyId).toBe("party-1");
        });
      });

      test("lockPayment reads the payment under its lock, or null", async () => {
        await within(async (tx) => {
          await tx.insertPayment({ payment: payment() });
          expect((await tx.lockPayment({ id: "pay-1" }))?.version).toBe(1);
          expect(await tx.lockPayment({ id: "missing" })).toBeNull();
        });
      });
    });

    describe("attempts", () => {
      test("insert, find by operation key (fenced), update, list oldest first", async () => {
        await within(async (tx) => {
          await tx.insertPayment({ payment: payment() });
          await tx.insertAttempt({ attempt: attempt({ id: "att-2", operationKey: "op-2", createdAt: 2_000, op: "refund", refundId: "ref-1" }) });
          await tx.insertAttempt({ attempt: attempt() });
          expect(await tx.findAttemptByOperationKey({ workspaceId: WS, mode: "live", operationKey: "op-2" })).toEqual(
            attempt({ id: "att-2", operationKey: "op-2", createdAt: 2_000, op: "refund", refundId: "ref-1" })
          );
          expect(await tx.findAttemptByOperationKey({ workspaceId: WS, mode: "test", operationKey: "op-2" })).toBeNull();
          expect(await tx.updateAttempt({ id: "att-1", patch: { outcome: "unknown", errorCode: "TIMEOUT", errorMessage: "timed out", updatedAt: 9 } })).toBe(true);
          expect(await tx.updateAttempt({ id: "missing", patch: { outcome: "ok", updatedAt: 9 } })).toBe(false);
          const listed = await tx.listAttempts({ paymentId: "pay-1" });
          expect(listed.map((a) => a.id)).toEqual(["att-1", "att-2"]);
          expect(listed[0]).toEqual(attempt({ outcome: "unknown", errorCode: "TIMEOUT", errorMessage: "timed out", updatedAt: 9 }));
          expect(await tx.listAttempts({ paymentId: "other" })).toEqual([]);
        });
      });

      test("the operation key is unique per workspace + mode; an attempt needs its payment", async () => {
        await withLedger(async (ledger) => {
          await ledger.transaction(async (tx) => {
            await tx.insertPayment({ payment: payment() });
            await tx.insertPayment({ payment: payment({ id: "pay-t", mode: "test" }) });
            await tx.insertAttempt({ attempt: attempt() });
            await tx.insertAttempt({ attempt: attempt({ id: "att-t", paymentId: "pay-t", mode: "test" }) });
          });
          await expectConstraint(ledger.transaction((tx) => tx.insertAttempt({ attempt: attempt({ id: "att-9" }) })), "unique", "commerce_payment_attempts");
          await expectConstraint(
            ledger.transaction((tx) => tx.insertAttempt({ attempt: attempt({ id: "att-8", operationKey: "op-8", paymentId: "nope" }) })),
            "foreign-key", "commerce_payment_attempts"
          );
        });
      });
    });

    describe("refunds", () => {
      test("findRefund matches OUR correlation id first, then the provider's ref", async () => {
        await within(async (tx) => {
          await tx.insertPayment({ payment: payment() });
          await tx.insertPayment({ payment: payment({ id: "pay-2", idempotencyKey: "idem-2" }) });
          await tx.insertRefund({ refund: refund({ id: "ref-a", idempotencyKey: "k-a", providerRefundRef: "re_2" }) });
          await tx.insertRefund({ refund: refund({ id: "ref-b", idempotencyKey: "k-b", providerRefundRef: "re_1" }) });
          await tx.insertRefund({ refund: refund({ id: "ref-c", paymentId: "pay-2", idempotencyKey: "k-c", providerRefundRef: "re_9" }) });
          expect((await tx.findRefund({ paymentId: "pay-1" }, { correlationId: "ref-a", providerRefundRef: "re_1" }))?.id).toBe("ref-a");
          expect((await tx.findRefund({ paymentId: "pay-1" }, { correlationId: "ref-zzz", providerRefundRef: "re_1" }))?.id).toBe("ref-b");
          expect((await tx.findRefund({ paymentId: "pay-1" }, { providerRefundRef: "re_2" }))?.id).toBe("ref-a");
          expect(await tx.findRefund({ paymentId: "pay-1" }, { correlationId: "ref-zzz" })).toBeNull();
          expect(await tx.findRefund({ paymentId: "pay-1" })).toBeNull();
          // Another payment's refund is never matched, by id or by ref.
          expect(await tx.findRefund({ paymentId: "pay-1" }, { correlationId: "ref-c", providerRefundRef: "re_9" })).toBeNull();
        });
      });

      test("insert, update, find by idempotency key (fenced), list oldest first", async () => {
        await within(async (tx) => {
          await tx.insertPayment({ payment: payment() });
          await tx.insertRefund({ refund: refund({ id: "ref-2", idempotencyKey: "k-2", createdAt: 1 }) });
          await tx.insertRefund({ refund: refund() });
          expect(await tx.findRefundByIdempotencyKey({ workspaceId: WS, mode: "live", key: "ridem-1" })).toEqual(refund());
          expect(await tx.findRefundByIdempotencyKey({ workspaceId: "ws-2", mode: "live", key: "ridem-1" })).toBeNull();
          expect(await tx.updateRefund({ id: "ref-1", patch: { status: "succeeded", providerRefundRef: "re_1", reason: "requested", updatedAt: 9 } })).toBe(true);
          expect(await tx.updateRefund({ id: "missing", patch: { status: "failed", updatedAt: 9 } })).toBe(false);
          const listed = await tx.listRefunds({ paymentId: "pay-1" });
          expect(listed.map((r) => r.id)).toEqual(["ref-2", "ref-1"]);
          expect(listed[1]).toEqual(refund({ status: "succeeded", providerRefundRef: "re_1", reason: "requested", updatedAt: 9 }));
        });
      });

      test("idempotency key and provider ref are unique per scope; NULLs never collide; a refund needs its payment", async () => {
        await withLedger(async (ledger) => {
          await ledger.transaction(async (tx) => {
            await tx.insertPayment({ payment: payment() });
            await tx.insertRefund({ refund: refund({ providerRefundRef: "re_1" }) });
            // Unsolicited refunds made at the provider carry no idempotency key: many may coexist.
            await tx.insertRefund({ refund: refund({ id: "ref-2", idempotencyKey: null, providerRefundRef: "re_2" }) });
            await tx.insertRefund({ refund: refund({ id: "ref-3", idempotencyKey: null, providerRefundRef: null }) });
            await tx.insertRefund({ refund: refund({ id: "ref-4", idempotencyKey: "ridem-1", mode: "test", providerRefundRef: "re_1" }) });
          });
          await expectConstraint(ledger.transaction((tx) => tx.insertRefund({ refund: refund({ id: "ref-9" }) })), "unique", "commerce_refunds");
          await expectConstraint(
            ledger.transaction((tx) => tx.insertRefund({ refund: refund({ id: "ref-9", idempotencyKey: "k-9", providerRefundRef: "re_1" }) })),
            "unique", "commerce_refunds"
          );
          await expectConstraint(
            ledger.transaction((tx) => tx.updateRefund({ id: "ref-3", patch: { providerRefundRef: "re_2", updatedAt: 9 } })),
            "unique", "commerce_refunds"
          );
          await expectConstraint(
            ledger.transaction((tx) => tx.insertRefund({ refund: refund({ id: "ref-9", idempotencyKey: "k-9", paymentId: "nope" }) })),
            "foreign-key", "commerce_refunds"
          );
        });
      });
    });

    describe("disputes", () => {
      test("insert, find, update, list; ref unique per scope; needs its payment", async () => {
        await withLedger(async (ledger) => {
          await ledger.transaction(async (tx) => {
            await tx.insertPayment({ payment: payment() });
            await tx.insertDispute({ dispute: dispute() });
            await tx.insertDispute({ dispute: dispute({ id: "dis-0", providerDisputeRef: "dp_0", createdAt: 1, dueBy: null }) });
            await tx.insertDispute({ dispute: dispute({ id: "dis-t", mode: "test" }) });
            expect(await tx.findDispute({ paymentId: "pay-1", providerDisputeRef: "dp_1" })).toEqual(dispute());
            expect(await tx.findDispute({ paymentId: "pay-1", providerDisputeRef: "dp_x" })).toBeNull();
            expect(await tx.updateDispute({ id: "dis-1", patch: { status: "won", amountMinor: 9_000, dueBy: null, updatedAt: 9 } })).toBe(true);
            expect(await tx.updateDispute({ id: "missing", patch: { status: "lost", updatedAt: 9 } })).toBe(false);
            const listed = await tx.listDisputes({ paymentId: "pay-1" });
            expect(listed.map((d) => d.id)).toEqual(["dis-0", "dis-1", "dis-t"]);
            expect(listed[1]).toEqual(dispute({ status: "won", amountMinor: 9_000, dueBy: null, updatedAt: 9 }));
          });
          await expectConstraint(ledger.transaction((tx) => tx.insertDispute({ dispute: dispute({ id: "dis-9" }) })), "unique", "commerce_disputes");
          await expectConstraint(
            ledger.transaction((tx) => tx.insertDispute({ dispute: dispute({ id: "dis-9", providerDisputeRef: "dp_9", paymentId: "nope" }) })),
            "foreign-key", "commerce_disputes"
          );
        });
      });
    });

    describe("evidence", () => {
      test("append-only: appended rows list oldest first, and the port has no way to change them", async () => {
        await withLedger(async (ledger) => {
          await ledger.transaction(async (tx) => {
            await tx.insertPayment({ payment: payment() });
            await tx.appendEvidence({ evidence: evidence() });
            await tx.appendEvidence({ evidence: evidence({ id: "ev-0", recordedAt: 1, source: "response", subject: "payment", currency: null, amountMinor: null, inboxId: null }) });
            const listed = await tx.listEvidence({ paymentId: "pay-1" });
            expect(listed).toEqual([evidence({ id: "ev-0", recordedAt: 1, source: "response", subject: "payment", currency: null, amountMinor: null, inboxId: null }), evidence()]);
            const methods = new Set<string>();
            for (let proto = Object.getPrototypeOf(tx); proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
              for (const name of Object.getOwnPropertyNames(proto)) methods.add(name);
            }
            expect([...methods].filter((name) => /evidence/i.test(name)).sort()).toEqual(["appendEvidence", "listEvidence"]);
          });
          await expectConstraint(ledger.transaction((tx) => tx.appendEvidence({ evidence: evidence() })), "unique", "commerce_payment_evidence");
          await expectConstraint(
            ledger.transaction((tx) => tx.appendEvidence({ evidence: evidence({ id: "ev-9", paymentId: "nope" }) })),
            "foreign-key", "commerce_payment_evidence"
          );
        });
      });
    });

    describe("webhook inbox", () => {
      test("insert-or-ignore: a redelivered event returns the first delivery's id; other scopes are separate events", async () => {
        await within(async (tx) => {
          expect(await tx.insertInbox({ entry: inbox() })).toEqual({ inserted: true, id: "in-1" });
          expect(await tx.insertInbox({ entry: inbox({ id: "in-2", factsJson: "{}" }) })).toEqual({ inserted: false, id: "in-1" });
          expect(await tx.insertInbox({ entry: inbox({ id: "in-3", mode: "test" }) })).toEqual({ inserted: true, id: "in-3" });
          expect(await tx.insertInbox({ entry: inbox({ id: "in-4", providerAccountId: "acct-2" }) })).toEqual({ inserted: true, id: "in-4" });
          expect(await tx.getInbox({ id: "in-1" })).toEqual({
            ...inbox(), state: "received", attempts: 0, lastError: null, appliedAt: null, purgedAt: null,
          });
          expect(await tx.getInbox({ id: "in-2" })).toBeNull();
        });
      });

      test("a different event reusing a row id is a unique violation", async () => {
        await withLedger(async (ledger) => {
          await ledger.transaction((tx) => tx.insertInbox({ entry: inbox() }));
          await expectConstraint(ledger.transaction((tx) => tx.insertInbox({ entry: inbox({ providerEventId: "evt_2" }) })), "unique", "commerce_webhook_inbox");
        });
      });

      test("apply purges the payload but keeps the body hash", async () => {
        await within(async (tx) => {
          await tx.insertInbox({ entry: inbox() });
          expect(await tx.markInboxApplied({ id: "in-1", appliedAt: 8_000 })).toBe(true);
          const applied = await tx.getInbox({ id: "in-1" });
          expect(applied).toMatchObject({ state: "applied", factsJson: null, appliedAt: 8_000, purgedAt: 8_000, bodySha256: "ab".repeat(32) });
          expect(await tx.markInboxApplied({ id: "missing", appliedAt: 8_000 })).toBe(false);
        });
      });

      test("park counts the attempt and reschedules; dead stops retries; only due rows are listed, soonest first", async () => {
        await within(async (tx) => {
          await tx.insertInbox({ entry: inbox({ id: "in-a", providerEventId: "a", nextAttemptAt: 100 }) });
          await tx.insertInbox({ entry: inbox({ id: "in-b", providerEventId: "b", nextAttemptAt: 50 }) });
          await tx.insertInbox({ entry: inbox({ id: "in-c", providerEventId: "c", nextAttemptAt: 50 }) });
          await tx.insertInbox({ entry: inbox({ id: "in-d", providerEventId: "d", nextAttemptAt: 10 }) });
          await tx.insertInbox({ entry: inbox({ id: "in-e", providerEventId: "e", nextAttemptAt: 10 }) });
          await tx.insertInbox({ entry: inbox({ id: "in-f", providerEventId: "f", nextAttemptAt: 999 }) });
          expect(await tx.parkInbox({ id: "in-a", error: "no-payment-yet", nextAttemptAt: 60 })).toBe(true);
          expect(await tx.parkInbox({ id: "in-a", error: "still none", nextAttemptAt: 70 })).toBe(true);
          expect(await tx.getInbox({ id: "in-a" })).toMatchObject({ state: "parked", attempts: 2, lastError: "still none", nextAttemptAt: 70 });
          expect(await tx.deadInbox({ id: "in-d", error: "gave up" })).toBe(true);
          expect(await tx.getInbox({ id: "in-d" })).toMatchObject({ state: "dead", lastError: "gave up", attempts: 0 });
          await tx.markInboxApplied({ id: "in-e", appliedAt: 1 });
          expect(await tx.parkInbox({ id: "missing", error: "x", nextAttemptAt: 1 })).toBe(false);
          expect(await tx.deadInbox({ id: "missing", error: "x" })).toBe(false);
          expect((await tx.listDueInbox({ now: 100, limit: 10 })).map((r) => r.id)).toEqual(["in-b", "in-c", "in-a"]);
          expect((await tx.listDueInbox({ now: 100, limit: 2 })).map((r) => r.id)).toEqual(["in-b", "in-c"]);
          expect(await tx.listDueInbox({ now: 5, limit: 10 })).toEqual([]);
        });
      });
    });

    describe("outbox", () => {
      test("pending messages list oldest first until published", async () => {
        await within(async (tx) => {
          await tx.enqueueOutbox({ message: outbox() });
          await tx.enqueueOutbox({ message: outbox({ id: "out-0", createdAt: 1, topic: "payment.succeeded", aggregateId: "pay-1" }) });
          await tx.enqueueOutbox({ message: outbox({ id: "out-2", createdAt: 9_000 }) });
          expect((await tx.listPendingOutbox({ limit: 10 })).map((m) => m.id)).toEqual(["out-0", "out-1", "out-2"]);
          expect(await tx.listPendingOutbox({ limit: 1 })).toEqual([{ ...outbox({ id: "out-0", createdAt: 1, topic: "payment.succeeded", aggregateId: "pay-1" }), publishedAt: null }]);
          expect(await tx.markOutboxPublished({ id: "out-0", publishedAt: 9 })).toBe(true);
          expect(await tx.markOutboxPublished({ id: "missing", publishedAt: 9 })).toBe(false);
          expect((await tx.listPendingOutbox({ limit: 10 })).map((m) => m.id)).toEqual(["out-1", "out-2"]);
        });
      });
    });

    describe("quarantine", () => {
      test("entries list per scope, oldest first; resolved ones can be hidden", async () => {
        await within(async (tx) => {
          await tx.insertQuarantine({ entry: quarantine() });
          await tx.insertQuarantine({ entry: quarantine({ id: "q-0", createdAt: 1, paymentId: null, subject: "payment", reason: "unmatched" }) });
          await tx.insertQuarantine({ entry: quarantine({ id: "q-t", mode: "test" }) });
          expect(await tx.resolveQuarantine({ id: "q-0", resolvedAt: 9 })).toBe(true);
          expect(await tx.resolveQuarantine({ id: "missing", resolvedAt: 9 })).toBe(false);
          const all = await tx.listQuarantine({ workspaceId: WS, mode: "live" });
          expect(all).toEqual([{ ...quarantine({ id: "q-0", createdAt: 1, paymentId: null, subject: "payment", reason: "unmatched" }), resolvedAt: 9 }, { ...quarantine(), resolvedAt: null }]);
          expect((await tx.listQuarantine({ workspaceId: WS, mode: "live" }, { unresolvedOnly: true })).map((q) => q.id)).toEqual(["q-1"]);
          expect(await tx.listQuarantine({ workspaceId: "ws-2", mode: "live" })).toEqual([]);
        });
      });
    });

    describe("transactions", () => {
      test("a throw rolls back every write in the transaction and rethrows", async () => {
        await withLedger(async (ledger) => {
          const boom = new Error("boom");
          await expect(ledger.transaction(async (tx) => {
            await tx.insertPayment({ payment: payment() });
            await tx.enqueueOutbox({ message: outbox() });
            throw boom;
          })).rejects.toBe(boom);
          await ledger.transaction(async (tx) => {
            expect(await tx.getPayment({ workspaceId: WS, mode: "live", id: "pay-1" })).toBeNull();
            expect(await tx.listPendingOutbox({ limit: 10 })).toEqual([]);
          });
        });
      });

      test("a constraint failure rolls back the writes before it", async () => {
        await withLedger(async (ledger) => {
          await ledger.transaction((tx) => tx.insertPayment({ payment: payment() }));
          await expectConstraint(ledger.transaction(async (tx) => {
            await tx.insertRefund({ refund: refund() });
            await tx.insertPayment({ payment: payment({ id: "pay-2" }) });
          }), "unique", "commerce_payments");
          expect(await ledger.transaction((tx) => tx.listRefunds({ paymentId: "pay-1" }))).toEqual([]);
        });
      });

      test("commits return the callback's value; a nested transaction joins the outer one", async () => {
        await withLedger(async (ledger) => {
          await expect(ledger.transaction(async (tx) => {
            await tx.insertPayment({ payment: payment() });
            const inner = await ledger.transaction(async (nested) => {
              await nested.insertPayment({ payment: payment({ id: "pay-2", idempotencyKey: "idem-2" }) });
              return "inner";
            });
            expect(inner).toBe("inner");
            throw new Error("outer fails");
          })).rejects.toThrow("outer fails");
          // The inner transaction joined the outer one, so the outer failure rolled it back too.
          expect(await ledger.transaction((tx) => tx.lockPayment({ id: "pay-2" }))).toBeNull();
          expect(await ledger.transaction(async () => 42)).toBe(42);
        });
      });

      test("concurrent read-then-write transactions on one payment never interleave", async () => {
        await withLedger(async (ledger) => {
          await ledger.transaction((tx) => tx.insertPayment({ payment: payment() }));
          const bump = () => ledger.transaction(async (tx) => {
            const current = await tx.lockPayment({ id: "pay-1" });
            await new Promise((resolve) => setTimeout(resolve, 5));
            const version = current?.version ?? 0;
            return tx.updatePayment({ id: "pay-1", expectedVersion: version, patch: { refundHeldMinor: version * 100, updatedAt: version } });
          });
          expect(await Promise.all([bump(), bump(), bump()])).toEqual([true, true, true]);
          expect((await ledger.transaction((tx) => tx.lockPayment({ id: "pay-1" })))?.version).toBe(4);
        });
      });

      test("a failed transaction does not block the ones queued behind it", async () => {
        await withLedger(async (ledger) => {
          const failing = ledger.transaction(async () => {
            throw new Error("first fails");
          });
          const next = ledger.transaction((tx) => tx.insertPayment({ payment: payment() }));
          await expect(failing).rejects.toThrow("first fails");
          expect((await next).id).toBe("pay-1");
        });
      });
    });
  });
}
