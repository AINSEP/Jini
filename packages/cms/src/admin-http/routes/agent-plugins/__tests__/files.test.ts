import { describe, expect, it } from "vitest";
import { agentPluginFilesRoute } from "../files.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file GET one installed Agent Plugin's package files: the id must match an installed manifest id; first record per id wins. */

const LIMITS = { maxFiles: 7 };

function deps(log: unknown[] = [], packages = [{ pluginId: "acme", packageRoot: "/pkgs/acme/new" }, { pluginId: "acme", packageRoot: "/pkgs/acme/old" }]) {
  return {
    workspaceId: WORKSPACE_ID,
    agentPluginLayout: { forWorkspace: ({ workspaceId }: { workspaceId: string }) => { log.push(["layout", workspaceId]); return { root: `/sites/${workspaceId}`, pluginPackagesDir: ({ pluginId }: { pluginId: string }) => `/sites/${workspaceId}/packages/${pluginId}` }; } },
    listPluginPackages: async ({ workspaceRoot }: { workspaceRoot: string }) => { log.push(["list", workspaceRoot]); return packages; },
    readPluginPackageFiles: async ({ input }: { input: { rootDir: string; containerDir: string } }) => { log.push(["read", input]); return { files: [{ path: "plugin.json" }], truncated: false }; },
    packageFileLimits: LIMITS,
  };
}

describe("agentPluginFilesRoute", () => {
  it("keeps the method and path and reads :pluginId, falling back to an empty id", () => {
    expect(agentPluginFilesRoute.method).toBe("get");
    expect(agentPluginFilesRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId/files");
    expect(agentPluginFilesRoute.successStatus).toBeUndefined();
    expect(agentPluginFilesRoute.maxBodyBytes).toBeUndefined();
    expect(agentPluginFilesRoute.parse(raw({ pluginId: "acme" }))).toEqual({ ok: true, value: { pluginId: "acme" } });
    expect(agentPluginFilesRoute.parse(raw({}))).toEqual({ ok: true, value: { pluginId: "" } });
  });

  it("authorizes admin.plugins.read id-free and reads the FIRST package for the id inside its own packages dir", async () => {
    const log: unknown[] = [];
    const { authorize, calls } = recordingAuthorize();
    const result = await agentPluginFilesRoute.handle({ input: { pluginId: "acme" }, deps: deps(log), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.plugins.read", entityType: "" }]);
    expect(log).toEqual([["layout", WORKSPACE_ID], ["list", `/sites/${WORKSPACE_ID}`], ["read", { rootDir: "/pkgs/acme/new", containerDir: `/sites/${WORKSPACE_ID}/packages/acme` }]]);
    expect(result).toEqual({ ok: true, value: { pluginId: "acme", files: [{ path: "plugin.json" }], truncated: false, limits: LIMITS } });
  });

  it("refuses an id that is not an installed manifest id with 404 and never reads files", async () => {
    const log: unknown[] = [];
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => agentPluginFilesRoute.handle({ input: { pluginId: "../acme" }, deps: deps(log), context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "agent plugin was not found", code: "AGENT_PLUGIN_NOT_FOUND" },
    });
    expect(log.some((entry) => (entry as unknown[])[0] === "read")).toBe(false);
  });

  it("does not touch the layout when authorization refuses", async () => {
    const log: unknown[] = [];
    const { authorize } = recordingAuthorize(["admin.plugins.read"]);
    await expect(agentPluginFilesRoute.handle({ input: { pluginId: "acme" }, deps: deps(log), context: PRINCIPAL, authorize })).rejects.toThrow("denied admin.plugins.read");
    expect(log).toEqual([]);
  });

  it("rethrows a reader failure unchanged (its message names server paths), so the host answers a redacted 500", async () => {
    const { authorize } = recordingAuthorize();
    const failing = { ...deps(), readPluginPackageFiles: async () => { throw new Error("escapes /srv/private"); } };
    await expect(agentPluginFilesRoute.handle({ input: { pluginId: "acme" }, deps: failing, context: PRINCIPAL, authorize })).rejects.toThrow("escapes /srv/private");
  });

  it("fails closed when the host mounted it without an authorizer", async () => {
    await expect(agentPluginFilesRoute.handle({ input: { pluginId: "acme" }, deps: deps(), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
