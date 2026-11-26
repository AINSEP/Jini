import { externalMcpProviderRefusal } from "../provider-refusal.js";
import { expect, it, vi } from "vitest";
import { externalMcpOAuthConnectRoute, externalMcpOAuthPollRoute, externalMcpSharedListRoute, externalMcpSharedSelectRoute, createExternalMcpBrowserSignInRoute } from "../oauth.js";

it("shared connect and saved selection cannot reach an operation before the required session", async () => {
  const beginConnect = vi.fn(); const useSharedConnection = vi.fn();
  const requireSharedSession = vi.fn(() => { throw new Error("session"); });
  const authorize = vi.fn(async () => {});
  await expect(externalMcpOAuthConnectRoute.handle({ input: { serverId: "s", body: { destination: "shared" } }, deps: { beginConnect, callbackUrl: () => "url", requireSharedSession, invalidDestination: () => new Error("destination") }, context: { id: "owner" }, authorize })).rejects.toThrow("session");
  await expect(externalMcpSharedSelectRoute.handle({ input: { serverId: "s", body: { credentialId: "id" } }, deps: { requireSharedSession, useSharedConnection, invalidCredential: () => new Error("credential"), unavailable: () => new Error("unavailable") }, context: { id: "owner" }, authorize })).rejects.toThrow("session");
  expect(authorize).toHaveBeenCalledWith({ permission: "admin.integrations.manage", entityType: "integration" });
  expect(beginConnect).not.toHaveBeenCalled(); expect(useSharedConnection).not.toHaveBeenCalled();
});

it("keeps disabled listing, family ID coercions and a single device poll", async () => {
  const authorize = vi.fn(async () => {});
  expect(externalMcpOAuthConnectRoute.parse({ params: {}, query: {}, body: undefined })).toEqual({ ok: true, value: { serverId: "", body: undefined } });
  expect(externalMcpSharedListRoute.parse({ params: {}, query: {}, body: undefined })).toEqual({ ok: true, value: { serverId: "undefined" } });
  expect(await externalMcpSharedListRoute.handle({ input: { serverId: "s" }, context: { id: "owner" }, authorize, deps: { requireSharedSession: () => {}, listSharedConnections: undefined } })).toEqual({ ok: true, value: { available: false, connections: [], current: null } });
  const pollDeviceAuthorization = vi.fn(async () => ({ status: "pending" as const, retryAfterSeconds: 7 }));
  expect(await externalMcpOAuthPollRoute.handle({ input: { serverId: "s" }, authorize, deps: { pollDeviceAuthorization } })).toEqual({ ok: true, value: { status: "pending", retryAfterSeconds: 7 } });
  expect(pollDeviceAuthorization).toHaveBeenCalledTimes(1);
});

it("refuses browser device sign-in without a cookie and projects only safe provider fields", async () => {
  const bindingCookie = vi.fn(() => "binding=secret");
  const route = createExternalMcpBrowserSignInRoute({ path: "/host-signin" });
  const response = await route.handle({ raw: { params: { serverId: "s" }, query: {}, body: undefined }, context: { id: "owner" }, authorize: async () => {}, deps: { beginConnect: vi.fn(async () => ({ kind: "device_code" } as never)), makeBinding: () => "binding", callbackUrl: () => "url", bindingCookie, deviceSignInRefusal: { error: "Use device sign-in", code: "MCP_DEVICE_SIGN_IN_REQUIRED" } } });
  expect(response.status).toBe(400); expect(response.headers.has("set-cookie")).toBe(false); expect(bindingCookie).not.toHaveBeenCalled();
  expect(externalMcpProviderRefusal({ error: { code: "OAUTH_PROVIDER_UNREACHABLE", message: "safe", retryable: true, operatorAction: "retry", retryAfterSeconds: 3 } })).toMatchObject({ status: 502, body: { error: "safe", details: { retryAfterSeconds: 3, retryable: true, operatorAction: "retry" } } });
});
