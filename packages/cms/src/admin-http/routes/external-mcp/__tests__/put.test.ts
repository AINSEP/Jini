import { ToolInputError } from "@jini-ai/core";
import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { describe, expect, it } from "vitest";
import { externalMcpPutRoute, type ExternalMcpPutRouteDeps } from "../put.js";
import { parseExternalMcpPutBody } from "../put-body.js";
import {
  describeOwnershipFor, FakeLoweringError, FakeSecretStoreError, FakeValidationError, instanceOf, isSecretStoreUnconfiguredError, isValidationError,
  PERMISSION_CALL, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID,
} from "./helpers.js";

function deps(saved: { serverId: string; enabled: boolean } | Error = { serverId: "s1", enabled: true }) {
  const saves: unknown[] = [];
  const notices: unknown[] = [];
  const d: ExternalMcpPutRouteDeps = {
    workspaceId: WORKSPACE_ID,
    saveServer: async (input) => { saves.push(input); if (saved instanceof Error) throw saved; return saved; },
    notifyRosterChanged: async (...args) => { notices.push(args); },
    describeOwnership: describeOwnershipFor(["s1"]),
    isToolAccessLoweringError: instanceOf({ ErrorClass: FakeLoweringError }),
    isValidationError, isSecretStoreUnconfiguredError,
  };
  return { d, saves, notices };
}
const call = (d: ExternalMcpPutRouteDeps, body: unknown = {}, authorize = recordingAuthorize().authorize) =>
  externalMcpPutRoute.handle({ input: { serverId: "s1", body }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("externalMcpPutRoute", () => {
  it("keeps the method and path, reads :serverId with the empty fallback, and leaves the body for after authorization", () => {
    expect(externalMcpPutRoute.method).toBe("put");
    expect(externalMcpPutRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/mcp-servers/:serverId");
    expect(externalMcpPutRoute.maxBodyBytes).toBeUndefined();
    expect(externalMcpPutRoute.parse(raw({ serverId: "s1" }, { expectedVersion: "bad" }))).toEqual({ ok: true, value: { serverId: "s1", body: { expectedVersion: "bad" } } });
    expect(externalMcpPutRoute.parse(raw({}))).toEqual({ ok: true, value: { serverId: "", body: {} } });
  });

  it("defaults the plain fields and keeps the tri-state fields absent when not sent", () => {
    expect(parseExternalMcpPutBody({ rawBody: undefined })).toEqual({ transport: "stdio", enabled: true, command: "", args: "", allowedToolNames: "", writeAllowedToolNames: "" });
    expect(parseExternalMcpPutBody({ rawBody: { enabled: false, command: 1, writeAllowedToolNames: ["x"], oauth: [] } })).toEqual({ transport: "stdio", enabled: false, command: "", args: "", allowedToolNames: "", writeAllowedToolNames: "" });
    expect(parseExternalMcpPutBody({ rawBody: { oauth: { clientId: 3 } } })).not.toHaveProperty("oauth");
  });

  it("carries every sent string, including empty strings that clear, and the oauth block only with its sent members", () => {
    const body = {
      label: "L", transport: "http", enabled: true, command: "c", url: "", authMode: "oauth", args: "a", allowedToolNames: "t", writeAllowedToolNames: "w",
      env: "", accessToken: "tok", accessTokenEnvName: "TOK", expectedVersion: 3,
      oauth: { providerId: "p", grant: "g", clientId: "", clientSecret: "s", scopes: "x", tokenEnvName: "T", authorizationEndpoint: "a", tokenEndpoint: "t", deviceAuthorizationEndpoint: "d", extra: "dropped" },
    };
    const { extra: _extra, ...oauth } = body.oauth;
    expect(parseExternalMcpPutBody({ rawBody: body })).toEqual({ ...body, oauth });
  });

  it("authorizes, saves as the principal for the workspace, awaits nothing for an enabled row and tags ownership", async () => {
    const { d, saves, notices } = deps();
    const { authorize, calls } = recordingAuthorize();
    expect(await call(d, { command: "npx", expectedVersion: 2 }, authorize)).toEqual({ ok: true, value: { server: { serverId: "s1", enabled: true, builtIn: true }, restartRequired: true } });
    expect(calls).toEqual([PERMISSION_CALL]);
    expect(saves).toEqual([{ workspaceId: WORKSPACE_ID, serverId: "s1", principalId: PRINCIPAL.id, transport: "stdio", enabled: true, command: "npx", args: "", allowedToolNames: "", writeAllowedToolNames: "", expectedVersion: 2 }]);
    expect(notices).toEqual([[]]);
  });

  it("awaits the lowered roster change for a disabled row", async () => {
    const { d, notices } = deps({ serverId: "s2", enabled: false });
    expect(await call(d)).toEqual({ ok: true, value: { server: { serverId: "s2", enabled: false, builtIn: false }, restartRequired: true } });
    expect(notices).toEqual([[{ lowered: { serverIds: ["s2"] } }]]);
  });

  it("refuses a malformed expectedVersion as 400 VALIDATION_ERROR only after authorization, without saving", async () => {
    const { d, saves } = deps();
    expect(await refusalOf(() => call(d, { expectedVersion: -1 }))).toEqual({ status: 400, body: { error: "'expectedVersion' must be a non-negative integer when present", code: "VALIDATION_ERROR" } });
    await expect(call(d, { expectedVersion: -1 }, recordingAuthorize(["admin.integrations.manage"]).authorize)).rejects.toThrow("denied");
    expect(saves).toEqual([]);
  });

  const conflict = new RecordVersionConflictError({ recordKind: "MCP server", recordId: "s1", expectedVersion: 1, currentVersion: 2 });
  const cases: Array<[string, Error, number, unknown]> = [
    ["a lowering failure", new FakeLoweringError("lowering failed"), 503, { error: "lowering failed", code: "TOOL_ACCESS_LOWERING_FAILED" }],
    ["a version conflict", conflict, 409, { error: conflict.message, code: "VERSION_CONFLICT", details: { recordKind: "MCP server", recordId: "s1", expectedVersion: 1, currentVersion: 2 } }],
    ["a tool-input error", new ToolInputError({ message: "bad input" }), 400, { error: "bad input", code: "VALIDATION_ERROR" }],
    ["a validation error", new FakeValidationError("bad url", "url"), 400, { error: "bad url", code: "INVALID_MCP_SERVER", details: { field: "url" } }],
    ["a missing secret store", new FakeSecretStoreError("no key"), 503, { error: "no key", code: "SECRET_STORE_UNCONFIGURED" }],
  ];
  for (const [name, error, status, body] of cases) {
    it(`maps ${name} to ${status}`, async () => {
      expect(await refusalOf(() => call(deps(error).d))).toEqual({ status, body });
    });
  }

  it("maps a lowering failure thrown by the awaited roster change, and rethrows anything unmapped", async () => {
    const { d } = deps({ serverId: "s2", enabled: false });
    d.notifyRosterChanged = async () => { throw new FakeLoweringError("stop failed"); };
    expect(await refusalOf(() => call(d))).toEqual({ status: 503, body: { error: "stop failed", code: "TOOL_ACCESS_LOWERING_FAILED" } });
    await expect(call(deps(new Error("db down")).d)).rejects.toThrow("db down");
  });

  it("fails closed without a principal or an authorizer", async () => {
    const { d, saves } = deps();
    await expect(externalMcpPutRoute.handle({ input: { serverId: "s1", body: {} }, deps: d, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
    await expect(externalMcpPutRoute.handle({ input: { serverId: "s1", body: {} }, deps: d, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(saves).toEqual([]);
  });
});
