import Database from "better-sqlite3";
import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { sql } from "kysely";
import { afterEach, expect, it, vi } from "vitest";
import { world, SCRIPTED, USD } from "../../../payments/ops/__tests__/harness.js";
import type { PaymentsOutboxMessage } from "../../../payments/ingest/outbox-relay.js";
import type { CommerceDatabase } from "../../database.js";
import { commerceOrderRepoFor } from "../../repo.js";
import { createOrderPaymentProjector } from "../../order-projection.js";
import type { SettleOrderPaymentDeps } from "../../settle-order-payment.js";

const at = "2026-10-29T00:00:00.000Z";
const close: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(close.splice(0).map(fn => fn())); });
const message: PaymentsOutboxMessage = { id: "message", workspaceId: "ws", mode: "test", topic: "payment.succeeded",
  aggregateId: "payment", payload: { reference: "order" }, createdAt: Date.parse(at) };
const unused = async () => { throw new Error("unexpected operation"); };
it.each([{ topic: "refund.succeeded" as const }, { topic: "refund.failed" as const }, { topic: "dispute.opened" as const },
  { topic: "dispute.closed" as const }, { payload: {} }, { payload: { reference: null } }, { payload: { reference: 123 } }])(
  "ignores unrelated topics and absent or non-string references", async change => {
    const findByOrder = vi.fn(unused);
    const deps: SettleOrderPaymentDeps = { orders: { findById: unused, listItems: unused, placeOrder: unused, markPaid: unused },
      orderPayments: { findByOrder, reserve: unused, bind: unused }, payments: { getPayment: unused, createIntent: unused,
        refund: unused, capture: unused, void: unused, listProviders: () => [] }, alerts: { raise: unused }, clock: { nowMs: () => 0 } };
    expect(await createOrderPaymentProjector({ deps }, {}).handle({ message: { ...message, ...change } }, {})).toBe("ignored");
    expect(findByOrder).not.toHaveBeenCalled();
  });
it("redelivers a succeeded payment through real settlement and marks its order paid only once", async () => {
  const w = await world();
  const result = await w.service.createIntent({ scope: SCRIPTED, amount: USD(123), idempotencyKey: "order:order", reference: "order" });
  if (!result.ok) throw new Error("fixture charge failed");
  const kernel = openMemorySqliteKernel<CommerceDatabase>({ open: (path, options) => new Database(path, options) });
  close.push(() => kernel.close());
  await kernel.run(db => sql`CREATE TABLE commerce_orders (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
    member_id TEXT NOT NULL, status TEXT NOT NULL, currency TEXT NOT NULL, total_amount_cents INTEGER NOT NULL,
    provider TEXT NOT NULL, provider_customer_ref TEXT, provider_payment_ref TEXT, provider_event_at TEXT,
    placed_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL)`.execute(db));
  const orders = commerceOrderRepoFor({ kernel });
  await orders.placeOrder({ order: { id: "order", workspaceId: "ws", memberId: "member", status: "pending", totalAmount: USD(123),
    provider: SCRIPTED.providerId, placedAt: at, createdAt: at, updatedAt: at, version: 1 }, items: [] });
  const association = { ...SCRIPTED, orderId: "order", amount: USD(123), paymentId: result.payment.id, createdAt: at };
  const raise = vi.fn(async () => {}), bind = vi.fn(unused);
  const projector = createOrderPaymentProjector({ deps: { orders, payments: w.service, alerts: { raise }, clock: { nowMs: () => Date.parse(at) },
    orderPayments: { findByOrder: async () => association, reserve: unused, bind } } });
  const delivered = { ...message, aggregateId: result.payment.id };
  expect(await projector.handle({ message: delivered })).toBe("paid");
  expect(await projector.handle({ message: delivered })).toBe("already_paid");
  expect(await orders.findById({ workspaceId: "ws", id: "order" })).toMatchObject({ status: "paid", version: 2, updatedAt: at });
  expect(raise).not.toHaveBeenCalled(); expect(bind).not.toHaveBeenCalled();
});
