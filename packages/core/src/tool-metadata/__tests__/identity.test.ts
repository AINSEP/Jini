import assert from "node:assert/strict";
import { test } from "vitest";

import { toolMetadata } from "../identity.js";

/**
 * @file Characterization pin for the identity registration declarations. Changing one's own (or an
 * admin's) username is reversible from the same screen, so the reviewed declaration runs it
 * directly; a drift to `"plan"` or any asking confirmation would add a needless approval card.
 */

test("identity_user_change_username: declared as a direct edit", () => {
  assert.ok("identity_user_change_username" in toolMetadata);
  const approval = toolMetadata.identity_user_change_username.approval;
  assert.equal(approval.class, "edit");
  assert.equal(approval.confirmation, "direct");
});
