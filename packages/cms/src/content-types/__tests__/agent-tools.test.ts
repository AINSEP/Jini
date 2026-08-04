import assert from "node:assert/strict";
import { test } from "vitest";

import { contentTypesAgentToolCatalog } from "../agent-tools.js";

/**
 * @file REQ-22 — Collections' content-types agent-tool catalog contract (C-406).
 *
 * Covers: AC-35 (collections_plan_cleanup + collections_execute_cleanup present and
 * agent-callable; no collections_confirm_cleanup tool or any confirm()-performing tool exists).
 */

test("AC-35: collections_plan_cleanup and collections_execute_cleanup are present and agent-callable", () => {
  const names = contentTypesAgentToolCatalog.map((t) => t.name);

  assert.ok(names.includes("collections_plan_cleanup"));
  assert.ok(names.includes("collections_execute_cleanup"));
});

test("AC-35/INV-06-equivalent: no tool named collections_confirm_cleanup exists, and no tool's description implies performing the confirm() step", () => {
  const names = contentTypesAgentToolCatalog.map((t) => t.name);

  assert.equal(names.includes("collections_confirm_cleanup"), false);
  assert.equal(
    contentTypesAgentToolCatalog.some((t) => /confirm/i.test(t.description) && /cleanup/i.test(t.description)),
    false,
    "no tool may claim to perform cleanup confirmation — confirm() is human-UI-only"
  );
});

test("collections_plan_cleanup requires only admin.collections.read and has sideEffects:'none' (REQ-09)", () => {
  const tool = contentTypesAgentToolCatalog.find((t) => t.name === "collections_plan_cleanup");
  assert.ok(tool);
  assert.equal(tool?.authorization.permission, "admin.collections.read");
  assert.equal(tool?.sideEffects, "none");
});

test("collections_execute_cleanup requires admin.collections.manage and carries the confirmer-must-equal-own-delegatedBy actor-class rule (REQ-13)", () => {
  const tool = contentTypesAgentToolCatalog.find((t) => t.name === "collections_execute_cleanup");
  assert.ok(tool);
  assert.equal(tool?.authorization.permission, "admin.collections.manage");
  assert.equal(tool?.sideEffects, "mutates-durable-state");
  assert.equal(tool?.actorClassRule, "confirmer-must-equal-own-delegatedBy");
});

test("the registry-CRUD/lifecycle tools (define/update-fields/deprecate/reactivate/tombstone) all require admin.collections.manage", () => {
  const mutatingTools = [
    "collections_content_type_define",
    "collections_content_type_update_fields",
    "collections_content_type_deprecate",
    "collections_content_type_reactivate",
    "collections_content_type_tombstone",
  ];

  for (const name of mutatingTools) {
    const tool = contentTypesAgentToolCatalog.find((t) => t.name === name);
    assert.ok(tool, `expected tool '${name}' to be registered`);
    assert.equal(tool?.authorization.permission, "admin.collections.manage");
  }
});
