/**
 * @file Read models for the consumer port: ledger records → `PaymentView` / `RefundView` /
 * `ProviderSummary`. Money is rebuilt from minor units + the row's currency; nothing here writes.
 */
import type { Money } from "../../money/money.js";
import type { NextAction } from "../contract/evidence.js";
import type { PaymentView, ProviderSummary, RefundView } from "../contract/payments-port.js";
import type { PaymentScope } from "../contract/scope.js";
import type { PaymentRecord, RefundRecord } from "../ledger/rows.js";
import type { RegisteredProvider } from "../provider-registry.js";

type Scoped = Pick<PaymentRecord, "workspaceId" | "siteId" | "providerId" | "providerAccountId" | "mode">;

/** The full scope a payment or refund row carries. */
export function scopeOf(record: Scoped, _optional: Record<string, never> = {}): PaymentScope {
  return {
    workspaceId: record.workspaceId, siteId: record.siteId, providerId: record.providerId,
    providerAccountId: record.providerAccountId, mode: record.mode,
  };
}

function minor(minorUnits: number, currency: string): Money {
  return { minorUnits, currency };
}

export function paymentView(record: PaymentRecord, _optional: Record<string, never> = {}): PaymentView {
  const c = record.currency;
  return {
    id: record.id, scope: scopeOf(record), status: record.status, amount: minor(record.amountMinor, c),
    captured: minor(record.capturedMinor, c), refunded: minor(record.refundedMinor, c), refundHeld: minor(record.refundHeldMinor, c),
    disputed: minor(record.disputedMinor, c), reference: record.reference,
    next: record.nextActionJson === null ? null : (JSON.parse(record.nextActionJson) as NextAction),
  };
}

export function refundView(record: RefundRecord, _optional: Record<string, never> = {}): RefundView {
  return { id: record.id, paymentId: record.paymentId, amount: minor(record.amountMinor, record.currency), status: record.status };
}

export function providerSummary({ provider }: RegisteredProvider, _optional: Record<string, never> = {}): ProviderSummary {
  return { id: provider.id, displayName: provider.displayName, refunds: provider.capabilities.refunds, capture: provider.capabilities.capture };
}
