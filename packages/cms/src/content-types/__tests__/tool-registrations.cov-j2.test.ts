import assert from "node:assert/strict";
import { test } from "vitest";

import { AGENT_TOOL_PRINCIPAL_KIND, ToolInputError, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";

import { ContentTypeLifecycleError, ForbiddenError, ReservedContentTypeKeyError, VersionConflictError } from "../errors.js";
import { InMemoryContentTypeRepo } from "../repo.memory.js";
import { buildContentTypesRegistrations, contentTypesDerivedRisk, type ContentTypesToolDeps } from "../tool-registrations.js";
import type { ContentTypeFieldDef } from "../types.js";

/**
 * @file The content-types agent tools driven end to end through their registrations: what each
 * handler hands the model (the workspace-free view), what it writes (row, revision provenance,
 * index calls, outbox events), and how it refuses (input shape, permission, lifecycle, version).
 */

const WORKSPACE_ID = "ws-ct-tools";
const NOW = "2026-10-21T00:00:00.000Z";
const TITLE_FIELD: ContentTypeFieldDef = { name: "title", kind: "text", required: true, queryable: true };

function ctx(input: unknown, principalId = "agent-principal"): ToolExecutionContext {
  return { executionId: "exec-1", principal: { id: principalId }, run: { id: "run-1" }, input, signal: new AbortController().signal } as ToolExecutionContext;
}

function harness(overrides: Partial<ContentTypesToolDeps> = {}) {
  const repo = new InMemoryContentTypeRepo();
  const events: Array<{ id: string; name: string; workspaceId: string; occurredAt: string; payload: Record<string, unknown> }> = [];
  const indexCalls: Array<[string, unknown]> = [];
  const permissionRequests: unknown[] = [];
  let ids = 0;
  const deps: ContentTypesToolDeps = {
    authorize: async (request) => { permissionRequests.push(request); return { allowed: true, reason: "matched" }; },
    workspaceId: WORKSPACE_ID,
    clock: { nowMs: () => Date.parse(NOW) },
    idGen: { newId: () => `id-${++ids}` },
    outbox: { enqueue: async (event) => { events.push(event); }, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
    contentTypeRepo: repo,
    contentTypeIndexProvisioner: {
      provisionIndexesForNewContentType: async (call) => { indexCalls.push(["provision", call]); },
      applyFieldIndexTransitions: async (call) => { indexCalls.push(["transition", call]); },
      tearDownAllIndexesForContentType: async (call) => { indexCalls.push(["teardown", call]); },
    },
    ...overrides,
  };
  const registrations = buildContentTypesRegistrations(deps);
  const tool = (id: string): ToolRegistration => {
    const found = registrations.find((registration) => registration.descriptor.id === id);
    assert.ok(found, `${id} must be wired`);
    return found;
  };
  return { deps, repo, events, indexCalls, permissionRequests, registrations, tool };
}

async function defineRecipe(h: ReturnType<typeof harness>) {
  return h.tool("collections_content_type_define").handler(ctx({ key: "recipe", label: "Recipe", fields: [TITLE_FIELD] }));
}

test("exactly the six classified tools are wired; the two cleanup tools are withheld", () => {
  const h = harness();
  assert.deepEqual(h.registrations.map((r) => r.descriptor.id).sort(), [...contentTypesDerivedRisk.keys()].sort());
  assert.equal(h.registrations.some((r) => r.descriptor.id.includes("cleanup")), false);
});

test("collections_content_type_define returns the workspace-free view and records agent provenance", async () => {
  const h = harness();

  const result = await defineRecipe(h);

  assert.deepEqual(result, { contentType: { key: "recipe", label: "Recipe", status: "active", version: 1, fields: [TITLE_FIELD] } });
  const stored = await h.repo.findByKey({ workspaceId: WORKSPACE_ID, key: "recipe" });
  assert.equal(stored?.workspaceId, WORKSPACE_ID);
  const [revision] = h.repo.listRevisions();
  assert.equal(revision?.actorId, "agent-principal");
  assert.equal(revision?.principalKind, AGENT_TOOL_PRINCIPAL_KIND);
});

test("collections_content_type_define rejects malformed fields with the tool's published schema appended, writing nothing", async () => {
  const h = harness();

  await assert.rejects(
    () => h.tool("collections_content_type_define").handler(ctx({ key: "recipe", label: "Recipe", fields: [{ name: "title", kind: "text", required: "yes", queryable: true }] })),
    (error: unknown) => {
      assert.ok(error instanceof ToolInputError);
      assert.match(error.message, /Schema for 'collections_content_type_define'/);
      return true;
    },
  );
  assert.equal(await h.repo.findByKey({ workspaceId: WORKSPACE_ID, key: "recipe" }), null);
});

test("collections_content_type_define honors the host's reserved keys when supplied", async () => {
  const h = harness({ reservedContentTypeKeys: new Set(["blog"]) });

  await assert.rejects(
    () => h.tool("collections_content_type_define").handler(ctx({ key: "blog", label: "Blog", fields: [] })),
    (error: unknown) => error instanceof ReservedContentTypeKeyError && /reserved for a host route/.test(error.message),
  );
  assert.equal(await h.repo.findByKey({ workspaceId: WORKSPACE_ID, key: "blog" }), null);
});

test("collections_content_type_update_fields replaces the field schema at the expected version", async () => {
  const h = harness();
  await defineRecipe(h);
  const summary: ContentTypeFieldDef = { name: "summary", kind: "text", required: false, queryable: false };

  const result = await h.tool("collections_content_type_update_fields").handler(ctx({ key: "recipe", fields: [TITLE_FIELD, summary], expectedVersion: 1 }));

  assert.deepEqual(result, { contentType: { key: "recipe", label: "Recipe", status: "active", version: 2, fields: [TITLE_FIELD, summary] } });
  await assert.rejects(
    () => h.tool("collections_content_type_update_fields").handler(ctx({ key: "recipe", fields: [TITLE_FIELD], expectedVersion: 1 })),
    (error: unknown) => error instanceof VersionConflictError,
  );
  await assert.rejects(
    () => h.tool("collections_content_type_update_fields").handler(ctx({ key: "recipe", fields: "title", expectedVersion: 2 })),
    (error: unknown) => error instanceof ToolInputError && /Schema for 'collections_content_type_update_fields'/.test(error.message),
  );
});

test("deprecate -> reactivate -> deprecate -> tombstone runs through the tools; only the tombstoned view carries tombstonedAt", async () => {
  const h = harness();
  await defineRecipe(h);

  const deprecated = await h.tool("collections_content_type_deprecate").handler(ctx({ key: "recipe", expectedVersion: 1 }));
  assert.deepEqual(deprecated, { contentType: { key: "recipe", label: "Recipe", status: "deprecated", version: 2, fields: [TITLE_FIELD] } });

  const reactivated = await h.tool("collections_content_type_reactivate").handler(ctx({ key: "recipe", expectedVersion: 2 }));
  assert.deepEqual(reactivated, { contentType: { key: "recipe", label: "Recipe", status: "active", version: 3, fields: [TITLE_FIELD] } });

  await h.tool("collections_content_type_deprecate").handler(ctx({ key: "recipe", expectedVersion: 3 }));
  const tombstoned = await h.tool("collections_content_type_tombstone").handler(ctx({ key: "recipe", expectedVersion: 4 }));
  assert.deepEqual(tombstoned, { contentType: { key: "recipe", label: "Recipe", status: "tombstone", version: 5, fields: [TITLE_FIELD], tombstonedAt: NOW } });

  // The real `core/ports` outbox receives full domain events: id, workspace, and occurredAt included.
  assert.deepEqual(h.events.map((event) => [event.name, event.workspaceId, event.occurredAt, event.payload]), [
    ["content_type.deprecated", WORKSPACE_ID, NOW, { workspaceId: WORKSPACE_ID, key: "recipe" }],
    ["content_type.deprecated", WORKSPACE_ID, NOW, { workspaceId: WORKSPACE_ID, key: "recipe" }],
    ["content_type.tombstoned", WORKSPACE_ID, NOW, { workspaceId: WORKSPACE_ID, key: "recipe" }],
  ]);
  assert.equal(new Set(h.events.map((event) => event.id)).size, 3);
  assert.ok(h.events.every((event) => typeof event.id === "string"));
  assert.deepEqual(h.indexCalls.filter(([kind]) => kind === "teardown"), [["teardown", { workspaceId: WORKSPACE_ID, contentTypeKey: "recipe" }]]);
  assert.ok(h.repo.listRevisions().every((revision) => revision.principalKind === AGENT_TOOL_PRINCIPAL_KIND));

  await assert.rejects(
    () => h.tool("collections_content_type_reactivate").handler(ctx({ key: "recipe", expectedVersion: 5 })),
    (error: unknown) => error instanceof ContentTypeLifecycleError,
  );
});

test("lifecycle tools reject a missing key or a non-numeric expectedVersion before any write", async () => {
  const h = harness();
  await defineRecipe(h);

  for (const id of ["collections_content_type_deprecate", "collections_content_type_reactivate", "collections_content_type_tombstone"]) {
    await assert.rejects(() => h.tool(id).handler(ctx({ expectedVersion: 1 })), ToolInputError);
    await assert.rejects(() => h.tool(id).handler(ctx({ key: "recipe", expectedVersion: "1" })), ToolInputError);
    await assert.rejects(() => h.tool(id).handler(ctx("recipe")), ToolInputError);
  }
  assert.equal((await h.repo.findByKey({ workspaceId: WORKSPACE_ID, key: "recipe" }))?.version, 1);
  assert.equal(h.events.length, 0);
});

test("collections_content_type_list returns workspace-scoped views after checking admin.collections.read", async () => {
  const h = harness();
  await defineRecipe(h);
  await h.repo.save({ workspaceId: "other-ws", key: "foreign", label: "Foreign", fields: [], status: "active", version: 1 });
  h.permissionRequests.length = 0;

  const listed = await h.tool("collections_content_type_list").handler(ctx(undefined));
  const listedWithEmptyInput = await h.tool("collections_content_type_list").handler(ctx({}));

  const expected = { contentTypes: [{ key: "recipe", label: "Recipe", status: "active", version: 1, fields: [TITLE_FIELD] }] };
  assert.deepEqual(listed, expected);
  assert.deepEqual(listedWithEmptyInput, expected);
  assert.deepEqual(h.permissionRequests[0], { principalId: "agent-principal", permission: "admin.collections.read", workspaceId: WORKSPACE_ID, entityType: "content-type" });
});

test("collections_content_type_list refuses invented filters and a denied principal", async () => {
  const denied = harness({ authorize: async () => ({ allowed: false, reason: "no-grant" }) });
  await assert.rejects(() => denied.tool("collections_content_type_list").handler(ctx({ status: "active" })), ToolInputError);
  await assert.rejects(
    () => denied.tool("collections_content_type_list").handler(ctx(undefined)),
    (error: unknown) => error instanceof Error && /not authorized for 'admin.collections.read' \(no-grant\)/.test(error.message),
  );
});

test("mutating tools refuse a denied principal through the domain's own authorization, writing nothing", async () => {
  const h = harness({ authorize: async () => ({ allowed: false, reason: "no-grant" }) });

  await assert.rejects(
    () => h.tool("collections_content_type_define").handler(ctx({ key: "recipe", label: "Recipe", fields: [] })),
    (error: unknown) => error instanceof ForbiddenError,
  );
  assert.equal(await h.repo.findByKey({ workspaceId: WORKSPACE_ID, key: "recipe" }), null);
  assert.deepEqual(h.indexCalls, []);
});
