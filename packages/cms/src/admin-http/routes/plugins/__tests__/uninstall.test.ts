import { describe, expect, it } from "vitest";
import { pluginUninstallRoute, type PluginUninstallRouteDeps } from "../uninstall.js";
import { FakeEnabledError, FakeInTrashError, FakeNotFoundError, FakeNotUninstallableError, FakeUnsafePathError, PRINCIPAL, raw, RECORDS, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

function deps(overrides: Partial<PluginUninstallRouteDeps> = {}) {
  const asked: unknown[] = [];
  const value: PluginUninstallRouteDeps = {
    workspaceId: WORKSPACE_ID, clock: { nowMs: () => Date.parse("2026-11-23T00:00:00.000Z") },
    discoverPlugins: async () => RECORDS,
    uninstallPlugin: async (input) => { asked.push(input); return { trashed: { id: "t1" } }; },
    uninstallErrors: { notFound: FakeNotFoundError, notUninstallable: FakeNotUninstallableError, enabled: FakeEnabledError, alreadyInTrash: FakeInTrashError, unsafePath: FakeUnsafePathError },
    ...overrides,
  };
  return { value, asked };
}
const run = (d: PluginUninstallRouteDeps, authorize = recordingAuthorize().authorize) => pluginUninstallRoute.handle({ input: { pluginId: "word-count" }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("pluginUninstallRoute", () => {
  it("keeps the method and path and reads :pluginId, falling back to an empty id", () => {
    expect(pluginUninstallRoute.method).toBe("delete");
    expect(pluginUninstallRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/plugins/:pluginId");
    expect(pluginUninstallRoute.parse(raw({}))).toEqual({ ok: true, value: { pluginId: "" } });
  });

  it("authorizes admin.plugins.enable, uninstalls against a fresh discovery as the principal at the clock's time", async () => {
    const { authorize, calls } = recordingAuthorize();
    const { value, asked } = deps();
    expect(await run(value, authorize)).toEqual({ ok: true, value: { pluginId: "word-count", trashed: { id: "t1" } } });
    expect(calls).toEqual([{ permission: "admin.plugins.enable", entityType: "plugin" }]);
    expect(asked).toEqual([{ discovery: RECORDS, input: { pluginId: "word-count", workspaceId: WORKSPACE_ID, at: "2026-11-23T00:00:00.000Z", actor: { principalId: PRINCIPAL.id } } }]);
  });

  const ladder = [
    [new FakeNotFoundError("plugin 'x' was not found"), 404, "PLUGIN_NOT_FOUND"],
    [new FakeNotUninstallableError("built-in plugins cannot be uninstalled"), 422, "PLUGIN_NOT_UNINSTALLABLE"],
    [new FakeEnabledError("turn it off first"), 409, "PLUGIN_ENABLED"],
    [new FakeInTrashError("already in the Trash"), 409, "PLUGIN_IN_TRASH"],
    [new FakeUnsafePathError("bad id"), 400, "PLUGIN_ID_INVALID"],
  ] as const;
  for (const [error, status, code] of ladder) {
    it(`maps ${error.constructor.name} to ${status} ${code} with its own message`, async () => {
      expect(await refusalOf(() => run(deps({ uninstallPlugin: async () => { throw error; } }).value))).toEqual({ status, body: { error: error.message, code } });
    });
  }

  it("rethrows an unmapped error, and refuses before any side effect without a principal or permission", async () => {
    await expect(run(deps({ uninstallPlugin: async () => { throw new Error("rm failed"); } }).value)).rejects.toThrow("rm failed");
    const { value, asked } = deps();
    await expect(run(value, recordingAuthorize(["admin.plugins.enable"]).authorize)).rejects.toThrow("denied");
    await expect(pluginUninstallRoute.handle({ input: { pluginId: "word-count" }, deps: value, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
    expect(asked).toEqual([]);
  });
});
