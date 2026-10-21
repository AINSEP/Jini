import assert from "node:assert/strict";
import { test } from "vitest";

import { ToolInputError, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";

import { entriesAgentToolCatalog } from "../agent-tools.js";
import { ContentTypeNotActiveError, EntryNotFoundError, ForbiddenError, VersionConflictError } from "../errors.js";
import { InMemoryEntryRepo } from "../repo.memory.js";
import { buildEntriesRegistrations, entriesDerivedRisk, type EntriesToolDeps } from "../tool-registrations.js";
import type { OwningContentType } from "../types.js";

/**
 * @file The entries agent tools driven end to end through their registrations: the workspace-free
 * view each returns, the full domain events the host outbox receives, the read permission the list
 * tool checks itself, and the rejections — only `fieldsJson` shape problems get the schema appended.
 */

const WORKSPACE_ID = "ws-entry-tools";
const NOW = "2026-10-21T00:00:00.000Z";

const recipeType: OwningContentType = {
  workspaceId: WORKSPACE_ID, key: "recipe", status: "active",
  fields: [{ name: "summary", kind: "text", required: false, queryable: false }],
};

function ctx(input: unknown): ToolExecutionContext {
  return { executionId: "exec-1", principal: { id: "agent-principal" }, run: { id: "run-1" }, input, signal: new AbortController().signal } as ToolExecutionContext;
}

function harness(overrides: Partial<EntriesToolDeps> = {}, contentTypes: Record<string, OwningContentType> = { recipe: recipeType }) {
  const entryRepo = new InMemoryEntryRepo();
  const events: Array<{ id: string; name: string; workspaceId: string; occurredAt: string; payload: Record<string, unknown> }> = [];
  const permissionRequests: unknown[] = [];
  let ids = 0;
  const deps: EntriesToolDeps = {
    authorize: async (request) => { permissionRequests.push(request); return { allowed: true, reason: "matched" }; },
    workspaceId: WORKSPACE_ID,
    clock: { nowMs: () => Date.parse(NOW) },
    idGen: { newId: () => `id-${++ids}` },
    outbox: { enqueue: async (event) => { events.push(event); }, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
    entryRepo,
    contentTypeRepo: { findByKey: async ({ workspaceId, key }) => (workspaceId === WORKSPACE_ID ? contentTypes[key] ?? null : null) },
    ...overrides,
  };
  const registrations = buildEntriesRegistrations(deps);
  const tool = (id: string): ToolRegistration => {
    const found = registrations.find((registration) => registration.descriptor.id === id);
    assert.ok(found, `${id} must be wired`);
    return found;
  };
  return { entryRepo, events, permissionRequests, registrations, tool };
}

type EntryView = { entry: Record<string, unknown> & { id: string; version: number } };

async function createChili(h: ReturnType<typeof harness>, input: Record<string, unknown> = {}): Promise<EntryView> {
  return (await h.tool("collections_entry_create").handler(ctx({ type: "recipe", slug: "chili", title: "Chili", ...input }))) as EntryView;
}

test("the entire catalog is wired, and every wired tool is classified by the wiring layer", () => {
  const h = harness();
  const wired = h.registrations.map((r) => r.descriptor.id).sort();
  assert.deepEqual(wired, entriesAgentToolCatalog.map((t) => t.name).sort());
  assert.deepEqual(wired, [...entriesDerivedRisk.keys()].sort());
});

test("collections_entry_create returns the workspace-free view, defaulting fieldsJson to the empty site envelope", async () => {
  const h = harness();

  const result = await createChili(h);

  assert.deepEqual(result, {
    entry: {
      id: "id-1", type: "recipe", slug: "chili", status: "draft", title: "Chili",
      fieldsJson: { ext: { site: {} } }, bodyJson: null, publishedAt: null, createdAt: NOW, updatedAt: NOW, version: 1,
    },
  });
  assert.equal("workspaceId" in result.entry, false);
  assert.equal((await h.entryRepo.findById({ workspaceId: WORKSPACE_ID, id: "id-1" }))?.workspaceId, WORKSPACE_ID);
});

test("collections_entry_create keeps caller-supplied fieldsJson and bodyJson", async () => {
  const h = harness();
  const fieldsJson = { ext: { site: { summary: "Hot" } } };
  const bodyJson = { type: "doc", content: [] };

  const result = await createChili(h, { fieldsJson, bodyJson });

  assert.deepEqual(result.entry.fieldsJson, fieldsJson);
  assert.deepEqual(result.entry.bodyJson, bodyJson);
});

test("collections_entry_create appends the schema to a fieldsJson shape rejection only", async () => {
  const h = harness({}, { recipe: recipeType, archived: { ...recipeType, key: "archived", status: "deprecated" } });

  await assert.rejects(
    () => createChili(h, { fieldsJson: { ext: { site: { unknownField: 1 } } } }),
    (error: unknown) => error instanceof ToolInputError && /Schema for 'collections_entry_create'/.test(error.message),
  );
  await assert.rejects(
    () => h.tool("collections_entry_create").handler(ctx({ type: "archived", slug: "old", title: "Old" })),
    (error: unknown) => error instanceof ContentTypeNotActiveError && !/Schema for/.test(error.message),
  );
  await assert.rejects(() => h.tool("collections_entry_create").handler(ctx({ type: "recipe", slug: "chili" })), ToolInputError);
  assert.deepEqual(await h.entryRepo.listByWorkspace({ workspaceId: WORKSPACE_ID }), []);
  assert.deepEqual(h.events, []);
});

test("collections_entry_update changes the title (string only) and fields at the expected version", async () => {
  const h = harness();
  const created = await createChili(h);

  const renamed = (await h.tool("collections_entry_update").handler(ctx({ id: created.entry.id, title: "Chili v2", expectedVersion: 1 }))) as EntryView;
  assert.equal(renamed.entry.title, "Chili v2");
  assert.equal(renamed.entry.version, 2);

  const nonStringTitle = (await h.tool("collections_entry_update").handler(ctx({ id: created.entry.id, title: 42, fieldsJson: { ext: { site: { summary: "Mild" } } }, expectedVersion: 2 }))) as EntryView;
  assert.equal(nonStringTitle.entry.title, "Chili v2", "a non-string title is ignored, not coerced");
  assert.deepEqual(nonStringTitle.entry.fieldsJson, { ext: { site: { summary: "Mild" } } });

  await assert.rejects(
    () => h.tool("collections_entry_update").handler(ctx({ id: created.entry.id, title: "late", expectedVersion: 1 })),
    (error: unknown) => error instanceof VersionConflictError && !/Schema for/.test(error.message),
  );
  await assert.rejects(
    () => h.tool("collections_entry_update").handler(ctx({ id: created.entry.id, fieldsJson: { ext: {} }, expectedVersion: 3 })),
    (error: unknown) => error instanceof ToolInputError && /Schema for 'collections_entry_update'/.test(error.message),
  );
  assert.equal((await h.entryRepo.findById({ workspaceId: WORKSPACE_ID, id: created.entry.id }))?.version, 3);
});

test("collections_entry_publish / unpublish flip status and deliver full domain events to the host outbox", async () => {
  const h = harness();
  const created = await createChili(h);

  const published = (await h.tool("collections_entry_publish").handler(ctx({ id: created.entry.id, expectedVersion: 1 }))) as EntryView;
  assert.equal(published.entry.status, "published");
  assert.equal(published.entry.publishedAt, NOW);

  const unpublished = (await h.tool("collections_entry_unpublish").handler(ctx({ id: created.entry.id, expectedVersion: 2 }))) as EntryView;
  assert.equal(unpublished.entry.status, "unpublished");
  assert.equal(unpublished.entry.version, 3);

  const names = h.events.map((event) => event.name);
  assert.deepEqual(names.slice(-2), ["entry.published", "entry.unpublished"]);
  for (const event of h.events) {
    assert.equal(event.workspaceId, WORKSPACE_ID);
    assert.equal(event.occurredAt, NOW);
    assert.equal(typeof event.id, "string");
  }

  await assert.rejects(() => h.tool("collections_entry_publish").handler(ctx({ id: "missing", expectedVersion: 1 })), EntryNotFoundError);
  await assert.rejects(() => h.tool("collections_entry_unpublish").handler(ctx({ id: created.entry.id })), ToolInputError);
});

test("collections_entry_list checks admin.collections.read, accepts omitted input, and filters by type", async () => {
  const h = harness({}, { recipe: recipeType, article: { ...recipeType, key: "article" } });
  await createChili(h);
  await h.tool("collections_entry_create").handler(ctx({ type: "article", slug: "news", title: "News" }));
  h.permissionRequests.length = 0;

  const all = (await h.tool("collections_entry_list").handler(ctx(undefined))) as { items: Array<{ slug: string; workspaceId?: string }> };
  const recipes = (await h.tool("collections_entry_list").handler(ctx({ type: "recipe" }))) as { items: Array<{ slug: string }> };

  assert.deepEqual(all.items.map((item) => item.slug).sort(), ["chili", "news"]);
  assert.ok(all.items.every((item) => !("workspaceId" in item)));
  assert.deepEqual(recipes.items.map((item) => item.slug), ["chili"]);
  assert.deepEqual(h.permissionRequests[0], { principalId: "agent-principal", permission: "admin.collections.read", workspaceId: WORKSPACE_ID, entityType: "entry" });
  await assert.rejects(() => h.tool("collections_entry_list").handler(ctx("recipe")), ToolInputError);
  await assert.rejects(() => h.tool("collections_entry_list").handler(ctx({ type: 7 })), ToolInputError);
});

test("a denied principal is refused by the list check and by every mutation's own authorization, writing nothing", async () => {
  const h = harness({ authorize: async () => ({ allowed: false, reason: "no-grant" }) });

  await assert.rejects(
    () => h.tool("collections_entry_list").handler(ctx(undefined)),
    (error: unknown) => error instanceof Error && /not authorized for 'admin.collections.read' \(no-grant\)/.test(error.message),
  );
  await assert.rejects(() => createChili(h), ForbiddenError);
  assert.deepEqual(await h.entryRepo.listByWorkspace({ workspaceId: WORKSPACE_ID }), []);
});
