import assert from "node:assert/strict";
import { test } from "vitest";
import { siteSchemaName as schemaName } from "../../transfer/index.js";
const naming = { defaultSchema: "tovu", markerTable: "_tovu_transfer", unvalidatedTable: "pg_temp._tovu_unvalidated", schemaPrefix: "tovu_" };
const siteSchemaName = (site: string) => schemaName({ site, naming });
// Original naming assertions moved intact; these do not need a Postgres connection.
test("siteSchemaName: the readable per-site schema for every site after the first, a safe identifier of at most 63 bytes", () => {
  assert.equal(siteSchemaName("tovu-dev"), "tovu_tovu_dev");
  assert.equal(siteSchemaName("My Site"), "tovu_my_site");
  assert.equal(siteSchemaName("other-site"), "tovu_other_site");
  const long = "a-very-long-site-name-".repeat(5);
  assert.equal(siteSchemaName(long), siteSchemaName(long), "stable");
  assert.match(siteSchemaName(long), /^tovu_a_very_long_site_name_a_very_long_site_name_a_ver_[0-9a-f]{8}$/);
  assert.ok(Buffer.byteLength(siteSchemaName(long)) <= 63);
  assert.notEqual(siteSchemaName(long), siteSchemaName(`${long}x`), "a truncated name keeps a hash of the whole name");
  assert.match(siteSchemaName("---"), /^tovu_[0-9a-f]{8}$/);
  assert.match(siteSchemaName("café"), /^tovu_caf_[0-9a-f]{8}$/, "a name that loses characters keeps a hash, so 'café' and 'caf' differ");
  assert.match(siteSchemaName("My Site!"), /^tovu_my_site_[0-9a-f]{8}$/);
  assert.notEqual(siteSchemaName("public"), "public");
});
