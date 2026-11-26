import { describe, expect, it, vi } from "vitest";
import { registerPluginInstallRoutes } from "../plugins/install.js";

describe("plugin install mount matrix", () => {
  it("keeps ZIP parsing behind authorization in both raw routes", async () => {
    const json: { spec: { path: string } }[] = [];
    class PluginInstallError extends Error { readonly code = "PLUGIN_INSTALL_REFUSED"; }
    const parserFactory = vi.fn((config: { type: "application/zip"; limit: number; inflate: false }) => config);
    const raw: Parameters<Parameters<typeof registerPluginInstallRoutes>[0]["mountRaw"]>[0][] = [];
    registerPluginInstallRoutes({ mountJson: entry => { json.push(entry); }, mountRaw: entry => { raw.push(entry); }, parserFactory, installer: vi.fn(), onInstalled: vi.fn(), onFailure: vi.fn(), installError: PluginInstallError, operation: "host/install", maxArchiveBytes: 1024, uploadLimitText: "too large" });
    expect([...json, ...raw].map(entry => entry.spec.path)).toEqual([
      "/api/admin/v1/workspaces/:workspaceId/plugins/install/preview", "/api/admin/v1/workspaces/:workspaceId/plugins/install", "/api/admin/v1/workspaces/:workspaceId/plugins/install/zip/preview", "/api/admin/v1/workspaces/:workspaceId/plugins/install/zip",
    ]);
    for (const entry of raw) {
      const parseZip = vi.fn();
      const deps = entry.requestDeps({ isZip: () => true, parseZip, body: vi.fn(), isBuffer: Buffer.isBuffer });
      await expect(entry.spec.handle({ raw: { body: undefined, query: {}, params: {}, headers: {} }, deps, context: { id: "owner" }, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
      expect(parseZip).not.toHaveBeenCalled();
    }
    expect(parserFactory).toHaveBeenCalledTimes(1);
    expect(parserFactory).toHaveBeenCalledWith({ type: "application/zip", limit: 1024, inflate: false });
  });
});
