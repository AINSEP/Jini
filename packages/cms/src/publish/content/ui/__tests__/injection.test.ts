/**
 * @file K5 — every host dependency of the publish-content-ui module is injected, so each test here
 * hands the neutral code a policy that is NOT Tovu's and asserts its output follows that policy.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { applyPublishCriteria, decodePublishCriteriaFromQuery, parsePublishContentToolInput } from "../criteria.js";
import { friendlyPublishReason, toPublishReportRowCores, toPublishReportRows } from "../report-rows.js";
import { publishEntityTypeLabel, publishEntityTypePluralLabel, publishSectionById, publishSectionForEntityTypes } from "../sections.js";
import type { PublishContentOutcomeRow, PublishContentReport } from "../contract.js";
import { TEST_POLICY, TEST_SECTIONS } from "./test-policy.js";

function row(over: Partial<PublishContentOutcomeRow> & Pick<PublishContentOutcomeRow, "entityType" | "entityId" | "outcome">): PublishContentOutcomeRow {
  return { entityLabel: null, writes: over.outcome === "created" || over.outcome === "applied" || over.outcome === "forced", reason: null, ...over } as PublishContentOutcomeRow;
}
const report = (...rows: PublishContentOutcomeRow[]): PublishContentReport => ({ refused: false, rows }) as unknown as PublishContentReport;

test("rows take type names, outcome copy, id length and the used-by note from the injected policy", () => {
  const rows = toPublishReportRows({
    report: report(
      row({ entityType: "widget", entityId: "abcdef123456", outcome: "created" }),
      row({ entityType: "mystery", entityId: "m1", outcome: "conflict", reason: null }),
      row({ entityType: "gear", entityId: "g1", outcome: "applied", includedFor: ["widget:w1", "gear:g2"] }),
      row({ entityType: "gear", entityId: "g2", outcome: "applied", trashes: true }),
    ),
    policy: TEST_POLICY,
  });
  assert.deepEqual(rows.map((r) => r.entityTypeLabel), ["Widget", "mystery", "Gear", "Gear"]);
  assert.equal(rows[0]?.entityLabel, "abcd");
  assert.equal(rows[0]?.dispositionLabel, "plan-new");
  assert.equal(rows[1]?.reason, "no reason on file");
  assert.equal(rows[2]?.usedByNote, "used by gear+widget");
  assert.equal(rows[2]?.selectable, false);
  assert.equal(rows[3]?.dispositionLabel, "plan-trash");
});

test("completed rows read the completed copy and are never selectable", () => {
  const rows = toPublishReportRows({ report: report(row({ entityType: "gear", entityId: "g", outcome: "forced" }), row({ entityType: "gear", entityId: "t", outcome: "applied", trashes: true })), policy: TEST_POLICY }, { completed: true });
  assert.deepEqual(rows.map((r) => [r.dispositionLabel, r.selectable]), [["done-overwrite", false], ["done-trash", false]]);
});

test("the policy-free cores carry no wording and a refused report has no rows", () => {
  const cores = toPublishReportRowCores({ report: report(row({ entityType: "widget", entityId: "w", outcome: "created" })) });
  assert.deepEqual(Object.keys(cores[0] ?? {}).sort(), ["appliesOnExecute", "disposition", "entityId", "entityType", "includedFor", "key", "outcome", "overwritable", "selectable", "trashes"]);
  assert.deepEqual(toPublishReportRowCores({ report: { refused: true, rows: [] } as unknown as PublishContentReport }), []);
});

test("reason rewriting follows the injected tables: final prefix, rewrite, named file, generic wrap, pass-through", () => {
  const f = (reason: string) => friendlyPublishReason({ reason, policy: TEST_POLICY.reasons });
  assert.equal(f("FINAL: keep me"), "FINAL: keep me");
  assert.equal(f("raw clash 'x'"), "friendly clash");
  assert.equal(f('big file "a/b/c.png"'), "FINAL: too big (c.png)");
  assert.equal(f("Theme failed: detail"), "Theme is not allowed");
  assert.equal(f("something unseen"), "something unseen");
});

test("section lookups read the injected table", () => {
  assert.equal(publishSectionById({ id: "gears", sections: TEST_SECTIONS })?.labelKey, "Ship gears");
  assert.equal(publishSectionById({ id: "pages", sections: TEST_SECTIONS }), undefined);
  assert.equal(publishSectionForEntityTypes({ entityTypes: ["gadget", "widget"], sections: TEST_SECTIONS })?.section, "widgets");
  assert.equal(publishEntityTypeLabel({ entityType: "gadget", sections: TEST_SECTIONS }), "Gadget");
  assert.equal(publishEntityTypePluralLabel({ entityType: "gear", sections: TEST_SECTIONS }), "Gears");
  assert.equal(publishEntityTypeLabel({ entityType: "page", sections: TEST_SECTIONS }), "page");
});

test("criteria aliases, query limits and the capability id are injected", () => {
  const rows = toPublishReportRows({ report: report(row({ entityType: "widget", entityId: "w1", outcome: "created" }), row({ entityType: "gear", entityId: "g1", outcome: "created" })), policy: TEST_POLICY });
  const selection = applyPublishCriteria({ rows, criteria: { types: ["Gizmos", "gizmo"] }, typeAliases: { gizmos: "widget" } });
  assert.deepEqual([...selection.deselectedKeys], ["gear:g1"]);
  assert.deepEqual(selection.unknownTypes, ["gizmo"]);

  const limits = { maxQueryLength: 30, maxListLength: 2, maxEntryLength: 3 };
  assert.equal(decodePublishCriteriaFromQuery({ raw: "x".repeat(31), limits }), null);
  assert.deepEqual(decodePublishCriteriaFromQuery({ raw: encodeURIComponent(JSON.stringify({ types: ["a", "bcdef", "b", "c"] })), limits: { ...limits, maxQueryLength: 200 } }), { types: ["a", "b"] });

  assert.throws(() => parsePublishContentToolInput({ input: { types: "a" }, capabilityId: "host.cap" }), /^Error: host\.cap: 'types' must be an array of strings$/);
  assert.throws(() => parsePublishContentToolInput({ input: { overwrite: 1 }, capabilityId: "host.cap" }), /host\.cap: 'overwrite' must be a boolean/);
});
