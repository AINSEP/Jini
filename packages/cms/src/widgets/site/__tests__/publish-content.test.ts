import { applyRunActor, createRepoPublishHandler, gatewayDeps } from "../../../publish/content/repo-handler.js";
import { ContentTypeNotActiveError, EntryFieldValidationError, EntrySlugConflictError, TrashAwareInMemoryEntryRepo, VersionConflictError } from "../../../entries/index.js";
import { expect, it, vi } from "vitest";
import * as widgets from "../../index.js";
import type { EntryRecord } from "../../../entries/index.js";
import { InMemoryContentTypeRepo } from "../../../content-types/index.js";
import { InMemoryFormDefinitionRepo } from "../../../forms/repo.memory.js";
import { InMemoryChangeSetRepo } from "../../../forms/__tests__/change-set.fixture.js";
import { contributeWidgetPublish, contributeWidgetAreaPublish } from "../publish-content.js";
import type { OutboxPort } from "@jini-ai/core/contracts/events";
import type { PublishContentDeps } from "../../../publish/content/type-registry.js";
import type { PackedEntity } from "../../../publish/transfer/index.js";
import type { WidgetHostPorts } from "../../host-ports.js";
import type { WidgetPublishPorts } from "../../publish-ports.js";
import { extractEntryRefs } from "../../entry-refs-extractor.js";
import { InMemoryEntryRefsRepo } from "../../entry-refs.memory.js";
import { InMemoryWidgetRegionBindingRepo } from "../../repo.memory.js";
import { InMemoryOutbox, widgetHostFixture } from "../../__tests__/support/host.fixture.js";

const policy: Parameters<typeof contributeWidgetPublish>[0] = { applyRunActor, createRepoPublishHandler, gatewayDeps, ContentTypeNotActiveError, EntryFieldValidationError, EntrySlugConflictError, VersionConflictError, bindingTable: "widget_bindings", buildWidgetHostPorts: () => ({}) as never,
  findWidgetTypeRegistration: widgets.findWidgetTypeRegistration, configReferences: { formDefinitionId: "form", menuRef: "menu", categoryTermId: "term" }, formReference: { field: "formDefinitionId", widgetType: "contact-form" } };

it("repeated areas pack one last-wins region", async () => {
  const entries = ["first", "last"].map((id, index) => ({ id, version: index + 1, fieldsJson: widgets.buildWidgetAreaFieldsJson({ payload: { regionKey: "footer", doc: { schemaVersion: 1, placements: [] } } }) })) as EntryRecord[];
  const handler = contributeWidgetAreaPublish(policy).build({ workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "id" }, ports: { "widget-area": { entries: { listByWorkspace: async () => entries } } as never } });
  const packed = [];
  for await (const entity of handler.pack()) packed.push(entity);
  expect(packed).toHaveLength(1);
  expect(packed[0]).toMatchObject({ id: "footer", state: { regionKey: "footer", placements: [] } });
});

it("unknown destination widget schemas refuse before a widget is written", async () => {
  const write = vi.fn();
  const ports = { entries: { findAnyById: async () => null, findAnyBySlug: async () => null, insert: write } } as never;
  const handler = contributeWidgetPublish(policy).build({ workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "id" }, ports: { widget: ports },
    authorize: async () => ({ allowed: true, reason: "grant" }), outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} } satisfies OutboxPort, mutationActor: { id: "owner", kind: "user" } });
  const entity = { entityType: "widget", id: "id", schemaVersion: 1, contentHash: "hash", hashVersion: 1, requiredBlobs: [], state: { slug: "widget", widgetType: "unknown", config: {} } };
  expect(await handler.precheck({ entity })).toBe("widget 'id': widget type 'unknown' is not installed on the destination");
  await expect(handler.apply({ entity, expectedVersion: undefined, principalId: "owner", idempotencyKey: "id" })).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
});

it("destination form ids swap only for the matching widget type", async () => {
  const importWidgetInstance = vi.spyOn(widgets, "importWidgetInstance").mockResolvedValue({ instance: { version: 1 } } as never);
  try {
    const forms = { findBySlug: async () => ({ id: "destination-form" }) };
    const ports = { entries: { findAnyById: async () => null }, forms } as never;
    const handler = contributeWidgetPublish(policy).build({ workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "id" }, ports: { widget: ports },
      authorize: async () => ({ allowed: true, reason: "grant" }), outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} } satisfies OutboxPort, mutationActor: { id: "owner", kind: "user" }, changeSets: new InMemoryChangeSetRepo() });
    for (const widgetType of ["contact-form", "text"]) {
      const entity = { entityType: "widget", id: widgetType, schemaVersion: 1, contentHash: "hash", hashVersion: 1, requiredBlobs: [], state: { slug: widgetType, title: "Widget", widgetType, config: { formDefinitionId: "form-slug" } } };
      await handler.apply({ entity, expectedVersion: undefined, principalId: "owner", idempotencyKey: widgetType });
    }
    expect(importWidgetInstance.mock.calls.map(([required]) => required.input.config.formDefinitionId)).toEqual(["destination-form", "form-slug"]);
  } finally { importWidgetInstance.mockRestore(); }
});

const NOW = "2026-11-18T00:00:00.000Z";

function publication(workspaceId: string) {
  let next = 0;
  const entries = new TrashAwareInMemoryEntryRepo({ onWriteSettled: () => {} });
  const forms = new InMemoryFormDefinitionRepo();
  const bindings = new InMemoryWidgetRegionBindingRepo();
  const ports = { entries, forms, bindings, contentTypes: new InMemoryContentTypeRepo(), entryRefs: new InMemoryEntryRefsRepo() } satisfies WidgetPublishPorts;
  // The widget writers use only these host facets. Unexpected host calls fail in this fixture.
  const wiredPolicy = { ...policy, buildWidgetHostPorts: () => ({ ...widgetHostFixture, entryRefs: { extract: extractEntryRefs } }) as WidgetHostPorts };
  const deps: PublishContentDeps<{ widget: WidgetPublishPorts; "widget-area": WidgetPublishPorts }> = {
    workspaceId, clock: { nowMs: () => Date.parse(NOW) }, idGen: { newId: () => `${workspaceId}-generated-${++next}` },
    ports: { widget: ports, "widget-area": ports },
    authorize: async () => ({ allowed: true, reason: "matched" }),
    mutationActor: { id: "owner", kind: "user" },
    outbox: new InMemoryOutbox(), changeSets: new InMemoryChangeSetRepo(),
  };
  const widget = contributeWidgetPublish(wiredPolicy).build(deps);
  const area = contributeWidgetAreaPublish(wiredPolicy).build(deps);
  const form = (id: string) => forms.create({ id, workspaceId, slug: "contact", name: "Contact", fields: [], notify: { enabled: false, recipients: [] }, status: "active", createdAt: NOW, updatedAt: NOW, version: 1 });
  const seedWidget = (id: string, payload: Parameters<typeof widgets.buildWidgetInstanceFieldsJson>[0]["payload"], deletedAt: string | null = null) => entries.saveAny({
    id, workspaceId, type: widgets.WIDGET_CONTENT_TYPE, slug: id, title: id, status: "draft", bodyJson: null,
    fieldsJson: widgets.buildWidgetInstanceFieldsJson({ payload }), publishedAt: null, createdAt: NOW, updatedAt: NOW, version: 7, deletedAt,
  });
  return { workspaceId, entries, bindings, widget, area, form, seedWidget };
}

function incoming(entityType: string, id: string, state: Record<string, unknown>): PackedEntity {
  return { entityType, id, state, schemaVersion: 1, contentHash: "incoming", hashVersion: 1, requiredBlobs: [] };
}

function applying(entity: PackedEntity, expectedVersion?: number) {
  return { entity, expectedVersion, principalId: "owner", idempotencyKey: `${entity.id}-${expectedVersion ?? "create"}` };
}

it("packs portable form links and scoped media references, excluding trashed widgets", async () => {
  const source = publication("source");
  await source.form("source-form");
  await source.seedWidget("connected", { widgetType: "contact-form", config: { formDefinitionId: "source-form" }, status: "active" });
  await source.seedWidget("dangling", { widgetType: "contact-form", config: { formDefinitionId: "missing-form" }, status: "active" });
  await source.seedWidget("photo", { widgetType: "gallery", config: { items: [{ slug: "uploaded-photo" }] }, status: "active" });
  await source.seedWidget("text", { widgetType: "text", config: { body: '<a href="/m/annual%20report/original">Report</a><img src="/media/annual%20report/thumb">' }, status: "active" });
  await source.seedWidget("legacy-trash", { widgetType: "text", config: { body: "hidden" }, status: "trash" });
  await source.seedWidget("deleted", { widgetType: "text", config: { body: "hidden" }, status: "active" }, NOW);

  const packed: PackedEntity[] = [];
  for await (const entity of source.widget.pack()) packed.push(entity);
  expect(packed.map(({ id, state }) => [id, state])).toEqual([
    ["connected", { slug: "connected", title: "connected", widgetType: "contact-form", config: { formDefinitionId: "contact" } }],
    ["dangling", { slug: "dangling", title: "dangling", widgetType: "contact-form", config: { formDefinitionId: "missing-form" } }],
    ["photo", { slug: "photo", title: "photo", widgetType: "gallery", config: { items: [{ slug: "uploaded-photo" }] } }],
    ["text", { slug: "text", title: "text", widgetType: "text", config: { body: '<a href="/m/annual%20report/original">Report</a><img src="/media/annual%20report/thumb">' } }],
  ]);
  expect(packed.map((entity) => source.widget.references?.({ entity }))).toEqual([
    [{ entityType: "form", key: "contact" }], [{ entityType: "form", key: "missing-form" }],
    [{ entityType: "media", key: "uploaded-photo" }], [{ entityType: "media", key: "annual report" }],
  ]);
});

it("precheck rejects a conflicting slug held in the destination Trash", async () => {
  const destination = publication("destination");
  await destination.seedWidget("notice", { widgetType: "text", config: { body: "old" }, status: "active" }, NOW);
  const entity = incoming("widget", "imported", { slug: "notice", title: "New notice", widgetType: "text", config: { body: "new" } });
  expect(await destination.widget.precheck({ entity })).toBe("widget 'notice' is in the trash at this destination and still holds slug 'notice' — restore it, or delete it permanently from the Trash, before publishing");
  expect(await destination.entries.findById({ workspaceId: destination.workspaceId, id: "notice" })).toBeNull();
});

it("destination precheck distinguishes an installed type with bad settings from a valid widget", async () => {
  const destination = publication("destination");
  const state = { slug: "notice", title: "Notice", widgetType: "text" };
  const invalid = incoming("widget", "notice", { ...state, config: { body: 42 } });
  const valid = incoming("widget", "notice", { ...state, config: { body: "Hello" } });
  expect(await destination.widget.precheck({ entity: invalid })).toBe("widget 'notice': its settings do not fit the destination's 'text' widget");
  expect(await destination.widget.precheck({ entity: valid })).toBeNull();
});

it("publishing a contact form widget writes the destination form id and preserves its portable hash", async () => {
  const source = publication("source");
  const destination = publication("destination");
  await source.form("source-form");
  await destination.form("destination-form");
  await source.seedWidget("contact-box", { widgetType: "contact-form", config: { formDefinitionId: "source-form" }, status: "active" });
  const packed: PackedEntity[] = [];
  for await (const entity of source.widget.pack()) packed.push(entity);
  expect(packed).toHaveLength(1);
  const entity = packed[0]!;
  expect(await destination.widget.apply(applying(entity))).toEqual({ changeSetId: "contact-box", version: 1 });
  const saved = await destination.entries.findById({ workspaceId: destination.workspaceId, id: "contact-box" });
  expect(widgets.parseWidgetInstancePayload({ fieldsJson: saved?.fieldsJson })).toEqual({ widgetType: "contact-form", config: { formDefinitionId: "destination-form" }, status: "active" });
  expect(await destination.widget.inspect({ id: "contact-box" })).toEqual({ version: 1, hash: entity.contentHash });
});

it("publishing an area rejects missing placements without binding, then replaces placements on its destination row", async () => {
  const destination = publication("destination");
  const { workspaceId } = destination;
  const placements = [{ placementId: "notice-placement", widgetEntryId: "notice", enabled: true, content: { html: '<img src="/m/notice-photo/thumb">' } }];
  const entity = incoming("widget-area", "footer", { regionKey: "footer", placements, schemaVersion: 1 });
  expect(destination.area.references?.({ entity })).toEqual([{ entityType: "widget", key: "notice" }, { entityType: "media", key: "notice-photo" }]);
  await expect(destination.area.apply(applying(entity))).rejects.toMatchObject({ rowOutcome: "blocked", message: "placement references widget 'notice', which does not exist in workspace 'destination'" });
  expect(await destination.bindings.listByWorkspace({ workspaceId })).toEqual([]);
  expect(await destination.entries.listByWorkspace({ workspaceId }, { type: widgets.WIDGET_AREA_CONTENT_TYPE })).toEqual([]);

  const widget = incoming("widget", "notice", { slug: "notice", title: "Notice", widgetType: "text", config: { body: "Hello" } });
  await destination.widget.apply(applying(widget));
  expect(await destination.area.apply(applying(entity))).toEqual({ changeSetId: "footer", version: 2 });
  const binding = await destination.bindings.findByRegion({ workspaceId, regionKey: "footer" });
  const areaId = binding?.areaEntryId;
  const saved = await destination.entries.findById({ workspaceId, id: areaId ?? "unbound" });
  expect(widgets.parseWidgetAreaPayload({ fieldsJson: saved?.fieldsJson })).toEqual({ regionKey: "footer", doc: { schemaVersion: 1, placements } });

  await destination.bindings.upsert({ workspaceId, regionKey: "orphan", areaEntryId: "missing", updatedAt: NOW });
  const cleared = incoming("widget-area", "footer", { regionKey: "footer", placements: [], schemaVersion: 1 });
  expect(await destination.area.apply(applying(cleared, 2))).toEqual({ changeSetId: "footer", version: 3 });
  expect(await destination.bindings.listByWorkspace({ workspaceId })).toEqual([{ workspaceId, regionKey: "footer", areaEntryId: areaId, updatedAt: NOW }]);
  const updated = await destination.entries.findById({ workspaceId, id: areaId ?? "unbound" });
  expect(widgets.parseWidgetAreaPayload({ fieldsJson: updated?.fieldsJson })).toEqual({ regionKey: "footer", doc: { schemaVersion: 1, placements: [] } });
});
