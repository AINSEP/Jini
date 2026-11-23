import assert from "node:assert/strict";
import { test } from "vitest";
import { LIPAY_MANIFEST } from "../manifest.js";
const LIPAY_PLUGIN_ID = LIPAY_MANIFEST.pluginId;

test("lipay: plugin id and every table short name satisfy BOTH ADR-023's and ADR-026's grammars", () => {
  // ADR-023 `data-module.ts` IDENT allows underscores; ADR-026 forbids them and allows hyphens.
  // The only names that satisfy both are single lowercase alphanumeric segments.
  const bothGrammars = /^[a-z][a-z0-9]*$/;
  assert.match(LIPAY_PLUGIN_ID, bothGrammars);
  for (const table of LIPAY_MANIFEST.tables) {
    assert.match(table.name, bothGrammars, `table '${table.name}' would violate one of the two grammars`);
    for (const index of table.indexes ?? []) {
      assert.match(index.name, bothGrammars, `index '${index.name}' would violate one of the two grammars`);
    }
  }
  assert.equal(LIPAY_MANIFEST.pluginTier, "tier-2");
});

test("lipay: the manifest models no orders, no providers and no card data", () => {
  const tableNames = LIPAY_MANIFEST.tables.map((t) => t.name);
  assert.deepEqual(tableNames, ["payments", "events", "refunds"]);

  const columns = LIPAY_MANIFEST.tables.flatMap((t) => t.columns.map((c) => c.name));
  for (const forbidden of ["order_id", "card_number", "pan", "token", "secret"]) {
    assert.ok(!columns.includes(forbidden), `'${forbidden}' must not be a lipay column`);
  }
  // Money is minor units plus an explicit currency — never a bare "cents" integer.
  const payments = LIPAY_MANIFEST.tables[0]!;
  assert.ok(payments.columns.some((c) => c.name === "amount_minor" && c.type === "INTEGER"));
  assert.ok(payments.columns.some((c) => c.name === "currency" && c.notNull === true));
});
