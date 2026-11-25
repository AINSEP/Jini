import { describe, expect, it } from "vitest";
import type { CriteriaSelection } from "../../../../publish/content/ui/criteria.js";
import type { PublishReportRow } from "../../../../publish/content/ui/report-rows.js";
import { buildCriteriaPublishResult } from "../criteria-publish-result.js";

const forced: PublishReportRow = {
  key: "page:forced", entityType: "page", entityTypeLabel: "Page", entityId: "forced", entityLabel: "Forced page",
  selectable: true, outcome: "forced", disposition: "publish", dispositionLabel: "Publish", reason: null,
  appliesOnExecute: true, overwritable: false, retiresLabel: null, referencedByLabels: [], includedFor: [],
  usedByNote: null, trashes: false,
};

describe("criteria publish result", () => {
  it("reports forced rows in both arrays, carries selected-parent media and preserves the criteria result", () => {
    const rows: PublishReportRow[] = [
      forced,
      { ...forced, key: "media:carried", entityType: "media", entityTypeLabel: "Media", entityId: "carried", entityLabel: "Carried media", selectable: false, outcome: "created", includedFor: [forced.key] },
      { ...forced, key: "page:deselected", entityId: "deselected", entityLabel: "Deselected page", outcome: "created" },
      { ...forced, key: "page:unchanged", entityId: "unchanged", entityLabel: "Unchanged page", selectable: false, outcome: "unchanged", disposition: "unchanged", dispositionLabel: "Unchanged", appliesOnExecute: false },
      { ...forced, key: "page:skipped", entityId: "skipped", entityLabel: "Skipped page", selectable: false, outcome: "conflict", disposition: "skipped", dispositionLabel: "Skipped", appliesOnExecute: false, reason: "Keep the live edit" },
    ];
    const selection: CriteriaSelection = {
      deselectedKeys: new Set(["page:deselected"]), overwriteKeys: new Set([forced.key]),
      unmatchedItems: ["Missing title"], unknownTypes: ["fixture-type"],
    };
    const result = buildCriteriaPublishResult({ rows, selection, siteLabel: "Fixture live site", nextStep: "Fixture next step" });
    expect(result).toEqual({
      opened: true, planned: true, site: "Fixture live site",
      willPublish: ["Forced page", "Carried media"], willOverwrite: ["Forced page"],
      leftAlone: [{ label: "Skipped page", reason: "Keep the live edit" }],
      unmatchedItems: ["Missing title"], unknownTypes: ["fixture-type"], nextStep: "Fixture next step",
    });
    expect(result.unmatchedItems).toBe(selection.unmatchedItems);
    expect(result.unknownTypes).toBe(selection.unknownTypes);
  });

  it("rejects a skipped row without a reason", () => {
    const row: PublishReportRow = { ...forced, selectable: false, disposition: "skipped", outcome: "conflict", appliesOnExecute: false, reason: null };
    const selection: CriteriaSelection = { deselectedKeys: new Set(), overwriteKeys: new Set(), unmatchedItems: [], unknownTypes: [] };
    expect(() => buildCriteriaPublishResult({ rows: [row], selection, siteLabel: null, nextStep: "Fixture next step" }))
      .toThrow("skipped publish item Forced page has no reason");
  });
});
