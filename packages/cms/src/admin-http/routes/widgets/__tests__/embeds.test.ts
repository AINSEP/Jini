import { describe, expect, it } from "vitest";
import { widgetEmbedInsertRoute } from "../embed-insert.js";
import { widgetEmbedRemoveRoute } from "../embed-remove.js";
import { widgetEmbedReorderRoute } from "../embed-reorder.js";
import { forbidden, PRINCIPAL, rbac, refusalOf, signal, WORKSPACE_ID, plainOutward } from "./helpers.js";

const raw = (body: unknown, params: Record<string, string> = {}) => ({ body, query: {}, params: { workspaceId: WORKSPACE_ID, hostEntryId: "host-1", ...params } });
const VALIDATION = (error: string) => ({ status: 400, body: { error, code: "VALIDATION_ERROR" } });
/** Embed deps whose RBAC check denies: the domain function's own first line refuses before any read. */
const deniedDeps = () => ({ workspaceId: WORKSPACE_ID, outwardErrorMessage: plainOutward, widgetsDeps: () => ({ authorize: rbac(false).authorize }) as never });

describe("widgetEmbedInsertRoute", () => {
  it("keeps the path, answers 201, and refuses a missing or mistyped baseVersion/widgetEntryId", async () => {
    expect(widgetEmbedInsertRoute.method).toBe("post");
    expect(widgetEmbedInsertRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/entries/:hostEntryId/widget-embeds");
    expect(widgetEmbedInsertRoute.successStatus).toBe(201);
    for (const body of [{ widgetEntryId: "w-9" }, { baseVersion: "4", widgetEntryId: "w-9" }, { baseVersion: 4 }, { baseVersion: 4, widgetEntryId: 9 }, undefined, null]) {
      expect(await refusalOf(() => widgetEmbedInsertRoute.parse(raw(body)))).toEqual(VALIDATION("baseVersion and widgetEntryId are required"));
    }
    expect(widgetEmbedInsertRoute.parse(raw({ baseVersion: 4, widgetEntryId: "w-9", extra: 1 }))).toEqual({ ok: true, value: { hostEntryId: "host-1", baseVersion: 4, widgetEntryId: "w-9" } });
  });

  it("refuses a caller without widgets.place with the WIDGETS_FORBIDDEN body", async () => {
    const refusal = await refusalOf(() => widgetEmbedInsertRoute.handle({ input: { hostEntryId: "host-1", baseVersion: 4, widgetEntryId: "w-9" }, deps: deniedDeps(), context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(refusal).toEqual(forbidden("widgets.place"));
  });
});

describe("widgetEmbedRemoveRoute", () => {
  it("keeps the path and refuses a missing baseVersion, reading placementId from the path", async () => {
    expect(widgetEmbedRemoveRoute.method).toBe("delete");
    expect(widgetEmbedRemoveRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/entries/:hostEntryId/widget-embeds/:placementId");
    for (const body of [undefined, {}, { baseVersion: "1" }]) {
      expect(await refusalOf(() => widgetEmbedRemoveRoute.parse(raw(body, { placementId: "p-1" })))).toEqual(VALIDATION("baseVersion is required"));
    }
    expect(widgetEmbedRemoveRoute.parse(raw({ baseVersion: 1 }, { placementId: "p-1" }))).toEqual({ ok: true, value: { hostEntryId: "host-1", baseVersion: 1, placementId: "p-1" } });
  });

  it("refuses a caller without widgets.place", async () => {
    const refusal = await refusalOf(() => widgetEmbedRemoveRoute.handle({ input: { hostEntryId: "host-1", baseVersion: 1, placementId: "p-1" }, deps: deniedDeps(), context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(refusal).toEqual(forbidden("widgets.place"));
  });
});

describe("widgetEmbedReorderRoute", () => {
  const message = "baseVersion and non-empty string orderedWidgetEntryIds[] are required";

  it("keeps the path and refuses a malformed element shape before the domain's existence check", async () => {
    expect(widgetEmbedReorderRoute.method).toBe("put");
    expect(widgetEmbedReorderRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/entries/:hostEntryId/widget-embeds");
    for (const body of [undefined, { orderedWidgetEntryIds: ["w"] }, { baseVersion: 1 }, { baseVersion: 1, orderedWidgetEntryIds: "w" }, { baseVersion: 1, orderedWidgetEntryIds: ["w", ""] }, { baseVersion: 1, orderedWidgetEntryIds: [3] }]) {
      expect(await refusalOf(() => widgetEmbedReorderRoute.parse(raw(body)))).toEqual(VALIDATION(message));
    }
    expect(widgetEmbedReorderRoute.parse(raw({ baseVersion: 2, orderedWidgetEntryIds: ["w-2", "w-1"] }))).toEqual({ ok: true, value: { hostEntryId: "host-1", baseVersion: 2, orderedWidgetEntryIds: ["w-2", "w-1"] } });
    expect(widgetEmbedReorderRoute.parse(raw({ baseVersion: 2, orderedWidgetEntryIds: [] }))).toEqual({ ok: true, value: { hostEntryId: "host-1", baseVersion: 2, orderedWidgetEntryIds: [] } });
  });

  it("refuses a caller without widgets.place", async () => {
    const refusal = await refusalOf(() => widgetEmbedReorderRoute.handle({ input: { hostEntryId: "host-1", baseVersion: 1, orderedWidgetEntryIds: ["w-1"] }, deps: deniedDeps(), context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(refusal).toEqual(forbidden("widgets.place"));
  });
});
