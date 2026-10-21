import type { PaymentsAlert, PaymentsAlertPort } from "../../contract/alerts.js";
import type { WebhookFact } from "../../contract/evidence.js";
import type { PaymentProvider } from "../../contract/provider.js";
import type { PaymentScope } from "../../contract/scope.js";
import type { LedgerTx, PaymentsLedger } from "../../ledger/repo.js";
import { memoryPaymentsLedger } from "../../ledger/repo.memory.js";
import type { NewInbox, NewPayment } from "../../ledger/rows.js";
import { createKernelProviderRegistry, type ProviderContextPort } from "../../provider-registry.js";
import { createLipayFake, lipayFakeContext } from "../../testkit/lipay-fake.js";
import { createWebhookReceiver, type WebhookEndpointPort } from "../receive.js";

/**
 * @file Ingest test harness: a ledger (memory or SQL over in-memory SQLite), the deterministic
 * LiPay fake behind the real provider registry, a host endpoint table and a recording alert port.
 */

export const T0 = 1_800_000_000_000;
export const USD = (minorUnits: number) => ({ minorUnits, currency: "USD" });
export const SCOPE: PaymentScope = { workspaceId: "ws", siteId: "site", providerId: "lipay", providerAccountId: "acct_fake", mode: "test" };
export const PATH = { siteId: "site", providerId: "lipay", endpointId: "ep1" };

export type LedgerKind = "memory" | "sqlite";

export async function openLedger(kind: LedgerKind): Promise<PaymentsLedger> {
  if (kind === "memory") return memoryPaymentsLedger();
  // Loaded lazily: the SQL adapter (and its migrations) is only needed by the SQLite runs.
  const [{ default: Database }, { openMemorySqliteKernel }, { migrateCommercePayments, sqlPaymentsLedger }] = await Promise.all([
    import("better-sqlite3"), import("@jini-ai/db/kernel/sqlite"), import("../../ledger/sql.js"),
  ]);
  const kernel = openMemorySqliteKernel<unknown>({ open: (filePath, options) => new Database(filePath, options) });
  await migrateCommercePayments({ kernel });
  return sqlPaymentsLedger({ kernel });
}

export function newPayment(overrides: Partial<NewPayment> = {}): NewPayment {
  return {
    id: "pay_1", workspaceId: "ws", siteId: "site", providerId: "lipay", providerAccountId: "acct_fake", mode: "test",
    idempotencyKey: "idem-pay_1", reference: "order-1", partyId: null, currency: "USD", amountMinor: 10_000, capturedMinor: 0,
    intentStatus: "unknown", refundedMinor: 0, refundHeldMinor: 0, disputedMinor: 0, status: "unknown", providerRef: null,
    nextActionJson: null, feeCurrency: null, feeMinor: null, netCurrency: null, netMinor: null, settlementCurrency: null,
    settlementMinor: null, createdAt: T0, updatedAt: T0, ...overrides,
  };
}

export function recordingAlerts(): PaymentsAlertPort & { raised: PaymentsAlert[] } {
  const raised: PaymentsAlert[] = [];
  return { raised, raise: async ({ alert }) => { raised.push(alert); } };
}

/** Everything a test needs, on one clock it can move. */
export async function ingestWorld(kind: LedgerKind = "memory", optional: { echoesCorrelation?: boolean } = {}) {
  const clock = { now: T0 };
  const now = () => clock.now;
  let seq = 0;
  const newId = () => `id_${++seq}`;
  const ledger = await openLedger(kind);
  const fake = createLipayFake({ now }, optional);
  /** Tests rewrite verified facts through this hook (dispute injection, id-only events). */
  const hooks: { mutate: (fact: WebhookFact) => WebhookFact } = { mutate: (fact) => fact };
  const provider: PaymentProvider = {
    ...fake.provider,
    verifyWebhook: async (args) => {
      const verified = await fake.provider.verifyWebhook(args);
      return verified.kind === "ok" ? { kind: "ok", value: verified.value.map((f) => hooks.mutate(f)) } : verified;
    },
  };
  const providers = createKernelProviderRegistry({ items: [{ pluginId: "lipay-fake", module: provider }] });
  const contexts: ProviderContextPort = { resolve: async () => ({ ok: true, ctx: lipayFakeContext({ now }) }) };
  const endpointTable = new Map<string, PaymentScope>([["site/lipay/ep1", SCOPE]]);
  const endpoints: WebhookEndpointPort = {
    resolve: async ({ siteId, providerId, endpointId }) => endpointTable.get(`${siteId}/${providerId}/${endpointId}`) ?? null,
  };
  const receiver = createWebhookReceiver({ ledger, providers, contexts, endpoints, now, newId });
  const alerts = recordingAlerts();

  const tx = <T>(fn: (t: LedgerTx) => Promise<T>) => ledger.transaction(fn);

  /** Insert our payment row (as the intent op does before dispatching), then charge the fake. */
  const charge = async (paymentId = "pay_1", overrides: Partial<NewPayment> = {}) => {
    const result = await fake.provider.createIntent({
      req: { amount: USD(overrides.amountMinor ?? 10_000), idempotencyKey: `idem-${paymentId}`, correlationId: paymentId, captureMode: "auto" },
      ctx: lipayFakeContext({ now }),
    });
    if (result.kind !== "ok") throw new Error("fake charge failed");
    return result.value.evidence.providerRef;
  };
  const insertPayment = (overrides: Partial<NewPayment> = {}) => tx((t) => t.insertPayment({ payment: newPayment(overrides) }));

  /** Deliver a signed fake webhook through the receiver (endpoint → verify → inbox). */
  const deliver = async (type: "refund.updated" | "charge.refunded" | "charge.succeeded", id: string, eventId: string) => {
    const resolved = await receiver.resolveEndpoint({ path: PATH });
    if (!resolved.ok) throw new Error("endpoint did not resolve");
    return receiver.receive({ endpoint: resolved.endpoint, ...fake.server.webhook({ type, id, eventId }) });
  };

  /** Write an inbox row directly (for rows a receiver would never produce). */
  const insertInbox = (overrides: Partial<NewInbox> & { fact?: unknown } = {}) => {
    const { fact, ...rest } = overrides;
    return tx((t) => t.insertInbox({
      entry: {
        id: newId(), ...SCOPE, providerEventId: `evt_${seq}`, factsJson: JSON.stringify(fact ?? null), bodySha256: "0".repeat(64),
        nextAttemptAt: clock.now, receivedAt: clock.now, ...rest,
      },
    }));
  };

  const read = (paymentId = "pay_1") => tx(async (t) => ({
    payment: (await t.getPayment({ workspaceId: "ws", mode: "test", id: paymentId }))!,
    refunds: await t.listRefunds({ paymentId }),
    disputes: await t.listDisputes({ paymentId }),
    evidence: await t.listEvidence({ paymentId }),
    quarantine: await t.listQuarantine({ workspaceId: "ws", mode: "test" }),
    outbox: await t.listPendingOutbox({ limit: 100 }),
  }));
  const inbox = (id: string) => tx((t) => t.getInbox({ id }));

  return { clock, now, newId, ledger, fake, provider, hooks, providers, contexts, endpoints, endpointTable, receiver, alerts, tx, charge, insertPayment, deliver, insertInbox, read, inbox };
}
