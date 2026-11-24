import assert from "node:assert/strict";
import { test } from "vitest";

import { toChangeSetItemResponse } from "../change-sets.js";

// F4.1/F4.3/F6.2: independent literals distinguish absent values from populated ones.
// Author Checklist: each test calls the real pure projection, has fresh state and unconditional
// assertions; persistence, timing, fakes and retries do not apply. Name mutations below instead
// of editing source, which this batch expressly prohibits.
test("change-set items preserve a zero entity version and hide inverse content while signaling revertibility", () => {
  // Mutations rejected: replace `?? null` with `|| null`, or spread the item into the response.
  const item = {
    id: "item-5", changeSetId: "reverted-4", entityType: "widget", entityId: "banner-9",
    operation: "update" as const, inversePayload: { privateMarkup: "<p>Original</p>" },
    entityVersionAtApply: 0, position: 7,
  };
  assert.deepEqual(toChangeSetItemResponse({ item }), {
    id: "item-5", entityType: "widget", entityId: "banner-9", operation: "update",
    revertible: true, entityVersionAtApply: 0, position: 7,
  });
  assert.deepEqual(toChangeSetItemResponse({ item: { ...item, inversePayload: undefined, entityVersionAtApply: undefined } }), {
    id: "item-5", entityType: "widget", entityId: "banner-9", operation: "update",
    revertible: false, entityVersionAtApply: null, position: 7,
  });
});
