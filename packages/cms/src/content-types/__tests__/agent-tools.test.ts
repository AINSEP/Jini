import assert from "node:assert/strict";
import { test } from "vitest";

import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";

import { contentTypesAgentToolCatalog } from "../agent-tools.js";
import { buildContentTypesRegistrations, type ContentTypesToolDeps } from "../tool-registrations.js";
import { InMemoryContentTypeRepo, NoopContentTypeIndexProvisioner } from "../repo.memory.js";

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

// ---------------------------------------------------------------------------
// collections_content_type_define on an existing key — the model must see the actionable
// hint, not a redacted INTERNAL_ERROR (web-high fix plan follow-up, 2026-09-24)
// ---------------------------------------------------------------------------

function executionContext(input: Record<string, unknown>): ToolExecutionContext {
  return { executionId: "exec-1", principal: { id: "principal-1" }, run: { id: "run-1" }, input, signal: new AbortController().signal };
}

function fakeContentTypesDeps(): ContentTypesToolDeps {
  return {
    authorize: async () => ({ allowed: true, reason: "matched" }),
    workspaceId: "ws-1",
    clock: { nowIso: () => "2026-09-24T00:00:00.000Z" },
    idGen: { newId: () => "id-1" },
    outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
    contentTypeRepo: new InMemoryContentTypeRepo(),
    contentTypeIndexProvisioner: new NoopContentTypeIndexProvisioner(),
  };
}

test("collections_content_type_define on an existing key throws a ToolInputError carrying the exact already-exists message", async () => {
  const deps = fakeContentTypesDeps();
  const registrations = buildContentTypesRegistrations(deps);
  const define = registrations.find((r) => r.descriptor.id === "collections_content_type_define");
  assert.ok(define, "collections_content_type_define must be wired");

  await define.handler(
    executionContext({ key: "product", label: "Product", fields: [] })
  );

  await assert.rejects(
    () => define.handler(executionContext({ key: "product", label: "Product v2", fields: [] })),
    (err: unknown) => {
      assert.ok(err instanceof ToolInputError, `expected a ToolInputError, got ${err instanceof Error ? err.constructor.name : typeof err}`);
      assert.equal(
        (err as Error).message,
        "content type 'product' already exists; use collections_content_type_update_fields to change its fields"
      );
      return true;
    }
  );
});
