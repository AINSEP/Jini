import { describe, expect, it, vi } from "vitest";
import { registerPluginInstallRoutes } from "../plugins/install.js";

describe("plugin install mount matrix", () => {
  it("keeps ZIP parsing behind authorization in both raw routes", async () => {
    const json: Parameters<Parameters<typeof registerPluginInstallRoutes>[0]["mountJson"]>[0][] = [];
    const raw: Parameters<Parameters<typeof registerPluginInstallRoutes>[0]["mountRaw"]>[0][] = [];
    registerPluginInstallRoutes({ mountJson: entry => { json.push(entry); }, mountRaw: entry => { raw.push(entry); }, installer: vi.fn(), onInstalled: vi.fn(), onFailure: vi.fn(), installError: Error, operation: "host/install", maxArchiveBytes: 1024, uploadLimitText: "too large" });
    expect([...json, ...raw].map(entry => entry.spec.path)).toEqual([
      "/api/admin/v1/workspaces/:workspaceId/plugins/install/preview", "/api/admin/v1/workspaces/:workspaceId/plugins/install", "/api/admin/v1/workspaces/:workspaceId/plugins/install/zip/preview", "/api/admin/v1/workspaces/:workspaceId/plugins/install/zip",
    ]);
    for (const entry of raw) {
      const parseZip = vi.fn();
      const deps = entry.requestDeps({ isZip: () => true, parseZip, body: vi.fn(), isBuffer: Buffer.isBuffer });
      await expect(entry.spec.handle({ raw: { body: undefined, query: {}, params: {}, headers: {} }, deps, context: { id: "owner" }, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
      expect(parseZip).not.toHaveBeenCalled();
      expect(entry.parser).toEqual({ type: "application/zip", limit: 1024, inflate: false });
    }
  });
});
