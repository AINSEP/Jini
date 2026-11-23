import { describe, expect, it } from "vitest";
import { externalMcpOAuthDisconnectRoute, type ExternalMcpOAuthDisconnectRouteDeps } from "../oauth-disconnect.js";
import {
  FakeApiConnectionError, FakeOAuthError, FakeReauthError, FakeSecretStoreError, FakeValidationError, isSecretStoreUnconfiguredError, isValidationError,
  PERMISSION_CALL, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID,
} from "./helpers.js";

function deps(outcome?: Error) {
  const asked: unknown[] = [];
  const d: ExternalMcpOAuthDisconnectRouteDeps = {
    workspaceId: WORKSPACE_ID,
    disconnect: async (input) => { asked.push(input); if (outcome) throw outcome; },
    isApiConnectionError: (err): err is FakeApiConnectionError => err instanceof FakeApiConnectionError,
    isValidationError,
    isReauthRequiredError: (err): err is FakeReauthError => err instanceof FakeReauthError,
    isSecretStoreUnconfiguredError,
    isOAuthError: (err): err is FakeOAuthError => err instanceof FakeOAuthError,
  };
  return { d, asked };
}
const call = (d: ExternalMcpOAuthDisconnectRouteDeps, authorize = recordingAuthorize().authorize) =>
  externalMcpOAuthDisconnectRoute.handle({ input: { serverId: "s1" }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("externalMcpOAuthDisconnectRoute", () => {
  it("keeps the method and path and reads :serverId, falling back to an empty id", () => {
    expect(externalMcpOAuthDisconnectRoute.method).toBe("delete");
    expect(externalMcpOAuthDisconnectRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/mcp-servers/:serverId/oauth");
    expect(externalMcpOAuthDisconnectRoute.maxBodyBytes).toBeUndefined();
    expect(externalMcpOAuthDisconnectRoute.parse(raw({ serverId: "s1" }))).toEqual({ ok: true, value: { serverId: "s1" } });
    expect(externalMcpOAuthDisconnectRoute.parse(raw({}))).toEqual({ ok: true, value: { serverId: "" } });
  });

  it("authorizes, disconnects the server and reports restartRequired", async () => {
    const { d, asked } = deps();
    const { authorize, calls } = recordingAuthorize();
    expect(await call(d, authorize)).toEqual({ ok: true, value: { disconnected: true, restartRequired: true } });
    expect(calls).toEqual([PERMISSION_CALL]);
    expect(asked).toEqual([{ serverId: "s1" }]);
  });

  const cases: Array<[string, Error, number, unknown]> = [
    ["an access-denied connection error", new FakeApiConnectionError("denied by vendor", "access-denied"), 403, { error: "denied by vendor", code: "access-denied" }],
    ["another connection error", new FakeApiConnectionError("bad state", "invalid-state"), 400, { error: "bad state", code: "invalid-state" }],
    ["a validation error", new FakeValidationError("bad id", "credentialId"), 400, { error: "bad id", code: "INVALID_MCP_SERVER", details: { field: "credentialId" } }],
    ["a reauth-required error", new FakeReauthError("sign in again"), 409, { error: "sign in again", code: "EXTERNAL_MCP_REAUTH_REQUIRED", details: { retryable: false, settingsLink: "/settings/mcp" } }],
    ["a missing secret store", new FakeSecretStoreError("no key"), 503, { error: "no key", code: "SECRET_STORE_UNCONFIGURED" }],
    ["an unreachable provider", new FakeOAuthError("down", "OAUTH_PROVIDER_UNREACHABLE", true, "wait", 30), 502, { error: "down", code: "OAUTH_PROVIDER_UNREACHABLE", details: { retryable: true, operatorAction: "wait", retryAfterSeconds: 30 } }],
    ["a provider refusal", new FakeOAuthError("no", "OAUTH_INVALID_CLIENT", false, "check id"), 400, { error: "no", code: "OAUTH_INVALID_CLIENT", details: { retryable: false, operatorAction: "check id" } }],
  ];
  for (const [name, error, status, body] of cases) {
    it(`maps ${name} to ${status}`, async () => {
      expect(await refusalOf(() => call(deps(error).d))).toEqual({ status, body });
    });
  }

  it("does not disconnect when authorization refuses, and rethrows anything unmapped", async () => {
    const { d, asked } = deps();
    await expect(call(d, recordingAuthorize(["admin.integrations.manage"]).authorize)).rejects.toThrow("denied");
    expect(asked).toEqual([]);
    await expect(call(deps(new Error("db down")).d)).rejects.toThrow("db down");
  });
});
