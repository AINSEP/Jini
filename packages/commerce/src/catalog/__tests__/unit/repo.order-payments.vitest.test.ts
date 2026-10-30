import Database from "better-sqlite3";
import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { sql } from "kysely";
import { afterEach, expect, it } from "vitest";
import type { CommerceDatabase } from "../../database.js";
import type { CommerceOrderPaymentRecord } from "../../ports.js";
import { commerceOrderPaymentRepoFor } from "../../repo.js";

const record: Omit<CommerceOrderPaymentRecord, "paymentId"> = { workspaceId: "ws", orderId: "order", siteId: "site",
  providerId: "regional-pay", providerAccountId: "account", mode: "test", amount: { minorUnits: 123, currency: "USD" }, createdAt: "2026-10-29T00:00:00Z" };
const close: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(close.splice(0).map(fn => fn())); });
async function world(optional?: Record<string, never>) {
  const kernel = openMemorySqliteKernel<CommerceDatabase>({ open: (path, options) => new Database(path, options) });
  close.push(() => kernel.close());
  await kernel.run(db => sql`CREATE TABLE commerce_order_payments (
    workspace_id TEXT NOT NULL, order_id TEXT NOT NULL, site_id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_account_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('test','live')), amount_minor BIGINT NOT NULL, currency TEXT NOT NULL, payment_id TEXT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY (workspace_id, order_id), UNIQUE (workspace_id, mode, payment_id))`.execute(db));
  return commerceOrderPaymentRepoFor({ kernel }, optional);
}
it("reserves once, preserves the snapshot and scopes reads by workspace and order", async () => {
  const repo = await world({}); expect(await repo.findByOrder(record)).toBeNull();
  expect(await repo.reserve(record)).toBe("reserved");
  expect(await repo.reserve({ ...record, createdAt: "later" }, {})).toBe("same_scope");
  expect(await repo.findByOrder(record, {})).toEqual({ ...record, paymentId: null });
  expect(await repo.findByOrder({ ...record, workspaceId: "other" })).toBeNull();
  expect(await repo.findByOrder({ ...record, orderId: "other" })).toBeNull();
  expect(await repo.reserve({ ...record, workspaceId: "other" })).toBe("reserved");
  expect(await repo.reserve({ ...record, orderId: "other" })).toBe("reserved");
});
it.each([{ siteId: "other" }, { providerId: "other" }, { providerAccountId: "other" }, { mode: "live" as const },
  { amount: { minorUnits: 124, currency: "USD" } }, { amount: { minorUnits: 123, currency: "EUR" } }])("refuses a different reservation scope or amount", async change => {
  const repo = await world(); await repo.reserve(record);
  expect(await repo.reserve({ ...record, ...change })).toBe("conflict");
  expect(await repo.findByOrder(record)).toEqual({ ...record, paymentId: null });
});
it("concurrent different scopes have exactly one reservation winner", async () => {
  const repo = await world(), other = { ...record, mode: "live" as const };
  const results = await Promise.all([repo.reserve(record), repo.reserve(other)]);
  expect([...results].sort()).toEqual(["conflict", "reserved"]);
  expect(await repo.findByOrder(record)).toEqual({ ...[record, other][results.indexOf("reserved")], paymentId: null });
});
it("binds once, classifies every replay and never changes another order or workspace", async () => {
  const repo = await world(), input = { workspaceId: "ws", orderId: "order", paymentId: "payment" };
  expect(await repo.bind(input)).toBe("not_found"); await repo.reserve(record);
  expect(await repo.bind({ ...input, workspaceId: "other" })).toBe("not_found");
  expect(await repo.bind({ ...input, orderId: "other" })).toBe("not_found");
  expect(await repo.bind(input, {})).toBe("bound");
  expect(await repo.bind(input)).toBe("already_bound");
  expect(await repo.bind({ ...input, paymentId: "second" })).toBe("conflict");
  expect(await repo.findByOrder(record)).toEqual({ ...record, paymentId: "payment" });
  expect(await repo.reserve(record)).toBe("same_scope");
});
it("concurrent different bindings have one winner and keep the winning payment", async () => {
  const repo = await world(); await repo.reserve(record);
  const results = await Promise.all(["first", "second"].map(paymentId => repo.bind({ ...record, paymentId })));
  expect([...results].sort()).toEqual(["bound", "conflict"]);
  expect(await repo.findByOrder(record)).toEqual({ ...record, paymentId: ["first", "second"][results.indexOf("bound")] });
});
it("propagates a duplicate payment binding and preserves both reservations", async () => {
  const repo = await world(), other = { ...record, orderId: "other" };
  await repo.reserve(record); await repo.reserve(other); await repo.bind({ ...record, paymentId: "payment" });
  await expect(repo.bind({ ...other, paymentId: "payment" })).rejects.toThrow();
  expect(await repo.findByOrder(record)).toEqual({ ...record, paymentId: "payment" });
  expect(await repo.findByOrder(other)).toEqual({ ...other, paymentId: null });
});
