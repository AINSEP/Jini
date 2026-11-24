import { describe, expect, it } from "vitest";
import { externalMcpToolApprovalRevokeRoute, externalMcpToolApprovalsListRoute } from "../tool-approvals.js";
import { PERMISSION_CALL, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const row = (serverId: string, toolName: string) => ({ workspaceId: WORKSPACE_ID, serverId, toolName, grantedByPrincipalId: "p", grantedAt: "2026-09-28T00:00:00.000Z", fingerprint: "secret-hash" });
/** Per-route ports over one recording fake store: each route gets only its own port. */
function store(removed = true) {
  const asked: unknown[] = [];
  return {
    asked,
    listApprovals: async (input: { workspaceId: string }) => { asked.push(input); return [row("b", "z"), row("a", "y"), row("b", "a")]; },
    revokeApproval: async (input: { workspaceId: string; serverId: string; toolName: string }) => { asked.push(input); return removed; },
  };
}
const list = (repo: ReturnType<typeof store>, authorize = recordingAuthorize().authorize) =>
  externalMcpToolApprovalsListRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, listApprovals: repo.listApprovals }, context: PRINCIPAL, authorize }, { signal });
const revoke = (repo: ReturnType<typeof store>, authorize = recordingAuthorize().authorize) =>
  externalMcpToolApprovalRevokeRoute.handle({ input: { serverId: "s1", toolName: "t1" }, deps: { workspaceId: WORKSPACE_ID, revokeApproval: repo.revokeApproval }, context: PRINCIPAL, authorize }, { signal });

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

  it("lists sorted by server then tool, asking the list port with an object arg, and sends only the four DTO fields", async () => {
    const repo = store();
    const { authorize, calls } = recordingAuthorize();
    const result = await list(repo, authorize);
    expect(calls).toEqual([PERMISSION_CALL]);
    expect(repo.asked).toEqual([{ workspaceId: WORKSPACE_ID }]);
    const pick = (serverId: string, toolName: string) => ({ serverId, toolName, grantedByPrincipalId: "p", grantedAt: "2026-09-28T00:00:00.000Z" });
    expect(result).toEqual({ ok: true, value: { approvals: [pick("a", "y"), pick("b", "a"), pick("b", "z")] } });
  });

  it("an empty list port lists empty", async () => {
    expect(await externalMcpToolApprovalsListRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, listApprovals: async () => [] }, context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal }))
      .toEqual({ ok: true, value: { approvals: [] } });
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
