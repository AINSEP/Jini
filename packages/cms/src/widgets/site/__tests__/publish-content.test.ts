import { expect, it, vi } from "vitest";
import * as widgets from "../../index.js";
import type { EntryRecord } from "../../../entries/index.js";
import { contributeWidgetPublish, contributeWidgetAreaPublish } from "../publish-content.js";
import type { OutboxPort } from "@jini-ai/core/contracts/events";

const policy: Parameters<typeof contributeWidgetPublish>[0] = { bindingTable: "widget_bindings", buildWidgetHostPorts: () => ({}) as never,
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
      authorize: async () => ({ allowed: true, reason: "grant" }), outbox: { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} } satisfies OutboxPort, mutationActor: { id: "owner", kind: "user" } });
    for (const widgetType of ["contact-form", "text"]) {
      const entity = { entityType: "widget", id: widgetType, schemaVersion: 1, contentHash: "hash", hashVersion: 1, requiredBlobs: [], state: { slug: widgetType, title: "Widget", widgetType, config: { formDefinitionId: "form-slug" } } };
      await handler.apply({ entity, expectedVersion: undefined, principalId: "owner", idempotencyKey: widgetType });
    }
    expect(importWidgetInstance.mock.calls.map(([required]) => required.input.config.formDefinitionId)).toEqual(["destination-form", "form-slug"]);
  } finally { importWidgetInstance.mockRestore(); }
});
