import { describe, expect, it } from "vitest";
import { externalMcpDeleteRoute, type ExternalMcpDeleteRouteDeps } from "../delete.js";
import { PERMISSION_CALL, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

function deps(removed: boolean | Error = true): ExternalMcpDeleteRouteDeps & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked, workspaceId: WORKSPACE_ID, isBuiltInServer: (serverId) => serverId === "built-in",
    deleteServer: async (input) => { asked.push(input); if (removed instanceof Error) throw removed; return removed; },
  };
}
const call = (d: ExternalMcpDeleteRouteDeps, serverId = "s1", authorize = recordingAuthorize().authorize) =>
  externalMcpDeleteRoute.handle({ input: { serverId }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("externalMcpDeleteRoute", () => {
  it("keeps the method and path and reads :serverId, falling back to an empty id", () => {
    expect(externalMcpDeleteRoute.method).toBe("delete");
    expect(externalMcpDeleteRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/mcp-servers/:serverId");
    expect(externalMcpDeleteRoute.maxBodyBytes).toBeUndefined();
    expect(externalMcpDeleteRoute.parse(raw({ serverId: "s1" }))).toEqual({ ok: true, value: { serverId: "s1" } });
    expect(externalMcpDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { serverId: "" } });
  });

  it("authorizes without an entity id, deletes the workspace row and reports restartRequired", async () => {
    const d = deps();
    const { authorize, calls } = recordingAuthorize();
    expect(await call(d, "s1", authorize)).toEqual({ ok: true, value: { removed: true, restartRequired: true } });
    expect(calls).toEqual([PERMISSION_CALL]);
    expect(d.asked).toEqual([{ workspaceId: WORKSPACE_ID, serverId: "s1" }]);
  });

  it("refuses a built-in connection with 409 before touching the store", async () => {
    const d = deps();
    expect(await refusalOf(() => call(d, "built-in"))).toEqual({ status: 409, body: { error: "built-in MCP connections cannot be removed", code: "BUILT_IN_CONNECTION" } });
    expect(d.asked).toEqual([]);
  });

  it("answers 404 NOT_FOUND when no row was removed, rather than a silent success", async () => {
    expect(await refusalOf(() => call(deps(false)))).toEqual({ status: 404, body: { error: "external MCP server was not found", code: "NOT_FOUND" } });
  });

  it("does not delete when authorization refuses, and rethrows a store failure", async () => {
    const d = deps();
    await expect(call(d, "s1", recordingAuthorize(["admin.integrations.manage"]).authorize)).rejects.toThrow("denied");
    expect(d.asked).toEqual([]);
    await expect(call(deps(new Error("db down")))).rejects.toThrow("db down");
  });
});
