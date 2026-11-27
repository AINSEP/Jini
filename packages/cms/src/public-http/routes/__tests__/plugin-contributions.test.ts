import { expect, it, vi } from "vitest";
import { invokeLivePluginRoute } from "../plugin-contributions.js";
import type { PluginContributionsSnapshot } from "@jini-ai/core/contracts/site/plugins-host";

it("a plugin generation retired while its handler awaits cannot send its result", async () => {
  let complete: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { complete = resolve; });
  let live = true;
  const handler = vi.fn(async (_input: Parameters<PluginContributionsSnapshot["routes"][number]["handler"]>[0]) => { await pending; return { body: "retired" }; });
  const snapshot = { pluginId: "plugin", sdk: {} } as PluginContributionsSnapshot;
  const route = { access: "public", handler } as unknown as PluginContributionsSnapshot["routes"][number];
  const ports = { isActivated: async () => true, isLive: () => live, principalIdFor: vi.fn(() => "operator"), reportError: vi.fn() };
  const result = invokeLivePluginRoute({ workspaceId: "w", snapshot, route, input: { body: null, params: {}, query: {} }, ports });
  await Promise.resolve();
  expect(handler).toHaveBeenCalledTimes(1);
  live = false;
  complete?.();
  expect(await result).toEqual({ kind: "not-found", status: 404, body: { code: "NOT_FOUND" } });
  expect(ports.principalIdFor).not.toHaveBeenCalled();
  expect(handler.mock.calls[0]?.[0]?.auth).not.toHaveProperty("principalId");
});

it("refuses durable disable, retains false JSON and redacts failures", async () => {
  const snapshot = { pluginId: "plugin", sdk: {} } as PluginContributionsSnapshot;
  const handler = vi.fn(async () => ({ status: 201, body: false }));
  const route = { access: "public", handler } as unknown as PluginContributionsSnapshot["routes"][number];
  const ports = { isActivated: async () => false, isLive: () => true, principalIdFor: () => undefined, reportError: vi.fn() };
  const input = { workspaceId: "w", snapshot, route, input: { body: null, params: {}, query: {} }, ports };
  expect(await invokeLivePluginRoute(input)).toEqual({ kind: "not-found", status: 404, body: { code: "NOT_FOUND" } });
  expect(handler).not.toHaveBeenCalled();
  expect(await invokeLivePluginRoute({ ...input, ports: { ...ports, isActivated: async () => true } })).toEqual({ kind: "result", cacheControl: "no-store", response: "json", status: 201, body: false });
  handler.mockRejectedValueOnce(new Error("secret token"));
  expect(await invokeLivePluginRoute({ ...input, ports: { ...ports, isActivated: async () => true } })).toEqual({ kind: "failed", status: 500, body: { code: "PLUGIN_ROUTE_FAILED" } });
  expect(ports.reportError).toHaveBeenCalledTimes(1);
});

it("checks durable activation again after yielding to a member handler", async () => {
  const release: { handler?: () => void; entered?: () => void } = {};
  const entered = new Promise<void>(resolve => { release.entered = resolve; });
  const suspended = new Promise<void>(resolve => { release.handler = resolve; });
  const handler = vi.fn<PluginContributionsSnapshot["routes"][number]["handler"]>(async () => {
    release.entered!();
    await suspended;
    return { body: "stale result" };
  });
  const route = { access: "member", handler, method: "GET", path: "/read" } as const;
  const snapshot = { pluginId: "catalog", sdk: {} as PluginContributionsSnapshot["sdk"], routes: [route], tools: [], widgets: [] };
  let enabled = true;
  const ports = {
    isActivated: vi.fn(async ({ pluginId }: { pluginId: string }) => enabled && pluginId === "catalog"),
    isLive: ({ snapshot: current }: { snapshot: PluginContributionsSnapshot }) => current === snapshot,
    principalIdFor: vi.fn(() => "member-41"), reportError: vi.fn(),
  };
  const input = { body: null, params: { key: "p" }, query: { lang: "en" } };
  const result = invokeLivePluginRoute({ workspaceId: "w", snapshot, route, ports, input });
  // Ensure a regression that never enters the handler fails without hanging.
  await Promise.race([entered, result]);
  enabled = false;
  release.handler!();
  expect(await result).toEqual({ kind: "not-found", status: 404, body: { code: "NOT_FOUND" } });
  expect(handler).toHaveBeenCalledExactlyOnceWith({ ...input, sdk: snapshot.sdk, pluginId: "catalog",
    auth: { access: "member", workspaceId: "w", principalId: "member-41" } }, {});
  expect(ports.isActivated.mock.calls).toEqual([[{ pluginId: "catalog" }], [{ pluginId: "catalog" }]]);
  expect(ports.principalIdFor).toHaveBeenCalledExactlyOnceWith({ access: "member" });
});
