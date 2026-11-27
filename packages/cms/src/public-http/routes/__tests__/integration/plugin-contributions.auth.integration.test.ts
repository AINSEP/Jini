import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Request, type Response } from 'express';
import { createPluginRouteAuthPorts, registerPluginContributionRoutes, requireActivatedPlugin } from '../../plugin-contributions.js';
import type { PluginContributionsSnapshot } from '@jini-ai/core/contracts/site/plugins-host';

it('does not advance to auth or body parsers for an inactive plugin', async () => {
  const json = vi.fn();
  const next = vi.fn();
  const response = { status: vi.fn(() => ({ json })), locals: {} } as unknown as Response;
  await requireActivatedPlugin({ workspaceId: 'w', pluginActivationRepo: { getActivation: async () => ({ enabled: false }) } }, { pluginId: 'plugin' } as PluginContributionsSnapshot)({} as Request, response, next);
  expect(response.status).toHaveBeenCalledWith(404);
  expect(json).toHaveBeenCalledWith({ code: 'NOT_FOUND' });
  expect(next).not.toHaveBeenCalled();
});

it("dispatches scoped admin, member and public requests through activation, auth and JSON parsing", async () => {
  const app = express();
  const activation = vi.fn(async ({ workspaceId, pluginId }: { workspaceId: string; pluginId: string }) =>
    workspaceId === "site" && pluginId === "catalog" ? { enabled: true } : null);
  const operatorError = new Error("operator service offline");
  const authorizationError = new Error("permissions offline");
  const memberError = new Error("member service offline");
  const review = vi.fn<Parameters<typeof createPluginRouteAuthPorts>[0]["deps"]["authorizeOrRespond"]>(async ({ res, params }) => {
    if (params.principalId === "broken") throw authorizationError;
    if (params.principalId === "editor" && params.entityId === "catalog" && params.workspaceId === "site"
        && params.entityType === "plugin" && params.permission === "admin.plugins.enable") return true;
    res.status(403).json({ code: "FORBIDDEN" });
    return false;
  });
  const auth = createPluginRouteAuthPorts({ deps: { workspaceId: "site", authorizeOrRespond: review,
    operatorSession: (req, res, next) => {
      const id = req.get("x-operator");
      if (id === "offline") { next(operatorError); return; }
      if (!id) { res.status(401).json({ code: "OPERATORS_ONLY" }); return; }
      res.locals.principal = { id };
      next();
    },
    activeMemberFromSession: async ({ request }) => {
      const token = request.get("x-member");
      if (token === "offline") throw memberError;
      return token === "valid" ? "member-41" : null;
    },
  } });
  type Route = PluginContributionsSnapshot["routes"][number];
  const admin = vi.fn<Route["handler"]>(({ auth, body, params, query }) => ({ status: 201, body: { auth, body, params, query } }));
  const member = vi.fn<Route["handler"]>(({ auth }) => ({ body: auth }));
  const snapshot: PluginContributionsSnapshot = {
    pluginId: "catalog", sdk: {} as PluginContributionsSnapshot["sdk"], tools: [], widgets: [],
    routes: [
      { method: "POST", path: "/admin/:id", access: "admin", handler: admin },
      { method: "GET", path: "/member", access: "member", handler: member },
      { method: "GET", path: "/empty", access: "public", handler: () => undefined },
      { method: "GET", path: "/null", access: "public", handler: () => ({}) },
    ],
  };
  let active: readonly PluginContributionsSnapshot[] = [snapshot];
  registerPluginContributionRoutes({ app, auth,
    deps: { workspaceId: "site", pluginActivationRepo: { getActivation: activation }, pluginContributions: { list: () => active } },
    kit: { Router: express.Router, parsers: [express.json()],
      respondToOversizedBody: (_error, _req, _res, next) => next(_error), onError: vi.fn() },
  });
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/p/catalog`;
    const get = (route: string, headers?: Record<string, string>) => fetch(origin + route, headers ? { headers } : {});
    const post = (body: string, headers: Record<string, string>) => fetch(origin + "/admin/a%20b?locale=fr", {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body,
    });
    const unauthenticated = await post("{", { "x-member": "valid" });
    expect([unauthenticated.status, await unauthenticated.json()]).toEqual([401, { code: "OPERATORS_ONLY" }]);
    const denied = await post("{", { "x-operator": "viewer" });
    expect([denied.status, await denied.json()]).toEqual([403, { code: "FORBIDDEN" }]);
    const malformed = await post("{", { "x-operator": "editor" });
    expect([malformed.status, await malformed.json()]).toEqual([400, { code: "INVALID_BODY" }]);
    expect(admin).not.toHaveBeenCalled();
    const accepted = await post('{"draft":true}', { "x-operator": "editor" });
    expect(accepted.status).toBe(201);
    expect(accepted.headers.get("cache-control")).toBe("no-store");
    expect(await accepted.json()).toEqual({
      auth: { access: "admin", workspaceId: "site", principalId: "editor" },
      body: { draft: true }, params: { id: "a b" }, query: { locale: "fr" },
    });

    const guest = await get("/member", { "x-operator": "editor" });
    expect([guest.status, await guest.json()]).toEqual([401, { code: "UNAUTHENTICATED" }]);
    expect(member).not.toHaveBeenCalled();
    const admitted = await get("/member", { "x-member": "valid" });
    expect([admitted.status, await admitted.json()]).toEqual([200, { access: "member", workspaceId: "site", principalId: "member-41" }]);
    for (const request of [get("/member", { "x-member": "offline" }),
      post("{}", { "x-operator": "offline" }), post("{}", { "x-operator": "broken" })]) {
      const failed = await request;
      expect([failed.status, await failed.json()]).toEqual([500, { code: "PLUGIN_ROUTE_FAILED" }]);
    }
    const noContent = await get("/empty", { "x-operator": "editor" });
    expect([noContent.status, noContent.headers.get("cache-control"), await noContent.text()]).toEqual([204, "no-store", ""]);
    const nullBody = await get("/null");
    expect([nullBody.status, await nullBody.json()]).toEqual([200, null]);
    active = [];
    const vanished = await get("/empty");
    expect([vanished.status, await vanished.json()]).toEqual([404, { code: "NOT_FOUND" }]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
