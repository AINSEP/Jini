import assert from "node:assert/strict";
import test from "node:test";

import { toPriceRecord, toPriceRow } from "../../repo.rows.js";

const record = {
  id: "zero-price", workspaceId: "shop-west", productId: "intro-product", unitAmount: { minorUnits: 0, currency: "KES" },
  compareAtAmount: { minorUnits: 0, currency: "KES" }, billingInterval: "year" as const, status: "archived" as const,
  createdAt: "2026-10-04T01:02:03.000Z", version: 8,
};
const row = {
  id: "zero-price", workspace_id: "shop-west", product_id: "intro-product", unit_amount_cents: 0,
  compare_at_amount_cents: 0, currency: "KES", billing_interval: "year", status: "archived",
  created_at: "2026-10-04T01:02:03.000Z", version: 8,
};

test("a zero compare-at price is preserved in both directions rather than treated as absent", () => {
  // F4.1/F4.3: independently written fixtures reject changing either ?? guard to ||.
  assert.deepEqual(toPriceRow(record), row);
  assert.deepEqual(toPriceRecord(row), record);
});

test("an absent compare-at price and billing interval use SQL null and decode as undefined", () => {
  assert.deepEqual(toPriceRow({ ...record, compareAtAmount: undefined, billingInterval: undefined }), {
    ...row, compare_at_amount_cents: null, billing_interval: null,
  });
  assert.deepEqual(toPriceRecord({ ...row, compare_at_amount_cents: null, billing_interval: null }), {
    ...record, compareAtAmount: undefined, billingInterval: undefined,
  });
});
