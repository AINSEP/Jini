import { describe, expect, it } from "vitest";
import { widgetRegionGetRoute } from "../region-get.js";
import { widgetRegionsListRoute } from "../regions-list.js";
import { PRINCIPAL, recordingPort, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const READ = { permission: "widgets.read", entityType: "widget" };
const binding = { workspaceId: WORKSPACE_ID, regionKey: "header", areaEntryId: "area-1", updatedAt: "2026-01-01T00:00:00.000Z" };

describe("widgetRegionGetRoute", () => {
  it("keeps the path and reads the regionKey param", () => {
    expect(widgetRegionGetRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/widgets/regions/:regionKey");
    expect(widgetRegionGetRoute.parse({ body: {}, query: {}, params: { workspaceId: WORKSPACE_ID, regionKey: "header" } })).toEqual({ ok: true, value: { regionKey: "header" } });
  });

  it("authorizes widgets.read, then refuses an unbound region with its own 404 body", async () => {
    const { authorize, calls } = recordingPort();
    const deps = { workspaceId: WORKSPACE_ID, entryRepo: { findById: async () => null } as never, widgetBindingRepo: { findByRegion: async () => null } };
    const refusal = await refusalOf(() => widgetRegionGetRoute.handle({ input: { regionKey: "header" }, deps, context: PRINCIPAL, authorize }, { signal }));
    expect(calls).toEqual([READ]);
    expect(refusal).toEqual({ status: 404, body: { error: "region 'header' is not bound", code: "WIDGETS_AREA_NOT_FOUND" } });
  });

  it("refuses a bound region whose area entry is missing", async () => {
    const deps = { workspaceId: WORKSPACE_ID, entryRepo: { findById: async () => null } as never, widgetBindingRepo: { findByRegion: async () => binding } };
    const refusal = await refusalOf(() => widgetRegionGetRoute.handle({ input: { regionKey: "header" }, deps, context: PRINCIPAL, authorize: recordingPort().authorize }, { signal }));
    expect(refusal).toEqual({ status: 404, body: { error: "region area entry was not found", code: "WIDGETS_AREA_NOT_FOUND" } });
  });

  it("passes the authorize port's refusal through and reads nothing", async () => {
    let reads = 0;
    const deps = { workspaceId: WORKSPACE_ID, entryRepo: { findById: async () => null } as never, widgetBindingRepo: { findByRegion: async () => { reads++; return null; } } };
    const refusal = await refusalOf(() => widgetRegionGetRoute.handle({ input: { regionKey: "header" }, deps, context: PRINCIPAL, authorize: recordingPort({ deny: true }).authorize }, { signal }));
    expect(refusal.status).toBe(403);
    expect(reads).toBe(0);
  });
});

describe("widgetRegionsListRoute", () => {
  it("authorizes widgets.read and counts placements, zero when the area entry is gone", async () => {
    const { authorize, calls } = recordingPort();
    const deps = { workspaceId: WORKSPACE_ID, entryRepo: { findById: async () => null } as never, widgetBindingRepo: { listByWorkspace: async () => [binding] } };
    expect(widgetRegionsListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/widgets/regions");
    const result = await widgetRegionsListRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([READ]);
    expect(result).toEqual({ ok: true, value: { regions: [{ ...binding, placementCount: 0 }] } });
  });
});
