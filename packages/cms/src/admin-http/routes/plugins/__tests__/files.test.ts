import { describe, expect, it } from "vitest";
import { pluginFilesRoute, type PluginFilesRouteDeps } from "../files.js";
import { FakeUnsafePathError, PRINCIPAL, raw, RECORDS, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const LIMITS = { maxFiles: 3 };
function deps(overrides: Partial<PluginFilesRouteDeps> = {}): PluginFilesRouteDeps {
  return {
    workspaceId: WORKSPACE_ID, discoverPlugins: async () => RECORDS,
    readPluginPackageFiles: async (record) => ({ files: [{ path: `${record.id}/plugin.json` }], truncated: false }),
    packageFileLimits: LIMITS, unsafePathError: FakeUnsafePathError, ...overrides,
  };
}
const run = (d: PluginFilesRouteDeps, authorize = recordingAuthorize().authorize) => pluginFilesRoute.handle({ input: { pluginId: "word-count" }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("pluginFilesRoute", () => {
  it("keeps the method and path and reads :pluginId, falling back to an empty id", () => {
    expect(pluginFilesRoute.method).toBe("get");
    expect(pluginFilesRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/plugins/:pluginId/files");
    expect(pluginFilesRoute.maxBodyBytes).toBeUndefined();
    expect(pluginFilesRoute.parse(raw({ pluginId: "word-count" }))).toEqual({ ok: true, value: { pluginId: "word-count" } });
    expect(pluginFilesRoute.parse(raw({}))).toEqual({ ok: true, value: { pluginId: "" } });
  });

  it("authorizes admin.plugins.read, lists the discovered record's files and echoes the injected limits", async () => {
    const { authorize, calls } = recordingAuthorize();
    expect(await run(deps(), authorize)).toEqual({ ok: true, value: { pluginId: "word-count", source: "site", files: [{ path: "word-count/plugin.json" }], truncated: false, limits: LIMITS } });
    expect(calls).toEqual([{ permission: "admin.plugins.read", entityType: "plugin" }]);
  });

  it("answers 404 PLUGIN_NOT_FOUND for an id discovery does not report, without reading any files", async () => {
    let reads = 0;
    const d = deps({ readPluginPackageFiles: async () => { reads += 1; return { files: [], truncated: false }; } });
    expect(await refusalOf(() => pluginFilesRoute.handle({ input: { pluginId: "ghost" }, deps: d, context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({ status: 404, body: { error: "plugin was not found", code: "PLUGIN_NOT_FOUND" } });
    expect(reads).toBe(0);
  });

  it("replaces the unsafe-path error's message (it names server paths) with fixed text, and rethrows anything else", async () => {
    expect(await refusalOf(() => run(deps({ readPluginPackageFiles: async () => { throw new FakeUnsafePathError("/srv/plugins/../x"); } })))).toEqual({
      status: 400, body: { error: "plugin id or version is not a safe path", code: "PLUGIN_ID_INVALID" },
    });
    await expect(run(deps({ readPluginPackageFiles: async () => { throw new Error("EACCES"); } }))).rejects.toThrow("EACCES");
  });

  it("does not discover when authorization refuses", async () => {
    let discovered = 0;
    await expect(run(deps({ discoverPlugins: async () => { discovered += 1; return RECORDS; } }), recordingAuthorize(["admin.plugins.read"]).authorize)).rejects.toThrow("denied");
    expect(discovered).toBe(0);
  });
});
