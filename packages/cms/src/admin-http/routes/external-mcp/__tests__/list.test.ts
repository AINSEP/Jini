import { describe, expect, it } from "vitest";
import { externalMcpListRoute, type ExternalMcpListRouteDeps } from "../list.js";
import { describeOwnershipFor, PERMISSION_CALL, PRINCIPAL, raw, recordingAuthorize, signal, WORKSPACE_ID } from "./helpers.js";

function deps(overrides: Partial<ExternalMcpListRouteDeps> = {}): ExternalMcpListRouteDeps & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked, workspaceId: WORKSPACE_ID, describeOwnership: describeOwnershipFor(["built-in"]),
    listServers: async (input) => { asked.push(input); return [{ serverId: "built-in", envNames: ["A"] }, { serverId: "mine", envNames: [] }]; },
    ...overrides,
  };
}

describe("externalMcpListRoute", () => {
  it("keeps the method, path and success status, with no body cap", () => {
    expect(externalMcpListRoute.method).toBe("get");
    expect(externalMcpListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/mcp-servers");
    expect(externalMcpListRoute.successStatus).toBeUndefined();
    expect(externalMcpListRoute.maxBodyBytes).toBeUndefined();
    expect(externalMcpListRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
  });

  it("authorizes the id-free integration permission, lists the workspace and tags ownership through the injected tagger", async () => {
    const d = deps();
    const { authorize, calls } = recordingAuthorize();
    const result = await externalMcpListRoute.handle({ input: {}, deps: d, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([PERMISSION_CALL]);
    expect(d.asked).toEqual([{ workspaceId: WORKSPACE_ID }]);
    expect(result).toEqual({ ok: true, value: { servers: [{ serverId: "built-in", envNames: ["A"], builtIn: true }, { serverId: "mine", envNames: [], builtIn: false }] } });
  });

  it("reads nothing when authorization refuses, fails closed without an authorizer, and rethrows a store failure", async () => {
    let reads = 0;
    const d = deps({ listServers: async () => { reads += 1; throw new Error("store down"); } });
    await expect(externalMcpListRoute.handle({ input: {}, deps: d, context: PRINCIPAL, authorize: recordingAuthorize(["admin.integrations.manage"]).authorize })).rejects.toThrow("denied");
    await expect(externalMcpListRoute.handle({ input: {}, deps: d, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(reads).toBe(0);
    await expect(externalMcpListRoute.handle({ input: {}, deps: d, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("store down");
  });
});
