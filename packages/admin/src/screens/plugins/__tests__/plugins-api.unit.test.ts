import { describe, expect, it, vi } from "vitest";
import type { AdminPluginDto } from "@jini-ai/core/contracts/site/cms-plugins";
import { createPluginsApi, type PluginsRequestFn } from "../api/plugins-api.js";

/** The plugins list client: it returns Core's full row and absorbs a server that predates `conflicts`. */

const ROW: AdminPluginDto = {
  id: "seo", name: "SEO", version: "1.0.0", source: "site", tier: "tier-3", status: "valid", enabled: true,
  quarantine: null, errors: [], conflicts: [],
};

function apiAnswering(body: unknown) {
  const request = vi.fn(async () => body) as unknown as PluginsRequestFn;
  return { api: createPluginsApi({ request, workspaceId: "w1" }), request };
}

describe("createPluginsApi.listPlugins", () => {
  it("returns the rows exactly as a current server sends them", async () => {
    const conflict = { kind: "route", key: "/a", heldBy: "core", heldByName: "Core", heldKey: "/a" };
    const { api, request } = apiAnswering({ plugins: [{ ...ROW, conflicts: [conflict] }] });
    await expect(api.listPlugins()).resolves.toEqual({ plugins: [{ ...ROW, conflicts: [conflict] }] });
    expect(request).toHaveBeenCalledWith({ path: "/workspaces/w1/plugins" });
  });

  it("fills an empty conflict list for a row from a server that predates the field", async () => {
    const { conflicts: _omitted, ...legacy } = ROW;
    const { api } = apiAnswering({ plugins: [legacy] });
    const { plugins } = await api.listPlugins();
    expect(plugins[0]?.conflicts).toEqual([]);
  });
});

describe("createPluginsApi scoped requests", () => {
  const id = "catalog/provider #1";
  const root = "/workspaces/w1/plugins/catalog%2Fprovider%20%231";

  it("reads provider settings under the encoded plugin id and propagates request errors", async () => {
    const settings = { pluginId: id, fields: [{ name: "host", value: "west" }] };
    const { api, request } = apiAnswering(settings);
    await expect(api.getPluginProviderSettings({ pluginId: id })).resolves.toEqual(settings);
    expect(request).toHaveBeenCalledExactlyOnceWith({ path: `${root}/provider-settings` });
    const missing = new Error("Provider settings not found");
    const refused = createPluginsApi({ workspaceId: "w1", request: async () => { throw missing; } });
    await expect(refused.getPluginProviderSettings({ pluginId: id })).rejects.toBe(missing);
  });

  it("PUTs settings exactly, including blank secret values the server interprets as keep", async () => {
    const values = { host: "west", token: "" };
    const settings = { pluginId: id, usedByThisSite: true };
    const { api, request } = apiAnswering(settings);
    await expect(api.savePluginProviderSettings({ pluginId: id, values })).resolves.toEqual(settings);
    expect(request).toHaveBeenCalledExactlyOnceWith({ path: `${root}/provider-settings` }, { init: { method: "PUT", body: '{"values":{"host":"west","token":""}}' } });
  });

  it.each([false, true])("PATCHes activation with the requested enabled=%s", async (enabled) => {
    const result = { plugin: { id, enabled, version: "2.1.3", updatedAt: "2026-11-01T01:15:00Z" }, changeSetId: "changes-2" };
    const { api, request } = apiAnswering(result);
    await expect(api.setPluginEnabled({ pluginId: id, enabled })).resolves.toEqual(result);
    expect(request).toHaveBeenCalledExactlyOnceWith({ path: root }, { init: { method: "PATCH", body: `{"enabled":${enabled}}` } });
  });

  it("DELETEs only the requested plugin and returns its trash receipt", async () => {
    const receipt = { pluginId: id, trashed: true };
    const { api, request } = apiAnswering(receipt);
    await expect(api.uninstallPlugin({ pluginId: id })).resolves.toEqual(receipt);
    expect(request).toHaveBeenCalledExactlyOnceWith({ path: root }, { init: { method: "DELETE" } });
  });

  it("reads the files subresource without a mutation method", async () => {
    const listing = { pluginId: id, files: [{ relativePath: "plugin.json", text: "{}" }], truncated: false };
    const { api, request } = apiAnswering(listing);
    await expect(api.getPluginFiles({ pluginId: id })).resolves.toEqual(listing);
    expect(request).toHaveBeenCalledExactlyOnceWith({ path: `${root}/files` });
  });
});
