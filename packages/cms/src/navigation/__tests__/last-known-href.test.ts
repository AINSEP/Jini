import assert from "node:assert/strict";
import { test } from "vitest";
import { validateAndCloneTree, MenuValidationError } from "../menu-service.js";
import type { NavItemNode } from "../types.js";

test("entry references preserve a last-known URL and reject unsafe or malformed fallback URLs", () => {
  const target = { kind: "entryRef" as const, entryId: "page-1", entryType: "page", lastKnownHref: "/about" };
  assert.deepEqual(validateAndCloneTree({ items: [{ id: "about", target }] })[0]?.target, target);
  for (const lastKnownHref of ["javascript:alert(1)", "//evil.example", "/\\evil.example", "", 42, null]) {
    assert.throws(() => validateAndCloneTree({ items: [{ id: "about", target: { ...target, lastKnownHref } }] as unknown as NavItemNode[] }), MenuValidationError);
  }
});
