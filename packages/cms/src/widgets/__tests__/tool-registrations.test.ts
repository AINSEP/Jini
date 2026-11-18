import assert from "node:assert/strict";
import { test } from "vitest";

import { ToolInputError, type ToolExecutionContext, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { InMemoryContentTypeRepo } from "../../content-types/index.js";
import type { WidgetsAuthorizeFn } from "../authorize-helper.js";
import { widgetsAgentToolCatalog } from "../agent-tools.js";
import type { EmbedServiceDeps } from "../embed-service.js";
import { InMemoryWidgetRegionBindingRepo } from "../repo.memory.js";
import { buildWidgetsToolRegistrations, widgetsDerivedRisk } from "../tool-registrations.js";
import type { WidgetsPackageToolDeps } from "../tool-handlers.types.js";
import type { WidgetTrashDeps } from "../write-service.js";
import { InMemoryEntryRefsRepo, InMemoryOutbox, widgetHostFixture } from "./support/host.fixture.js";
import { memoryWidgetTrash } from "./support/memory-widget-trash.js";

/**
 * @file The widgets tool registrations over in-memory fakes of their ports: the catalog's ids, the
 * authored risk map, the permission refusal of every tool, one success view per instance and region
 * tool, the typed-error mapping, the schema decoration of a shape rejection, the placement request
 * validation, and that the injected hook-refusal wrapper is applied once over the whole handler map.
 * Host metadata is deliberately absent from these registrations: a host binds it around them. The
 * embed tools' success paths are covered with the embed service's own tests; here they are only
 * checked for their refusals, since this fixture carries the ports the other tools read.
 */

const WORKSPACE_ID = "ws-widgets-tools";
const PRINCIPAL_ID = "principal-under-test";
const NOW = "2026-11-17T00:00:00.000Z";

const TOOL_IDS = [
  "widgets_list_instances", "widgets_get_instance", "widgets_list_regions", "widgets_get_region",
  "widgets_create_instance", "widgets_update_instance", "widgets_trash_instance", "widgets_bind_region",
  "widgets_set_region_placements", "widgets_insert_embed", "widgets_remove_embed", "widgets_reorder_embeds",
] as const;

const REFUSAL_PERMISSION: Readonly<Record<(typeof TOOL_IDS)[number], string>> = {
  widgets_list_instances: "widgets.read", widgets_get_instance: "widgets.read", widgets_list_regions: "widgets.read",
  widgets_get_region: "widgets.read", widgets_create_instance: "widgets.create", widgets_update_instance: "widgets.update",
  widgets_trash_instance: "widgets.read", widgets_bind_region: "widgets.place", widgets_set_region_placements: "widgets.place",
  widgets_insert_embed: "widgets.place", widgets_remove_embed: "widgets.place", widgets_reorder_embeds: "widgets.place",
};

interface Fixture {
  deps: WidgetsPackageToolDeps;
  allow: { value: boolean };
  wrapped: string[][];
}

function makeFixture(options: { wrap?: WidgetsPackageToolDeps["wrapHookRefusals"] } = {}): Fixture {
  let counter = 0;
  const allow = { value: true };
  const wrapped: string[][] = [];
  const widgetTrash = memoryWidgetTrash();
  const authorize: WidgetsAuthorizeFn = async () => (allow.value ? { allowed: true, reason: "matched" } : { allowed: false, reason: "insufficient_permission" });
  const entryRefsRepo = new InMemoryEntryRefsRepo();
  const bindingRepo = new InMemoryWidgetRegionBindingRepo();
  const ids = { newId: () => `id-${++counter}` };
  const base = {
    host: widgetHostFixture,
    entryRepo: widgetTrash.entryRepo,
    contentTypeRepo: new InMemoryContentTypeRepo(),
    entryRefsRepo,
    clock: { nowMs: () => Date.parse(NOW) },
    ids,
    authorize,
    outbox: new InMemoryOutbox(),
  };
  const deps: WidgetsPackageToolDeps = {
    authorize,
    workspaceId: WORKSPACE_ID,
    idGen: ids,
    entryRepo: widgetTrash.entryRepo,
    entryRefsRepo,
    widgetBindingRepo: bindingRepo,
    // The embed tools read a post/page store this fixture does not carry; they are only reached here on their refusal paths.
    composeWriteDeps: () => ({ ...base, remove: widgetTrash.remove } as unknown as WidgetTrashDeps & EmbedServiceDeps),
    composeRegionDeps: () => ({ ...base, bindingRepo }),
    wrapHookRefusals: options.wrap ?? ((handlers) => {
      wrapped.push(Object.keys(handlers));
      return handlers;
    }),
  };
  return { deps, allow, wrapped };
}

function ctx(input: unknown): ToolExecutionContext {
  return { executionId: "exec-1", principal: { id: PRINCIPAL_ID }, run: { id: "run-1" }, input, signal: new AbortController().signal };
}

function caller(registrations: ToolRegistration[]) {
  return (id: string, input: unknown): Promise<unknown> => {
    const found = registrations.find((registration) => registration.descriptor.id === id);
    assert.ok(found, `expected '${id}' to be wired`);
    return Promise.resolve(found.handler(ctx(input)));
  };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to reject");
}

test("the twelve tools are registered in catalog order, each with its published input schema and no host metadata", () => {
  const registrations = buildWidgetsToolRegistrations({ deps: makeFixture().deps });
  assert.deepEqual(registrations.map((registration) => registration.descriptor.id), [...TOOL_IDS]);
  assert.deepEqual(widgetsAgentToolCatalog.map((entry) => entry.name), [...TOOL_IDS]);
  for (const registration of registrations) {
    assert.ok(registration.descriptor.inputSchema, `${registration.descriptor.id} publishes a schema`);
    assert.equal(registration.descriptor.metadata, undefined, `${registration.descriptor.id} carries no host metadata`);
  }
});

test("the authored risk map names the four reads as none and the eight writes as durable", () => {
  assert.deepEqual([...widgetsDerivedRisk.entries()], TOOL_IDS.map((id, index) => [id, index < 4 ? "none" : "mutates-durable-state"]));
});

test("the hook-refusal wrapper is applied once, to the map of all twelve handlers", () => {
  const fixture = makeFixture();
  buildWidgetsToolRegistrations({ deps: fixture.deps });
  assert.deepEqual(fixture.wrapped, [[...TOOL_IDS]]);
});

test("a refusal the injected wrapper produces reaches the model unchanged", async () => {
  const refusal = new ToolInputError({ message: "PLUGIN_HOOK_FAILED: a plugin refused this save" });
  const wrap = (handlers: Record<string, ToolHandler>): Record<string, ToolHandler> =>
    Object.fromEntries(Object.keys(handlers).map((id) => [id, async () => { throw refusal; }]));
  const call = caller(buildWidgetsToolRegistrations({ deps: makeFixture({ wrap }).deps }));
  assert.equal(await rejection(call("widgets_insert_embed", { hostEntryId: "host", baseVersion: 1, widgetEntryId: "w" })), refusal);
});

for (const toolId of TOOL_IDS) {
  test(`${toolId}: a principal without the permission is refused with the model-facing forbidden error`, async () => {
    const fixture = makeFixture();
    const call = caller(buildWidgetsToolRegistrations({ deps: fixture.deps }));
    const created = (await call("widgets_create_instance", { widgetType: "text", title: "Note", config: { body: "hi" } })) as { instance: { id: string } };
    await call("widgets_bind_region", { regionKey: "footer" });
    fixture.allow.value = false;
    const inputs: Record<string, unknown> = {
      widgets_get_instance: { widgetInstanceId: created.instance.id },
      widgets_get_region: { regionKey: "footer" },
      widgets_create_instance: { widgetType: "text", title: "Other", config: { body: "x" } },
      widgets_update_instance: { widgetInstanceId: created.instance.id, baseVersion: 1, config: { body: "z" } },
      widgets_trash_instance: { widgetInstanceId: created.instance.id },
      widgets_bind_region: { regionKey: "footer" },
      widgets_set_region_placements: { regionKey: "footer", baseVersion: 1, placements: [] },
      widgets_insert_embed: { hostEntryId: "host", baseVersion: 1, widgetEntryId: created.instance.id },
      widgets_remove_embed: { hostEntryId: "host", baseVersion: 1, placementId: "placement-x" },
      widgets_reorder_embeds: { hostEntryId: "host", baseVersion: 1, orderedWidgetEntryIds: [created.instance.id] },
    };
    const error = await rejection(call(toolId, inputs[toolId] ?? {}));
    assert.ok(error instanceof ToolInputError, `got ${error.constructor.name}`);
    assert.equal(error.message, `WIDGETS_FORBIDDEN: principal '${PRINCIPAL_ID}' lacks permission '${REFUSAL_PERMISSION[toolId]}' (insufficient_permission)`);
  });
}

test("instance and region tools return the model-facing views", async () => {
  const call = caller(buildWidgetsToolRegistrations({ deps: makeFixture().deps }));
  const view = (version: number, body: string) => ({ id: "id-2", slug: "note", title: "Note", status: "active", widgetType: "text", config: { body }, version });
  const created = (await call("widgets_create_instance", { widgetType: "text", title: "Note", config: { body: "hi" } })) as { instance: { id: string; slug: string } };
  assert.equal(created.instance.id, "id-2");
  assert.deepEqual(await call("widgets_list_instances", { widgetType: "text" }), { instances: [view(1, "hi")].map((v) => ({ ...v, slug: created.instance.slug })) });
  assert.deepEqual(await call("widgets_list_instances", { widgetType: "gallery" }), { instances: [] });
  const fetched = (await call("widgets_get_instance", { widgetInstanceId: "id-2" })) as { whereUsed: unknown };
  assert.deepEqual(fetched.whereUsed, { count: 0, references: [] });
  const bound = (await call("widgets_bind_region", { regionKey: "footer" })) as { area: { id: string; version: number } };
  assert.deepEqual(await call("widgets_set_region_placements", { regionKey: "footer", baseVersion: bound.area.version, placements: [{ widgetEntryId: "id-2", enabled: true }] }),
    { area: { id: bound.area.id, regionKey: "footer", version: 2, updatedAt: NOW } });
  assert.deepEqual(await call("widgets_list_regions", {}), { regions: [{ regionKey: "footer", areaEntryId: bound.area.id, updatedAt: NOW, placementCount: 1 }] });
  const region = (await call("widgets_get_region", { regionKey: "footer" })) as { placements: Array<Record<string, unknown>> };
  assert.deepEqual(region.placements.map((placement) => ({ widgetTitle: placement.widgetTitle, widgetType: placement.widgetType, broken: placement.broken })), [{ widgetTitle: "Note", widgetType: "text", broken: false }]);
  const updated = (await call("widgets_update_instance", { widgetInstanceId: "id-2", baseVersion: 1, config: { body: "bye" } })) as { instance: { version: number; config: unknown } };
  assert.deepEqual({ version: updated.instance.version, config: updated.instance.config }, { version: 2, config: { body: "bye" } });
  const trashed = (await call("widgets_trash_instance", { widgetInstanceId: "id-2" })) as Record<string, unknown>;
  assert.deepEqual({ trashed: trashed.trashed, cancelled: trashed.cancelled, widgetInstanceId: trashed.widgetInstanceId, title: trashed.title }, { trashed: true, cancelled: false, widgetInstanceId: "id-2", title: "Note" });
});

test("an unbound region is reported with the model-facing not-found code", async () => {
  const call = caller(buildWidgetsToolRegistrations({ deps: makeFixture().deps }));
  const error = await rejection(call("widgets_get_region", { regionKey: "missing" }));
  assert.ok(error instanceof ToolInputError);
  assert.equal(error.message, "WIDGETS_AREA_NOT_FOUND: region 'missing' is not bound");
});

test("a stale baseVersion is reported with the model-facing conflict code and the retry instruction", async () => {
  const call = caller(buildWidgetsToolRegistrations({ deps: makeFixture().deps }));
  await call("widgets_create_instance", { widgetType: "text", title: "Note", config: { body: "hi" } });
  const error = await rejection(call("widgets_update_instance", { widgetInstanceId: "id-2", baseVersion: 7, config: { body: "x" } }));
  assert.ok(error instanceof ToolInputError);
  assert.match(error.message, /^WIDGETS_VERSION_CONFLICT: .*Nothing was written\. Re-read the host or instance to get its current version \(1\) and resend with that as baseVersion\.$/);
});

test("a config that fails validation is rejected with the tool's published schema attached", async () => {
  const call = caller(buildWidgetsToolRegistrations({ deps: makeFixture().deps }));
  const error = await rejection(call("widgets_create_instance", { widgetType: "text", title: "Note", config: { unexpected: true } }));
  assert.ok(error instanceof ToolInputError);
  assert.match(error.message, /widgets_create_instance/);
});

test("placements are validated before any write: malformed, non-boolean enabled, duplicate id and a non-array", async () => {
  const call = caller(buildWidgetsToolRegistrations({ deps: makeFixture().deps }));
  await call("widgets_bind_region", { regionKey: "footer" });
  const send = (placements: unknown) => call("widgets_set_region_placements", { regionKey: "footer", baseVersion: 1, placements });
  const messages = [
    await rejection(send("nope")), await rejection(send(["nope"])),
    await rejection(send([{ widgetEntryId: "w", enabled: "yes" }])),
    await rejection(send([{ widgetEntryId: "w", enabled: true, placementId: "p" }, { widgetEntryId: "w", enabled: true, placementId: "p" }])),
    await rejection(send([{ widgetEntryId: "w", enabled: true, content: "text" }])),
  ].map((error) => (error as Error).message);
  assert.deepEqual(messages, [
    "'placements' (array) is required",
    "each placement must be an object",
    "each placement's 'enabled' must be a boolean",
    "duplicate placementId 'p'",
    "placement content must be an object",
  ]);
});
