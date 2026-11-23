import { describe, expect, it } from "vitest";
import { parseWidgetRegionPlacements, widgetRegionMutatePlacementsRoute } from "../region-mutate-placements.js";
import { forbidden, PRINCIPAL, rbac, refusalOf, signal, WORKSPACE_ID, plainOutward } from "./helpers.js";

const raw = (body: unknown) => ({ body, query: {}, params: { workspaceId: WORKSPACE_ID, regionKey: "footer" } });
const VALIDATION = (error: string) => ({ status: 400, body: { error, code: "VALIDATION_ERROR" } });
const SHAPE = "each placement must be { placementId: string, widgetEntryId: string, enabled: boolean }, with no duplicate placementId";
const placement = { placementId: "p-1", widgetEntryId: "w-1", enabled: true };
const binding = { workspaceId: WORKSPACE_ID, regionKey: "footer", areaEntryId: "area-1", updatedAt: "2026-01-01T00:00:00.000Z" };

describe("parseWidgetRegionPlacements", () => {
  it("rejects every malformed shape and duplicate placementId, and normalizes away extra fields", () => {
    for (const bad of [null, "p", { ...placement, placementId: 1 }, { ...placement, widgetEntryId: null }, { ...placement, enabled: "yes" }, { ...placement, content: [] }, { ...placement, content: null }]) {
      expect(parseWidgetRegionPlacements({ raw: [bad] })).toBeNull();
    }
    expect(parseWidgetRegionPlacements({ raw: [placement, { ...placement, widgetEntryId: "w-2" }] })).toBeNull();
    expect(parseWidgetRegionPlacements({ raw: [{ ...placement, content: { heading: "Hi" } }, { placementId: "p-2", widgetEntryId: "w-2", enabled: false, forged: 1 }] })).toEqual([
      { ...placement, content: { heading: "Hi" } }, { placementId: "p-2", widgetEntryId: "w-2", enabled: false },
    ]);
    expect(parseWidgetRegionPlacements({ raw: [] })).toEqual([]);
  });
});

describe("widgetRegionMutatePlacementsRoute", () => {
  it("keeps the path, refuses a missing baseVersion/placements[] and then a malformed placement", async () => {
    expect(widgetRegionMutatePlacementsRoute.method).toBe("put");
    expect(widgetRegionMutatePlacementsRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/widgets/regions/:regionKey");
    for (const body of [undefined, { placements: [] }, { baseVersion: 1 }, { baseVersion: 1, placements: {} }]) {
      expect(await refusalOf(() => widgetRegionMutatePlacementsRoute.parse(raw(body)))).toEqual(VALIDATION("baseVersion and placements[] are required"));
    }
    expect(await refusalOf(() => widgetRegionMutatePlacementsRoute.parse(raw({ baseVersion: 1, placements: [{ placementId: "p" }] })))).toEqual(VALIDATION(SHAPE));
    expect(widgetRegionMutatePlacementsRoute.parse(raw({ baseVersion: 3, placements: [{ ...placement, x: 1 }] }))).toEqual({ ok: true, value: { regionKey: "footer", baseVersion: 3, placements: [placement] } });
  });

  it("refuses an unbound region with its own 404 body and builds no service deps", async () => {
    let built = 0;
    const deps = { workspaceId: WORKSPACE_ID, outwardErrorMessage: plainOutward, widgetBindingRepo: { findByRegion: async () => null }, regionDeps: () => { built++; throw new Error("unreachable"); } };
    const refusal = await refusalOf(() => widgetRegionMutatePlacementsRoute.handle({ input: { regionKey: "nowhere", baseVersion: 1, placements: [] }, deps, context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(refusal).toEqual({ status: 404, body: { error: "region 'nowhere' is not bound", code: "WIDGETS_AREA_NOT_FOUND" } });
    expect(built).toBe(0);
  });

  it("looks the binding up in this workspace and refuses a caller without widgets.place", async () => {
    const lookups: unknown[] = [];
    const deps = {
      workspaceId: WORKSPACE_ID,
      outwardErrorMessage: plainOutward,
      widgetBindingRepo: { findByRegion: async (params: { workspaceId: string; regionKey: string }) => { lookups.push(params); return binding; } },
      regionDeps: () => ({ authorize: rbac(false).authorize }) as never,
    };
    const refusal = await refusalOf(() => widgetRegionMutatePlacementsRoute.handle({ input: { regionKey: "footer", baseVersion: 1, placements: [placement] }, deps, context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(lookups).toEqual([{ workspaceId: WORKSPACE_ID, regionKey: "footer" }]);
    expect(refusal).toEqual(forbidden("widgets.place"));
  });
});
