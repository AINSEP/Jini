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
