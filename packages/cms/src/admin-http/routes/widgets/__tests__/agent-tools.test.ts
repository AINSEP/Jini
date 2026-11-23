import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { buildWidgetAreaFieldsJson, buildWidgetInstanceFieldsJson, WidgetAreaNotFoundError } from "../../../../widgets/index.js";
import { widgetCreateToolRoute, rejectWidgetToolPlacementFailure, WidgetToolPlacementFailedError, widgetToolPlacementFailedBody } from "../agent-tools-create.js";
import { widgetDiagnoseToolRoute } from "../agent-tools-diagnose.js";
import { widgetPlaceToolRoute } from "../agent-tools-place.js";
import { widgetRemoveToolRoute } from "../agent-tools-remove.js";
import { forbidden, PRINCIPAL, rbac, recordingPort, refusalOf, signal, widgetEntry, WORKSPACE_ID, plainOutward } from "./helpers.js";

const BASE = "/api/admin/v1/workspaces/:workspaceId/widgets/tools";
const raw = (body: unknown, params: Record<string, string> = {}) => ({ body, query: {}, params: { workspaceId: WORKSPACE_ID, ...params } });
const BAD_TARGET = {
  status: 400,
  body: { error: "target must be { kind: 'region', regionKey, baseVersion } or { kind: 'embed', hostEntryId, baseVersion }", code: "VALIDATION_ERROR" },
};
const region = { kind: "region", regionKey: "footer", baseVersion: 2 } as const;
const embed = { kind: "embed", hostEntryId: "host-1", baseVersion: 3 } as const;
const binding = { workspaceId: WORKSPACE_ID, regionKey: "footer", areaEntryId: "area-1", updatedAt: "2026-01-01T00:00:00.000Z" };
const areaEntry = { id: "area-1", type: "widget_area", fieldsJson: buildWidgetAreaFieldsJson({ payload: { regionKey: "footer", doc: { schemaVersion: 1, placements: [] } } as never }) };
const noRegionDeps = () => { throw new Error("unreachable"); };

/** Placement deps whose domain RBAC denies; `found` controls the binding and area-entry lookups. */
function placementDeps({ bound = true, areaFound = true }: { bound?: boolean; areaFound?: boolean } = {}) {
  const ids: string[] = [];
  return {
    ids,
    deps: {
      workspaceId: WORKSPACE_ID,
      outwardErrorMessage: plainOutward,
      widgetBindingRepo: { findByRegion: async () => (bound ? binding : null) },
      entryRepo: { findById: async () => (areaFound ? areaEntry : null) } as never,
      idGen: { newId: () => { ids.push("p-new"); return "p-new"; } },
      widgetsDeps: () => ({ authorize: rbac(false).authorize }) as never,
      regionDeps: () => ({ authorize: rbac(false).authorize }) as never,
    },
  };
}

describe("widgetPlaceToolRoute", () => {
  it("keeps the path and refuses a bad target or a missing widgetInstanceId with the same 400 body", async () => {
    expect([widgetPlaceToolRoute.method, widgetPlaceToolRoute.path]).toEqual(["post", `${BASE}/place`]);
    for (const body of [undefined, { widgetInstanceId: "w-1" }, { widgetInstanceId: "w-1", target: "x" }, { widgetInstanceId: "w-1", target: { kind: "region", regionKey: "f" } },
      { widgetInstanceId: "w-1", target: { kind: "region", baseVersion: 1 } }, { widgetInstanceId: "w-1", target: { kind: "other", baseVersion: 1 } }, { target: region }]) {
      expect(await refusalOf(() => widgetPlaceToolRoute.parse(raw(body))), JSON.stringify(body)).toEqual(BAD_TARGET);
    }
    expect(widgetPlaceToolRoute.parse(raw({ widgetInstanceId: "w-1", target: { ...embed, extra: 1 } }))).toEqual({ ok: true, value: { widgetInstanceId: "w-1", target: embed } });
  });

  it("refuses an unbound region and a missing area entry as WIDGETS_AREA_NOT_FOUND", async () => {
    const unbound = await refusalOf(() => widgetPlaceToolRoute.handle({ input: { widgetInstanceId: "w-1", target: region }, deps: placementDeps({ bound: false }).deps, context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(unbound).toEqual({ status: 404, body: { error: "region 'footer' is not bound", code: "WIDGETS_AREA_NOT_FOUND" } });
    const orphan = await refusalOf(() => widgetPlaceToolRoute.handle({ input: { widgetInstanceId: "w-1", target: region }, deps: placementDeps({ areaFound: false }).deps, context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(orphan).toEqual({ status: 404, body: { error: "region area entry for 'footer' was not found", code: "WIDGETS_AREA_NOT_FOUND" } });
  });

  it("mints a placement id for a region and reaches the domain's widgets.place gate on both target kinds", async () => {
    const { ids, deps } = placementDeps();
    expect(await refusalOf(() => widgetPlaceToolRoute.handle({ input: { widgetInstanceId: "w-1", target: region }, deps, context: PRINCIPAL, authorize: async () => {} }, { signal }))).toEqual(forbidden("widgets.place"));
    expect(ids).toEqual(["p-new"]);
    expect(await refusalOf(() => widgetPlaceToolRoute.handle({ input: { widgetInstanceId: "w-1", target: embed }, deps, context: PRINCIPAL, authorize: async () => {} }, { signal }))).toEqual(forbidden("widgets.place"));
  });
});

describe("widgetCreateToolRoute", () => {
  it("answers 201 and refuses a bad target or a missing widgetType/title with the bad-target body", async () => {
    expect([widgetCreateToolRoute.method, widgetCreateToolRoute.path, widgetCreateToolRoute.successStatus]).toEqual(["post", `${BASE}/create`, 201]);
    for (const body of [undefined, { widgetType: "text", title: "T" }, { target: region, title: "T" }, { target: region, widgetType: "text" }]) {
      expect(await refusalOf(() => widgetCreateToolRoute.parse(raw(body)))).toEqual(BAD_TARGET);
    }
    expect(widgetCreateToolRoute.parse(raw({ target: region, widgetType: "text", title: "T", config: null }))).toEqual({ ok: true, value: { target: region, widgetType: "text", title: "T", config: {} } });
    expect(widgetCreateToolRoute.parse(raw({ target: region, widgetType: "text", title: "T", config: { a: 1 } }))).toMatchObject({ value: { config: { a: 1 } } });
  });

  it("refuses a caller without widgets.create before any placement", async () => {
    const { deps } = placementDeps();
    const refusal = await refusalOf(() => widgetCreateToolRoute.handle({ input: { target: region, widgetType: "text", title: "T", config: {} }, deps: { ...deps, regionDeps: noRegionDeps as never }, context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(refusal).toEqual(forbidden("widgets.create"));
  });

  it("keeps the created widget in a placement failure: a domain error is refused merged, anything else is carried to the host", () => {
    const widget = { id: "w-new" } as never;
    let thrown: unknown;
    try { rejectWidgetToolPlacementFailure({ widget, outwardErrorMessage: plainOutward, err: new WidgetAreaNotFoundError({ message: "region 'footer' is not bound" }) }); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(RouteRefusalError);
    expect((thrown as RouteRefusalError).response).toEqual({ status: 404, body: {
      tool: "widgets.create", widget: { id: "w-new" }, placementFailed: true, error: "region 'footer' is not bound", code: "WIDGETS_AREA_NOT_FOUND",
    } });

    const boom = new Error("hook refused");
    try { rejectWidgetToolPlacementFailure({ widget, outwardErrorMessage: plainOutward, err: boom }); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(WidgetToolPlacementFailedError);
    expect([(thrown as WidgetToolPlacementFailedError).widget, (thrown as WidgetToolPlacementFailedError).cause]).toEqual([widget, boom]);
    expect(widgetToolPlacementFailedBody({ widget, errorBody: { error: "internal error" } })).toEqual({ tool: "widgets.create", widget: { id: "w-new" }, placementFailed: true, error: "internal error" });
  });
});

describe("widgetRemoveToolRoute", () => {
  it("keeps the path and refuses a bad target or a missing placementId with the bad-target body", async () => {
    expect([widgetRemoveToolRoute.method, widgetRemoveToolRoute.path]).toEqual(["post", `${BASE}/remove`]);
    for (const body of [undefined, { placementId: "p-1" }, { target: region }, { target: region, placementId: 7 }]) {
      expect(await refusalOf(() => widgetRemoveToolRoute.parse(raw(body)))).toEqual(BAD_TARGET);
    }
    expect(widgetRemoveToolRoute.parse(raw({ target: region, placementId: "p-1" }))).toEqual({ ok: true, value: { target: region, placementId: "p-1" } });
  });

  it("refuses an unbound region and a missing area entry, and reaches the widgets.place gate on both target kinds", async () => {
    const unbound = await refusalOf(() => widgetRemoveToolRoute.handle({ input: { placementId: "p-1", target: region }, deps: placementDeps({ bound: false }).deps, context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(unbound).toEqual({ status: 404, body: { error: "region 'footer' is not bound", code: "WIDGETS_AREA_NOT_FOUND" } });
    const orphan = await refusalOf(() => widgetRemoveToolRoute.handle({ input: { placementId: "p-1", target: region }, deps: placementDeps({ areaFound: false }).deps, context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(orphan).toEqual({ status: 404, body: { error: "region area entry for 'footer' was not found", code: "WIDGETS_AREA_NOT_FOUND" } });
    const { deps } = placementDeps();
    for (const target of [region, embed]) {
      expect(await refusalOf(() => widgetRemoveToolRoute.handle({ input: { placementId: "p-1", target }, deps, context: PRINCIPAL, authorize: async () => {} }, { signal }))).toEqual(forbidden("widgets.place"));
    }
  });
});

describe("widgetDiagnoseToolRoute", () => {
  const refs = [{ workspaceId: WORKSPACE_ID, sourceEntryId: "area-9", sourceKind: "widget-area-placement", fieldPath: "doc.placements[4]", targetKind: "entry", targetId: "w-1" }];
  const diagnoseDeps = (entry: unknown, lookups: unknown[] = []) => ({
    workspaceId: WORKSPACE_ID,
    outwardErrorMessage: plainOutward,
    entryRepo: { findById: async () => entry } as never,
    entryRefsRepo: { findByTarget: async (params: unknown) => { lookups.push(params); return refs as never; } },
  });
  const run = (deps: ReturnType<typeof diagnoseDeps>, authorize = recordingPort().authorize) =>
    widgetDiagnoseToolRoute.handle({ input: { widgetInstanceId: "w-1" }, deps, context: PRINCIPAL, authorize }, { signal });

  it("keeps the path, reads the id param, and authorizes widgets.read before reading", async () => {
    expect([widgetDiagnoseToolRoute.method, widgetDiagnoseToolRoute.path]).toEqual(["get", `${BASE}/diagnose/:widgetInstanceId`]);
    expect(widgetDiagnoseToolRoute.parse(raw(undefined, { widgetInstanceId: "w-1" }))).toEqual({ ok: true, value: { widgetInstanceId: "w-1" } });
    const port = recordingPort({ deny: true });
    const lookups: unknown[] = [];
    expect(await refusalOf(() => run(diagnoseDeps(null, lookups), port.authorize))).toEqual({ status: 403, body: { error: "denied", code: "FORBIDDEN" } });
    expect([port.calls, lookups]).toEqual([[{ permission: "widgets.read", entityType: "widget" }], []]);
  });

  it("reports status for a widget, null status for a non-widget or malformed payload, and the where-used index", async () => {
    const lookups: unknown[] = [];
    const whereUsed = { count: 1, references: [{ kind: "region", sourceEntryId: "area-9", fieldPath: "doc.placements[4]" }] };
    const widget = widgetEntry({ fieldsJson: buildWidgetInstanceFieldsJson({ payload: { widgetType: "text", status: "active", config: {} } as never }) });
    expect(await run(diagnoseDeps(widget, lookups))).toEqual({ ok: true, value: { tool: "widgets.diagnose", exists: true, status: "active", whereUsed } });
    expect(lookups).toEqual([{ workspaceId: WORKSPACE_ID, targetKind: "entry", targetId: "w-1" }]);
    expect(await run(diagnoseDeps(widgetEntry({ fieldsJson: {} })))).toMatchObject({ value: { exists: true, status: null } });
    expect(await run(diagnoseDeps(widgetEntry({ type: "page" })))).toMatchObject({ value: { exists: false, status: null } });
    expect(await run(diagnoseDeps(null))).toMatchObject({ value: { exists: false, status: null } });
  });

  it("rethrows an unexpected repository failure unchanged for the host's error port", async () => {
    const boom = new Error("entries table unavailable");
    const deps = { ...diagnoseDeps(null), entryRepo: { findById: async () => { throw boom; } } as never };
    await expect(run(deps)).rejects.toBe(boom);
  });
});
