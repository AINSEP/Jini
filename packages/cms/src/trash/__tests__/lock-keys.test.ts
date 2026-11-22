import assert from "node:assert/strict";
import { test } from "vitest";
import { trashEntityLockKey } from "../lock-keys.js";

test("the lock key is trash:<entityType>:<workspaceId>:<entityId>", () => {
  assert.equal(trashEntityLockKey({ entityType: "member", workspaceId: "w", entityId: "m" }), "trash:member:w:m");
  assert.equal(trashEntityLockKey({ entityType: "form_submission", workspaceId: "ws-1", entityId: "s:1" }), "trash:form_submission:ws-1:s:1");
});

test("each field changes the key, so two entities never share a lock", () => {
  const base = { entityType: "a", workspaceId: "b", entityId: "c" };
  const keys = new Set([base, { ...base, entityType: "x" }, { ...base, workspaceId: "x" }, { ...base, entityId: "x" }].map((input) => trashEntityLockKey(input)));
  assert.equal(keys.size, 4);
});
