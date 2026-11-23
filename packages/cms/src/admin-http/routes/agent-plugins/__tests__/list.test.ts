import { describe, expect, it } from "vitest";
import { agentPluginsListRoute } from "../list.js";
import { fakeCandidate, PRINCIPAL, raw, recordingAuthorize, signal, WORKSPACE_ID } from "./helpers.js";

/** @file GET the installed Agent Plugins: one row per candidate, connection status only where the host reported one. */

function deps(overrides: { statuses?: Map<string, unknown>; reads?: string[] } = {}) {
  const reads = overrides.reads ?? [];
  return {
    workspaceId: WORKSPACE_ID,
    loadCandidates: async () => { reads.push("candidates"); return [fakeCandidate(), fakeCandidate({ pluginId: "beta", maturity: "soon", providerPlugin: "acme", missingRequires: ["cap:z"], requiredBy: ["x"] })]; },
    loadConnectionStatuses: async () => { reads.push("statuses"); return overrides.statuses ?? new Map(); },
  };
}

describe("agentPluginsListRoute", () => {
  it("keeps the method, path and default status and takes no input", () => {
    expect(agentPluginsListRoute.method).toBe("get");
    expect(agentPluginsListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/agent-plugins");
    expect(agentPluginsListRoute.successStatus).toBeUndefined();
    expect(agentPluginsListRoute.maxBodyBytes).toBeUndefined();
    expect(agentPluginsListRoute.parse(raw({ pluginId: "ignored" }))).toEqual({ ok: true, value: {} });
  });

  it("authorizes admin.plugins.read id-free, naming no entity type the RBAC grant could be scoped to", async () => {
    const { authorize, calls } = recordingAuthorize();
    await agentPluginsListRoute.handle({ input: {}, deps: deps(), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.plugins.read", entityType: "" }]);
  });

  it("re-shapes each candidate: nulls for missing display metadata, lifecycle fields, connection status only when reported", async () => {
    const { authorize } = recordingAuthorize();
    const result = await agentPluginsListRoute.handle({ input: {}, deps: deps({ statuses: new Map([["beta", { state: "connected" }]]) }), context: PRINCIPAL, authorize });
    expect(result).toEqual({ ok: true, value: { agentPlugins: [
      { pluginId: "acme", displayName: "Acme", summary: null, version: "1.0.0", description: null, id: "acme@1", provides: ["cap:a"], keywords: ["k"], enabled: false,
        origin: "installed", hostOk: true, missingRequires: [], requiredBy: [], archiveDigest: "sha256:x", skills: [{ name: "s" }], mcpServerIds: ["m"] },
      { pluginId: "beta", displayName: "Acme", summary: null, version: "1.0.0", description: null, id: "acme@1", provides: ["cap:a"], keywords: ["k"], enabled: false,
        connectionStatus: { state: "connected" }, maturity: "soon", providerPlugin: "acme",
        origin: "installed", hostOk: true, missingRequires: ["cap:z"], requiredBy: ["x"], archiveDigest: "sha256:x", skills: [{ name: "s" }], mcpServerIds: ["m"] },
    ] } });
    if (result.ok) expect(Object.keys(result.value.agentPlugins[0]!)).not.toContain("connectionStatus");
  });

  it("reads nothing when authorization refuses", async () => {
    const reads: string[] = [];
    const { authorize } = recordingAuthorize(["admin.plugins.read"]);
    await expect(agentPluginsListRoute.handle({ input: {}, deps: deps({ reads }), context: PRINCIPAL, authorize })).rejects.toThrow("denied admin.plugins.read");
    expect(reads).toEqual([]);
  });

  it("rethrows a read-model failure unchanged, so the host's error port answers the 500", async () => {
    const { authorize } = recordingAuthorize();
    const failing = { ...deps(), loadConnectionStatuses: async () => { throw new Error("private store details"); } };
    await expect(agentPluginsListRoute.handle({ input: {}, deps: failing, context: PRINCIPAL, authorize })).rejects.toThrow("private store details");
  });

  it("fails closed when the host mounted it without an authorizer", async () => {
    await expect(agentPluginsListRoute.handle({ input: {}, deps: deps(), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
