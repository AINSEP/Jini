import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import { toWhereUsedResponse } from "../support/compat/where-used.js";
import type { EntryRefRow } from "../../ports.js";

/**
 * @file `toWhereUsedResponse` (REQ-34) — maps `entry_refs`' 4-way `sourceKind` union onto widgets'
 * own 2-way disclosure vocabulary (`region` | `embed`). The one real decision this shaper makes is
 * that ternary: `"widget-embed"` -> `"embed"`, everything else -> `"region"`. Both branches and the
 * empty-input shape are asserted directly since the mapping itself, not just "does it run", is the
 * behavior REQ-34 depends on.
 */

function makeRef(overrides: Partial<EntryRefRow>): EntryRefRow {
  return {
    workspaceId: "ws-1",
    sourceEntryId: "entry-1",
    sourceKind: "widget-area-placement",
    fieldPath: "doc.placements[0]",
    targetKind: "entry",
    targetId: "widget-1",
    ...overrides,
  };
}

test("toWhereUsedResponse: an empty refs array resolves count 0 and an empty references list", () => {
  const result = toWhereUsedResponse([]);
  assert.deepEqual(result, { count: 0, references: [] });
});

test("toWhereUsedResponse: a widget-embed source maps to kind 'embed'", () => {
  const ref = makeRef({ sourceKind: "widget-embed", sourceEntryId: "post-1", fieldPath: "bodyJson.content[3]" });
  const result = toWhereUsedResponse([ref]);
  assert.deepEqual(result, {
    count: 1,
    references: [{ kind: "embed", sourceEntryId: "post-1", fieldPath: "bodyJson.content[3]" }],
  });
});

test("toWhereUsedResponse: every non-widget-embed sourceKind maps to kind 'region' (widget-area-placement, config-field, page-html-embed)", () => {
  const refs: EntryRefRow[] = [
    makeRef({ sourceKind: "widget-area-placement" }),
    makeRef({ sourceKind: "config-field" }),
    makeRef({ sourceKind: "page-html-embed" }),
  ];
  const result = toWhereUsedResponse(refs);
  assert.equal(result.count, 3);
  assert.deepEqual(
    result.references.map((r) => r.kind),
    ["region", "region", "region"]
  );
});

test("toWhereUsedResponse: count always equals refs.length, including a mixed multi-row input, and preserves input order", () => {
  const refs: EntryRefRow[] = [
    makeRef({ sourceKind: "widget-embed", sourceEntryId: "a" }),
    makeRef({ sourceKind: "widget-area-placement", sourceEntryId: "b" }),
    makeRef({ sourceKind: "widget-embed", sourceEntryId: "c" }),
  ];
  const result = toWhereUsedResponse(refs);
  assert.equal(result.count, 3);
  assert.deepEqual(
    result.references.map((r) => [r.kind, r.sourceEntryId]),
    [
      ["embed", "a"],
      ["region", "b"],
      ["embed", "c"],
    ]
  );
});
