import Database from "better-sqlite3";
import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { sql } from "kysely";
import { afterEach, expect, it } from "vitest";
import type { CommerceDatabase } from "../../database.js";
import type { CommercePriceProviderRefRecord } from "../../ports.js";
import { commercePriceProviderRefRepoFor } from "../../repo.js";

const record: CommercePriceProviderRefRecord = { workspaceId: "ws", priceId: "price", providerId: "regional-pay",
  providerAccountId: "account", mode: "test", providerPriceRef: "remote-price", createdAt: "2026-10-29T00:00:00Z" };
const close: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(close.splice(0).map(fn => fn())); });
async function world(optional?: Record<string, never>) {
  const kernel = openMemorySqliteKernel<CommerceDatabase>({ open: (path, options) => new Database(path, options) });
  close.push(() => kernel.close());
  await kernel.run(db => sql`CREATE TABLE commerce_price_provider_refs (
    workspace_id TEXT NOT NULL, price_id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_account_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('test','live')), provider_price_ref TEXT NOT NULL CHECK (length(provider_price_ref) > 0),
    created_at TEXT NOT NULL, PRIMARY KEY (workspace_id, price_id, provider_id, provider_account_id, mode))`.execute(db));
  return commercePriceProviderRefRepoFor({ kernel }, optional);
}

it("reads a hit and upserts one five-part key without adding a second row", async () => {
  const repo = await world({});
  expect(await repo.find(record)).toBeNull();
  await repo.save(record);
  expect(await repo.find(record, {})).toBe("remote-price");
  await repo.save({ ...record, providerPriceRef: "replacement" }, {});
  expect(await repo.find(record)).toBe("replacement");
});
it.each(["workspaceId", "priceId", "providerId", "providerAccountId", "mode"] as const)("isolates %s on reads and upserts", async key => {
  const repo = await world();
  await repo.save(record);
  const other = { ...record, [key]: key === "mode" ? "live" : "other" } as CommercePriceProviderRefRecord;
  expect(await repo.find(other)).toBeNull();
  await repo.save({ ...other, providerPriceRef: "other-price" });
  expect(await repo.find(other)).toBe("other-price");
  expect(await repo.find(record)).toBe("remote-price");
});
it.each([{ providerPriceRef: "" }, { mode: "invalid" }])("propagates schema refusals without changing the saved mapping", async invalid => {
  const repo = await world(); await repo.save(record);
  await expect(repo.save({ ...record, ...invalid } as CommercePriceProviderRefRecord)).rejects.toThrow();
  expect(await repo.find(record)).toBe("remote-price");
});
