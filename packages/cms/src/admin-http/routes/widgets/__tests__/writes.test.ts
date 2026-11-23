import { describe, expect, it } from "vitest";
import { widgetCreateRoute } from "../create.js";
import { widgetRegionBindRoute } from "../region-bind.js";
import { widgetTrashRoute } from "../trash.js";
import { widgetUpdateRoute } from "../update.js";
import { forbidden, PRINCIPAL, rbac, recordingPort, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const raw = (body: unknown, params: Record<string, string> = {}) => ({ body, query: {}, params: { workspaceId: WORKSPACE_ID, ...params } });
const VALIDATION = (error: string) => ({ status: 400, body: { error, code: "VALIDATION_ERROR" } });
/** Write deps whose RBAC check denies: the domain function's own first line refuses before any write. */
const deniedDeps = () => ({ workspaceId: WORKSPACE_ID, widgetsDeps: () => ({ authorize: rbac(false).authorize }) as never });

describe("widgetCreateRoute", () => {
  it("answers 201 and refuses a body without string widgetType/title", async () => {
    expect(widgetCreateRoute.successStatus).toBe(201);
    expect(await refusalOf(() => widgetCreateRoute.parse(raw({ widgetType: "text" })))).toEqual(VALIDATION("widgetType and title are required strings"));
    expect(await refusalOf(() => widgetCreateRoute.parse(raw(undefined)))).toEqual(VALIDATION("widgetType and title are required strings"));
    expect(widgetCreateRoute.parse(raw({ widgetType: "text", title: "T", config: null, slug: 3 }))).toEqual({ ok: true, value: { widgetType: "text", title: "T", config: {} } });
  });

  it("refuses a caller without widgets.create with the WIDGETS_FORBIDDEN body", async () => {
    const refusal = await refusalOf(() => widgetCreateRoute.handle({ input: { widgetType: "text", title: "T", config: {} }, deps: deniedDeps(), context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(refusal).toEqual(forbidden("widgets.create"));
  });
});

describe("widgetUpdateRoute", () => {
  it("checks baseVersion before title, and defaults a non-object config", async () => {
    expect(await refusalOf(() => widgetUpdateRoute.parse(raw({ title: 1 }, { id: "w-1" })))).toEqual(VALIDATION("baseVersion is required"));
    expect(await refusalOf(() => widgetUpdateRoute.parse(raw({ baseVersion: 1, title: 1 }, { id: "w-1" })))).toEqual(VALIDATION("title must be a string"));
    expect(widgetUpdateRoute.parse(raw({ baseVersion: 2, config: "x" }, { id: "w-1" }))).toEqual({ ok: true, value: { id: "w-1", baseVersion: 2, config: {} } });
  });

  it("refuses a caller without widgets.update", async () => {
    const refusal = await refusalOf(() => widgetUpdateRoute.handle({ input: { id: "w-1", baseVersion: 1, config: {} }, deps: deniedDeps(), context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(refusal).toEqual(forbidden("widgets.update"));
  });
});

describe("widgetTrashRoute", () => {
  it("keeps the path and refuses a caller without widgets.delete", async () => {
    expect(widgetTrashRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/widgets/:id/trash");
    const refusal = await refusalOf(() => widgetTrashRoute.handle({ input: { id: "w-1" }, deps: deniedDeps(), context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(refusal).toEqual(forbidden("widgets.delete"));
  });
});

describe("widgetRegionBindRoute", () => {
  it("refuses a missing, blank or non-string regionKey before authorizing", async () => {
    const { authorize, calls } = recordingPort();
    const deps = { workspaceId: WORKSPACE_ID, regionDeps: () => { throw new Error("must not build deps"); } };
    for (const body of [{}, { regionKey: "   " }, { regionKey: 123 }]) {
      const input = widgetRegionBindRoute.parse(raw(body));
      if (!input.ok) throw new Error("parse never fails");
      expect(await refusalOf(() => widgetRegionBindRoute.handle({ input: input.value, deps, context: PRINCIPAL, authorize }, { signal }))).toEqual(VALIDATION("regionKey is required"));
    }
    expect(calls).toEqual([]);
    expect(widgetRegionBindRoute.successStatus).toBe(201);
  });

  it("authorizes widgets.place and builds no deps when refused", async () => {
    let built = 0;
    const deps = { workspaceId: WORKSPACE_ID, regionDeps: () => { built++; throw new Error("unreachable"); } };
    const port = recordingPort({ deny: true });
    const refusal = await refusalOf(() => widgetRegionBindRoute.handle({ input: { body: { regionKey: "header" } }, deps, context: PRINCIPAL, authorize: port.authorize }, { signal }));
    expect(refusal.status).toBe(403);
    expect(port.calls).toEqual([{ permission: "widgets.place", entityType: "widget" }]);
    expect(built).toBe(0);
  });
});
