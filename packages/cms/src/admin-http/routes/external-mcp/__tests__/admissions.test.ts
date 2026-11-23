import { describe, expect, it } from "vitest";
import { externalMcpAdmissionsRoute, type ExternalMcpAdmissionsResult } from "../admissions.js";
import { PERMISSION_CALL, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const run = (result: ExternalMcpAdmissionsResult | Error, authorize = recordingAuthorize().authorize) => {
  let reads = 0;
  const readAdmissions = async () => { reads += 1; if (result instanceof Error) throw result; return result; };
  return { reads: () => reads, call: () => externalMcpAdmissionsRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, readAdmissions }, context: PRINCIPAL, authorize }, { signal }) };
};

describe("externalMcpAdmissionsRoute", () => {
  it("keeps the method and fixed-suffix path", () => {
    expect(externalMcpAdmissionsRoute.method).toBe("get");
    expect(externalMcpAdmissionsRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/mcp-servers/admissions");
    expect(externalMcpAdmissionsRoute.successStatus).toBeUndefined();
    expect(externalMcpAdmissionsRoute.maxBodyBytes).toBeUndefined();
    expect(externalMcpAdmissionsRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
  });

  it("answers connections only, or connections plus configFailures when the reader reports them", async () => {
    const { authorize, calls } = recordingAuthorize();
    expect(await run({ ok: true, connections: [{ serverId: "a" }] }, authorize).call()).toEqual({ ok: true, value: { connections: [{ serverId: "a" }] } });
    expect(calls).toEqual([PERMISSION_CALL]);
    expect(await run({ ok: true, connections: [], configFailures: [{ serverId: "b" }] }).call()).toEqual({ ok: true, value: { connections: [], configFailures: [{ serverId: "b" }] } });
  });

  it("answers an unavailable reader as a 503 carrying the reader's own body verbatim, never an empty roster", async () => {
    const body = { error: "the server's external MCP admissions are unavailable — try again shortly", code: "AGENT_DAEMON_UNAVAILABLE" };
    expect(await refusalOf(() => run({ ok: false, body }).call())).toEqual({ status: 503, body });
  });

  it("does not read when authorization refuses, and rethrows a reader failure", async () => {
    const denied = run({ ok: true, connections: [] }, recordingAuthorize(["admin.integrations.manage"]).authorize);
    await expect(denied.call()).rejects.toThrow("denied");
    expect(denied.reads()).toBe(0);
    await expect(run(new Error("boom")).call()).rejects.toThrow("boom");
  });
});
