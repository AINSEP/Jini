import { describe, expect, it } from "vitest";
import { pluginListRoute, type PluginListRouteDeps } from "../list.js";
import { activationRepo, pluginDto, PRINCIPAL, raw, RECORDS, recordingAuthorize, signal, WORKSPACE_ID } from "./helpers.js";

/** A name another plugin already holds (`PluginConflict`). */
const CONFLICT = { kind: "tool", key: "x", heldBy: "word-count", heldByName: "Word count", heldKey: "x" };

function deps(overrides: Partial<PluginListRouteDeps> = {}) {
  const repo = activationRepo({ "word-count": true });
  const value: PluginListRouteDeps = {
    workspaceId: WORKSPACE_ID, pluginActivationRepo: repo,
    discoverPlugins: async () => RECORDS,
    listPluginConflicts: async () => new Map([["seo", [CONFLICT]]]),
    toAdminPluginResponse: ({ discovery, activation }, optional = {}) => pluginDto({ id: discovery.id, enabled: activation?.enabled ?? false, ...(optional.conflicts ? { conflicts: optional.conflicts } : {}) }),
    localInstallAvailable: () => false,
    ...overrides,
  };
  return { value, repo };
}

describe("pluginListRoute", () => {
  it("keeps the method, path, default success status and no body cap; parse takes nothing", () => {
    expect(pluginListRoute.method).toBe("get");
    expect(pluginListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/plugins");
    expect(pluginListRoute.successStatus).toBeUndefined();
    expect(pluginListRoute.maxBodyBytes).toBeUndefined();
    expect(pluginListRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
  });

  it("authorizes admin.plugins.read with no entity id and projects each record with its activation and conflicts", async () => {
    const { authorize, calls } = recordingAuthorize();
    const result = await pluginListRoute.handle({ input: {}, deps: deps().value, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.plugins.read", entityType: "plugin" }]);
    expect(result).toEqual({ ok: true, value: {
      plugins: [pluginDto({ id: "word-count", enabled: true }), pluginDto({ id: "seo", enabled: false, conflicts: [CONFLICT] })],
      installSources: [],
    } });
  });

  it("offers folder and zip installs only when the host takes local installs", async () => {
    const result = await pluginListRoute.handle({ input: {}, deps: deps({ localInstallAvailable: () => true }).value, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(result).toMatchObject({ ok: true, value: { installSources: ["folder", "zip"] } });
  });

  it("does not discover or read activation when authorization refuses, and fails closed without an authorizer", async () => {
    let discovered = 0;
    const { value, repo } = deps({ discoverPlugins: async () => { discovered += 1; return RECORDS; } });
    await expect(pluginListRoute.handle({ input: {}, deps: value, context: PRINCIPAL, authorize: recordingAuthorize(["admin.plugins.read"]).authorize })).rejects.toThrow("denied");
    await expect(pluginListRoute.handle({ input: {}, deps: value, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(discovered).toBe(0);
    expect(repo.reads).toEqual([]);
  });

  it("rethrows a discovery failure unchanged for the host 500", async () => {
    const { value } = deps({ discoverPlugins: async () => { throw new Error("disk gone"); } });
    await expect(pluginListRoute.handle({ input: {}, deps: value, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("disk gone");
  });
});
