import { isRouteReply, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { expect, it, vi } from "vitest";
import { adminSurfaceWritePreflight, defineAdminSurfaceRoutes, type AdminSurfaceRouteSurface } from "../admin-surfaces.js";
import { PRINCIPAL, raw, refusalOf, WORKSPACE_ID } from "./helpers.js";

const descriptor = {
  id: "report", title: "Run report", entry: "dist/frame.js", actions: [{ id: "run" }],
};
const surface: AdminSurfaceRouteSurface = { plugin: { pluginId: "acme" }, descriptor };
const params = { workspaceId: WORKSPACE_ID, pluginId: "acme", surfaceId: "report" };
const lookup = { workspaceId: "ws-1", pluginId: "acme", surfaceId: "report" };
const context = { ...lookup, principalId: "principal-1" };
const routes = defineAdminSurfaceRoutes<AdminSurfaceRouteSurface, { queued: boolean }>();

it.each([
  { caseName: "same-origin writes", origin: "https://admin.example.test", site: "same-origin", allowed: true },
  { caseName: "older same-origin browsers", origin: "https://admin.example.test", site: undefined, allowed: true },
  { caseName: "cross-origin writes", origin: "https://other.example.test", site: undefined, allowed: false },
  { caseName: "opaque frame origins", origin: "null", site: undefined, allowed: false },
  { caseName: "conflicting fetch metadata", origin: "https://admin.example.test", site: "same-site", allowed: false },
])("preflights $caseName before accepting surface writes", ({ origin, site, allowed }) => {
  const refusal = { status: 403, body: { code: "CROSS_ORIGIN", error: "Write must come from this admin origin" } };
  const preflight = adminSurfaceWritePreflight({ refusal });
  expect(preflight.readHeaders).toEqual(["origin", "host", "sec-fetch-site"]);
  const result = preflight.check({ headers: {
    origin, host: "admin.example.test", ...(site === undefined ? {} : { "sec-fetch-site": site }),
  } });
  expect(result).toBe(allowed ? undefined : refusal);
});

it("lists admitted surfaces only for the requested plugin and fills absent link origins", async () => {
  expect(routes.list.method).toBe("get");
  expect(routes.list.path).toBe("/api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId/surfaces");
  const authorize = vi.fn<JsonRouteAuthorize>().mockResolvedValue(undefined);
  const listSurfaces = vi.fn(async () => [
    { ...surface, descriptor: { ...descriptor, id: "summary", entry: "summary.js", title: "Summary", linkOrigins: ["https://login.example.test"] } },
    { ...surface, plugin: { pluginId: "unrelated" } },
    surface,
  ]);
  const surfaceFileUrl = vi.fn(({ pluginId, surfaceId, path }: { pluginId: string; surfaceId: string; path: string }) =>
    `/frames/${pluginId}/${surfaceId}/${path}`);
  const parsed = await routes.list.parse(raw(params));
  if (!parsed.ok) throw new Error("expected the list route to parse");
  const result = await routes.list.handle({ input: parsed.value, deps: { workspaceId: WORKSPACE_ID, listSurfaces, surfaceFileUrl }, authorize });
  expect(result).toStrictEqual({ ok: true, value: { pluginId: "acme", surfaces: [
    { id: "summary", title: "Summary", src: "/frames/acme/summary/summary.js", actions: [{ id: "run" }], linkOrigins: ["https://login.example.test"] },
    { id: "report", title: "Run report", src: "/frames/acme/report/dist/frame.js", actions: [{ id: "run" }], linkOrigins: [] },
  ] } });
  expect(authorize.mock.calls).toEqual([[{ permission: "admin.plugins.read" }]]);
  expect(listSurfaces.mock.calls).toEqual([[{ workspaceId: "ws-1" }]]);
  expect(surfaceFileUrl.mock.calls).toEqual([
    [{ pluginId: "acme", surfaceId: "summary", path: "summary.js" }],
    [{ pluginId: "acme", surfaceId: "report", path: "dist/frame.js" }],
  ]);
});

it("fails a list without an authorizer before reading admitted surfaces", async () => {
  const listSurfaces = vi.fn(async () => [surface]);
  const surfaceFileUrl = vi.fn(() => "/never");
  await expect(routes.list.handle({ input: { pluginId: "acme" }, deps: { workspaceId: WORKSPACE_ID, listSurfaces, surfaceFileUrl } }))
    .rejects.toThrow(new Error("agent-plugins admin route has no authorizer"));
  expect(listSurfaces).not.toHaveBeenCalled();
  expect(surfaceFileUrl).not.toHaveBeenCalled();
});

function bootstrapDeps() {
  const findSurface = vi.fn(async () => surface as AdminSurfaceRouteSurface | undefined);
  const bootstrapData = vi.fn(async () => ({ tile: "activity" }));
  const createBootstrap = vi.fn(({ surfaceId, data, nowMs }: { surfaceId: string; data: unknown; nowMs: number }) =>
    ({ surfaceId, data, expiresAt: nowMs + 60_000 }));
  return {
    workspaceId: WORKSPACE_ID, findSurface, bootstrapData, createBootstrap,
    bootstrapHeaders: () => ({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }),
    nowMs: () => 50_000,
  };
}

it("bootstraps an admitted surface with an explicit no-store reply and exact caller context", async () => {
  const deps = bootstrapDeps();
  const authorize = vi.fn<JsonRouteAuthorize>().mockResolvedValue(undefined);
  expect(routes.bootstrap.method).toBe("post");
  expect(routes.bootstrap.path).toBe("/api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId/surfaces/:surfaceId/bootstrap");
  const parsed = await routes.bootstrap.parse(raw(params));
  if (!parsed.ok) throw new Error("expected bootstrap to parse");
  const result = await routes.bootstrap.handle({ input: parsed.value, deps, authorize, context: PRINCIPAL });
  expect(result).toStrictEqual({ ok: true, value: {
    status: 200, body: { surfaceId: "report", data: { tile: "activity" }, expiresAt: 110_000 },
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  } });
  expect(result.ok && isRouteReply(result.value)).toBe(true);
  expect(authorize.mock.calls).toEqual([[{ permission: "admin.plugins.enable" }]]);
  expect(deps.findSurface.mock.calls).toEqual([[lookup]]);
  expect(deps.bootstrapData.mock.calls).toEqual([[{ context }]]);
  expect(deps.createBootstrap.mock.calls).toEqual([[{ surfaceId: "report", data: { tile: "activity" }, nowMs: 50_000 }]]);
});

it("fails a bootstrap without an authorizer before looking up the surface", async () => {
  const deps = bootstrapDeps();
  const parsed = await routes.bootstrap.parse(raw(params));
  if (!parsed.ok) throw new Error("expected bootstrap to parse");
  await expect(routes.bootstrap.handle({ input: parsed.value, deps, context: PRINCIPAL }))
    .rejects.toThrow(new Error("agent-plugins admin route has no authorizer"));
  expect(deps.findSurface).not.toHaveBeenCalled();
  expect(deps.bootstrapData).not.toHaveBeenCalled();
});

it("does not look up a surface when the host refuses write permission", async () => {
  const deps = bootstrapDeps();
  const denial = new RouteRefusalError({ status: 403, body: { code: "FORBIDDEN", error: "Enable permission required" } });
  const authorize = vi.fn<JsonRouteAuthorize>().mockRejectedValue(denial);
  const parsed = await routes.bootstrap.parse(raw(params));
  if (!parsed.ok) throw new Error("expected bootstrap to parse");
  await expect(routes.bootstrap.handle({ input: parsed.value, deps, authorize, context: PRINCIPAL })).rejects.toBe(denial);
  expect(authorize.mock.calls).toEqual([[{ permission: "admin.plugins.enable" }]]);
  expect(deps.findSurface).not.toHaveBeenCalled();
});

it("refuses to bootstrap a surface that is not admitted", async () => {
  const deps = bootstrapDeps();
  deps.findSurface.mockResolvedValueOnce(undefined);
  const parsed = await routes.bootstrap.parse(raw({ ...params, surfaceId: "missing" }));
  if (!parsed.ok) throw new Error("expected bootstrap to parse");
  expect(await refusalOf(() => routes.bootstrap.handle({ input: parsed.value, deps, context: PRINCIPAL, authorize: async () => {} })))
    .toStrictEqual({ status: 404, body: { error: "admin surface was not found", code: "ADMIN_SURFACE_NOT_FOUND" } });
  expect(deps.findSurface.mock.calls).toEqual([[{ ...lookup, surfaceId: "missing" }]]);
  expect(deps.bootstrapData).not.toHaveBeenCalled();
});

function actionDeps() {
  const dispatch = vi.fn(async () => ({ queued: true }));
  const dispatcherFor = vi.fn(() => ({ dispatch }));
  const withSignIns = vi.fn(async ({ run }: { run: () => Promise<{ queued: boolean }> }) =>
    ({ outcome: await run(), hostSignIns: [{ url: "https://login.example.test/verify" }] }));
  const findSurface = vi.fn(async () => surface);
  return { workspaceId: WORKSPACE_ID, findSurface, dispatcherFor, withSignIns, dispatch };
}

it("requires a string action before constructing a dispatcher", async () => {
  const deps = actionDeps();
  const parsed = await routes.action.parse(raw(params, { action: 42 }));
  if (!parsed.ok) throw new Error("expected action input to parse");
  expect(await refusalOf(() => routes.action.handle({ input: parsed.value, deps, context: PRINCIPAL, authorize: async () => {} })))
    .toStrictEqual({ status: 400, body: { error: "the request must name an action", code: "INVALID_REQUEST" } });
  expect(deps.findSurface.mock.calls).toEqual([[lookup]]);
  expect(deps.dispatcherFor).not.toHaveBeenCalled();
  expect(deps.withSignIns).not.toHaveBeenCalled();
});

it("dispatches a named action for the admitted surface and returns the host's sign-in links without caching", async () => {
  const deps = actionDeps();
  const authorize = vi.fn<JsonRouteAuthorize>().mockResolvedValue(undefined);
  expect(routes.action.method).toBe("post");
  expect(routes.action.path).toBe("/api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId/surfaces/:surfaceId/actions");
  const parsed = await routes.action.parse(raw(params, { action: "run", payload: { report: "quarterly" } }));
  if (!parsed.ok) throw new Error("expected action input to parse");
  const result = await routes.action.handle({ input: parsed.value, deps, context: PRINCIPAL, authorize });
  expect(result).toStrictEqual({ ok: true, value: { status: 200, headers: { "Cache-Control": "no-store" },
    body: { outcome: { queued: true }, hostSignIns: [{ url: "https://login.example.test/verify" }] },
  } });
  expect(result.ok && isRouteReply(result.value)).toBe(true);
  expect(authorize.mock.calls).toEqual([[{ permission: "admin.plugins.enable" }]]);
  expect(deps.dispatcherFor.mock.calls).toEqual([[{ surface }]]);
  expect(deps.dispatch.mock.calls).toEqual([[{ action: "run", payload: { report: "quarterly" }, context }]]);
});
