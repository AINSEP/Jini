import { describe, expect, it } from "vitest";
import { externalMcpToolApprovalRevokeRoute, externalMcpToolApprovalsListRoute, type ExternalMcpToolApprovalStore } from "../tool-approvals.js";
import { PERMISSION_CALL, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const row = (serverId: string, toolName: string) => ({ workspaceId: WORKSPACE_ID, serverId, toolName, grantedByPrincipalId: "p", grantedAt: "2026-09-28T00:00:00.000Z", fingerprint: "secret-hash" });
function store(removed = true): ExternalMcpToolApprovalStore & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    listByWorkspaceId: async (workspaceId) => { asked.push(workspaceId); return [row("b", "z"), row("a", "y"), row("b", "a")]; },
    delete: async (input) => { asked.push(input); return removed; },
  };
}
const list = (repo: ExternalMcpToolApprovalStore | undefined, authorize = recordingAuthorize().authorize) =>
  externalMcpToolApprovalsListRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, toolApprovalRepo: repo }, context: PRINCIPAL, authorize }, { signal });
const revoke = (repo: ExternalMcpToolApprovalStore | undefined, authorize = recordingAuthorize().authorize) =>
  externalMcpToolApprovalRevokeRoute.handle({ input: { serverId: "s1", toolName: "t1" }, deps: { workspaceId: WORKSPACE_ID, toolApprovalRepo: repo }, context: PRINCIPAL, authorize }, { signal });

describe("externalMcpToolApprovals routes", () => {
  it("keep their methods and paths and read both revoke params, falling back to empty strings", () => {
    expect(externalMcpToolApprovalsListRoute.method).toBe("get");
    expect(externalMcpToolApprovalsListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/mcp-servers/tool-approvals");
    expect(externalMcpToolApprovalRevokeRoute.method).toBe("delete");
    expect(externalMcpToolApprovalRevokeRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/mcp-servers/:serverId/tool-approvals/:toolName");
    expect(externalMcpToolApprovalsListRoute.maxBodyBytes).toBeUndefined();
    expect(externalMcpToolApprovalRevokeRoute.parse(raw({ serverId: "s", toolName: "t" }))).toEqual({ ok: true, value: { serverId: "s", toolName: "t" } });
    expect(externalMcpToolApprovalRevokeRoute.parse(raw({}))).toEqual({ ok: true, value: { serverId: "", toolName: "" } });
  });

  it("lists sorted by server then tool, without the fingerprint", async () => {
    const repo = store();
    const { authorize, calls } = recordingAuthorize();
    const result = await list(repo, authorize);
    expect(calls).toEqual([PERMISSION_CALL]);
    expect(repo.asked).toEqual([WORKSPACE_ID]);
    const pick = (serverId: string, toolName: string) => ({ serverId, toolName, grantedByPrincipalId: "p", grantedAt: "2026-09-28T00:00:00.000Z" });
    expect(result).toEqual({ ok: true, value: { approvals: [pick("a", "y"), pick("b", "a"), pick("b", "z")] } });
  });

  it("a composition with no store lists empty and 404s every revoke", async () => {
    expect(await list(undefined)).toEqual({ ok: true, value: { approvals: [] } });
    expect(await refusalOf(() => revoke(undefined))).toEqual({ status: 404, body: { error: "no Always allow is saved for that tool", code: "NOT_FOUND" } });
  });

  it("revokes the named workspace tool, and 404s when nothing was saved", async () => {
    const repo = store();
    expect(await revoke(repo)).toEqual({ ok: true, value: { removed: true } });
    expect(repo.asked).toEqual([{ workspaceId: WORKSPACE_ID, serverId: "s1", toolName: "t1" }]);
    expect(await refusalOf(() => revoke(store(false)))).toEqual({ status: 404, body: { error: "no Always allow is saved for that tool", code: "NOT_FOUND" } });
  });

  it("touches no store when authorization refuses", async () => {
    const repo = store();
    const deny = recordingAuthorize(["admin.integrations.manage"]).authorize;
    await expect(list(repo, deny)).rejects.toThrow("denied");
    await expect(revoke(repo, deny)).rejects.toThrow("denied");
    expect(repo.asked).toEqual([]);
  });
});
