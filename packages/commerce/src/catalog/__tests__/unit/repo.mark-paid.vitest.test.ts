import Database from "better-sqlite3";
import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { sql } from "kysely";
import { afterEach, expect, it } from "vitest";
import type { CommerceDatabase } from "../../database.js";
import { commerceOrderRepoFor } from "../../repo.js";
import type { CommerceOrderRecord } from "../../types.js";

const at = "2026-10-29T00:00:00.000Z", later = "2026-10-30T00:00:00.000Z";
const order: CommerceOrderRecord = { id: "order", workspaceId: "ws", memberId: "member", status: "pending",
  totalAmount: { minorUnits: 123, currency: "USD" }, provider: "regional-pay", placedAt: at, createdAt: at, updatedAt: at, version: 1 };
const input = { workspaceId: "ws", orderId: "order", at: later };
const close: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(close.splice(0).map(fn => fn())); });
async function world() {
  const kernel = openMemorySqliteKernel<CommerceDatabase>({ open: (path, options) => new Database(path, options) });
  close.push(() => kernel.close());
  await kernel.run(db => sql`CREATE TABLE commerce_orders (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
    member_id TEXT NOT NULL, status TEXT NOT NULL, currency TEXT NOT NULL, total_amount_cents INTEGER NOT NULL,
    provider TEXT NOT NULL, provider_customer_ref TEXT, provider_payment_ref TEXT, provider_event_at TEXT,
    placed_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL)`.execute(db));
  return { kernel, repo: commerceOrderRepoFor({ kernel }) };
}
it("marks a pending order paid once, advancing only its timestamp and version", async () => {
  const { repo } = await world(); await repo.placeOrder({ order, items: [] });
  expect(await repo.markPaid(input, {})).toBe("paid");
  expect(await repo.findById({ workspaceId: "ws", id: "order" })).toEqual({ ...order, status: "paid", updatedAt: later, version: 2 });
  expect(await repo.markPaid({ ...input, at: "2026-11-01T00:00:00.000Z" })).toBe("already_paid");
  expect(await repo.findById({ workspaceId: "ws", id: "order" })).toEqual({ ...order, status: "paid", updatedAt: later, version: 2 });
});
it.each(["failed", "canceled"] as const)("never overwrites a %s order", async status => {
  const { repo } = await world(); await repo.placeOrder({ order: { ...order, status }, items: [] });
  expect(await repo.markPaid(input)).toBe("not_pending");
  expect(await repo.findById({ workspaceId: "ws", id: "order" })).toEqual({ ...order, status });
});
it("returns not_found for missing or foreign orders without changing the owner", async () => {
  const { repo } = await world();
  expect(await repo.markPaid(input)).toBe("not_found"); await repo.placeOrder({ order, items: [] });
  expect(await repo.markPaid({ ...input, workspaceId: "other" })).toBe("not_found");
  expect(await repo.markPaid({ ...input, orderId: "other" })).toBe("not_found");
  expect(await repo.findById({ workspaceId: "ws", id: "order" })).toEqual(order);
});
it("concurrent settlement has exactly one paid result and one version increment", async () => {
  const { repo } = await world(); await repo.placeOrder({ order, items: [] });
  expect((await Promise.all([repo.markPaid(input), repo.markPaid(input)])).sort()).toEqual(["already_paid", "paid"]);
  expect(await repo.findById({ workspaceId: "ws", id: "order" })).toEqual({ ...order, status: "paid", updatedAt: later, version: 2 });
});
it("propagates storage failures", async () => {
  const { kernel, repo } = await world();
  await kernel.run(db => sql`DROP TABLE commerce_orders`.execute(db));
  await expect(repo.markPaid(input)).rejects.toThrow();
});
