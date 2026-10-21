import Database from "better-sqlite3";
import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";

import type { PaymentsAlertPort } from "../../contract/alerts.js";
import type { PaymentEvidence, RefundEvidence } from "../../contract/evidence.js";
import type { PaymentsLedger } from "../../ledger/repo.js";
import { memoryPaymentsLedger } from "../../ledger/repo.memory.js";
import type { NewPayment } from "../../ledger/rows.js";
import { migrateCommercePayments, sqlPaymentsLedger } from "../../ledger/sql.js";
import { createLipayFake, lipayFakeContext } from "../../testkit/lipay-fake.js";
import {
  applyPaymentEvidence, applyRefundEvidence, recordRefundDispatchOutcome, reserveRefund,
} from "../apply-evidence.js";

/**
 * @file Test harness for the single writer: a ledger (in-memory or SQL over SQLite), the
 * deterministic LiPay fake, and one-transaction helpers around each writer function.
 */

export const NOW = 1_800_000_000_000;
export const USD = (minorUnits: number) => ({ minorUnits, currency: "USD" });

export function newPayment(overrides: Partial<NewPayment> = {}): NewPayment {
  return {
    id: "pay_1", workspaceId: "ws", siteId: "site", providerId: "lipay", providerAccountId: "acct_fake", mode: "test",
    idempotencyKey: "idem-pay", reference: "order-1", partyId: null, currency: "USD", amountMinor: 10_000, capturedMinor: 0,
    intentStatus: "unknown", refundedMinor: 0, refundHeldMinor: 0, disputedMinor: 0, status: "unknown", providerRef: null,
    nextActionJson: null, feeCurrency: null, feeMinor: null, netCurrency: null, netMinor: null, settlementCurrency: null,
    settlementMinor: null, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

export type LedgerKind = "memory" | "sqlite";

export async function openLedger(kind: LedgerKind): Promise<PaymentsLedger> {
  if (kind === "memory") return memoryPaymentsLedger();
  const kernel = openMemorySqliteKernel<unknown>({ open: (filePath, options) => new Database(filePath, options) });
  await migrateCommercePayments({ kernel });
  return sqlPaymentsLedger({ kernel });
}

/** A paid $100 payment on a fresh ledger, with the fake provider that charged it. */
/** An alert port that records what it was asked to raise. */
export function recordingAlerts(optional: { fail?: boolean } = {}): PaymentsAlertPort & { raised: Parameters<PaymentsAlertPort["raise"]>[0]["alert"][] } {
  const raised: Parameters<PaymentsAlertPort["raise"]>[0]["alert"][] = [];
  return {
    raised,
    raise: async ({ alert }) => {
      raised.push(alert);
      if (optional.fail === true) throw new Error("alert sink down");
    },
  };
}

export async function paidPayment(kind: LedgerKind, optional: { echoesCorrelation?: boolean; alerts?: PaymentsAlertPort } = {}) {
  const ledger = await openLedger(kind);
  const fake = createLipayFake({ now: () => NOW }, optional);
  const ctx = lipayFakeContext({ now: () => NOW });
  let seq = 0;
  const deps = { now: () => NOW, newId: () => `id_${++seq}`, ...(optional.alerts ? { alerts: optional.alerts } : {}) };
  const scope = { workspaceId: "ws", mode: "test" } as const;
  await ledger.transaction((tx) => tx.insertPayment({ payment: newPayment() }));
  const charged = await fake.provider.createIntent({
    req: { amount: USD(10_000), idempotencyKey: "idem-pay", correlationId: "pay_1", captureMode: "auto" }, ctx,
  });
  if (charged.kind !== "ok") throw new Error("fake charge failed");

  const w = {
    ledger, fake, ctx, deps,
    payment: (evidence: PaymentEvidence, source: "response" | "webhook" | "retrieve" = "webhook") =>
      ledger.transaction((tx) => applyPaymentEvidence({ tx, deps, ...scope, paymentId: "pay_1", source, evidence })),
    refundEvidence: (evidence: RefundEvidence, refundId?: string) =>
      ledger.transaction((tx) => applyRefundEvidence({ tx, deps, ...scope, paymentId: "pay_1", source: "response", evidence }, refundId === undefined ? {} : { refundId })),
    reserve: (refundId: string, amountMinor: number) =>
      ledger.transaction((tx) => reserveRefund({ tx, deps, ...scope, paymentId: "pay_1", refundId, amountMinor, idempotencyKey: `k_${refundId}` })),
    dispatchOutcome: (refundId: string, outcome: "rejected" | "unknown") =>
      ledger.transaction((tx) => recordRefundDispatchOutcome({ tx, deps, ...scope, paymentId: "pay_1", refundId, outcome })),
    /** Dispatch a reserved refund to the fake; returns its synchronous outcome. */
    dispatch: (refundId: string, amountMinor: number) =>
      fake.provider.refund!({ req: { providerRef: "ch_1", amount: USD(amountMinor), idempotencyKey: `k_${refundId}`, correlationId: refundId }, ctx }),
    /** Deliver a signed webhook through the fake's real verifier and apply its fact. */
    webhook: async (type: "refund.updated" | "charge.refunded" | "charge.succeeded", id: string, eventId: string) => {
      const verified = await fake.provider.verifyWebhook({ ...fake.server.webhook({ type, id, eventId }), ctx });
      if (verified.kind !== "ok") throw new Error("fake webhook rejected");
      return verified.value[0]!.evidence!;
    },
    retrieve: async () => {
      const snapshot = await fake.provider.retrieve!({ providerRef: "ch_1", ctx });
      if (snapshot.kind !== "ok") throw new Error("fake retrieve failed");
      return snapshot.value;
    },
    read: () => ledger.transaction(async (tx) => ({
      payment: (await tx.getPayment({ workspaceId: "ws", mode: "test", id: "pay_1" }))!,
      refunds: await tx.listRefunds({ paymentId: "pay_1" }),
      outbox: (await tx.listPendingOutbox({ limit: 100 })).map((m) => m.topic),
      quarantine: await tx.listQuarantine({ workspaceId: "ws", mode: "test" }),
      evidence: await tx.listEvidence({ paymentId: "pay_1" }),
    })),
  };
  await w.payment(charged.value.evidence, "response");
  return w;
}
