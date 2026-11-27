import { externalMcpProviderRefusal } from "../provider-refusal.js";
import { expect, it, vi } from "vitest";
import { externalMcpOAuthConnectRoute, externalMcpOAuthPollRoute, externalMcpSharedListRoute, externalMcpSharedLocalRoute, externalMcpSharedSelectRoute, createExternalMcpBrowserSignInRoute } from "../oauth.js";

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

it.each([
  { label: "missing body", body: undefined },
  { label: "foreign field", body: { credentialId: "cred-7", actorId: "untrusted" } },
  { label: "numeric id", body: { credentialId: 7 } },
  { label: "empty id", body: { credentialId: "" } },
  { label: "513-character id", body: { credentialId: "a".repeat(513) } },
])("refuses a saved selection with $label without changing the connection", async ({ body }) => {
  const invalid = new Error("Choose one saved connection");
  const useSharedConnection = vi.fn(async () => {});
  const requireSharedSession = vi.fn();
  await expect(externalMcpSharedSelectRoute.handle({
    input: { serverId: "calendar", body }, context: { id: "owner-7" }, authorize: async () => {},
    deps: { requireSharedSession, useSharedConnection, invalidCredential: () => invalid, unavailable: () => new Error("not configured") },
  })).rejects.toBe(invalid);
  expect(requireSharedSession.mock.calls).toEqual([[{}]]);
  expect(useSharedConnection).not.toHaveBeenCalled();
});

it("selects a 512-character saved credential for the session principal and no other fields", async () => {
  const credentialId = "a".repeat(512);
  const useSharedConnection = vi.fn(async () => {});
  const requireSharedSession = vi.fn();
  expect(await externalMcpSharedSelectRoute.handle({
    input: { serverId: "calendar", body: { credentialId } }, context: { id: "owner-7" }, authorize: async () => {},
    deps: { requireSharedSession, useSharedConnection, invalidCredential: () => new Error("invalid"), unavailable: () => new Error("not configured") },
  })).toStrictEqual({ ok: true, value: { connected: true } });
  expect(requireSharedSession.mock.calls).toEqual([[{}]]);
  expect(useSharedConnection.mock.calls).toEqual([[{ serverId: "calendar", credentialId, actorId: "owner-7" }]]);
});

it("refuses to switch to a local connection when the host has no local switching service", async () => {
  const context = { id: "owner-7" };
  const requireSharedSession = vi.fn();
  const unavailable = new Error("Local connection switching is unavailable");
  const authorize = vi.fn(async () => {});
  const parse = await externalMcpSharedLocalRoute.parse({ params: { serverId: "calendar" }, body: { credentialId: "ignored" }, query: {} });
  if (!parse.ok) throw new Error("the local switch must parse its path server id");
  expect(parse.value).toStrictEqual({ serverId: "calendar" });
  await expect(externalMcpSharedLocalRoute.handle({ input: parse.value, context, authorize,
    deps: { requireSharedSession, useLocalConnection: undefined, unavailable: () => unavailable },
  })).rejects.toBe(unavailable);
  expect(authorize.mock.calls).toEqual([[{ permission: "admin.integrations.manage", entityType: "integration" }]]);
  expect(requireSharedSession.mock.calls).toEqual([[{}]]);
});

it("a provider configuration refusal is a 400 with no synthetic retry delay", () => {
  expect(externalMcpProviderRefusal({ error: {
    code: "INVALID_CLIENT", message: "Provider declined the client", retryable: false, operatorAction: "Check the client ID.",
  } })).toStrictEqual({ status: 400, body: {
    code: "INVALID_CLIENT", error: "Provider declined the client",
    details: { retryable: false, operatorAction: "Check the client ID." },
  } });
});

it("a valid shared selection refuses an unwired host instead of claiming it connected", async () => {
  const unavailable = new Error("Saved connection switching is unavailable");
  const requireSharedSession = vi.fn();
  await expect(externalMcpSharedSelectRoute.handle({
    input: { serverId: "calendar", body: { credentialId: "saved-7" } }, context: { id: "owner-7" }, authorize: async () => {},
    deps: { requireSharedSession, useSharedConnection: undefined, invalidCredential: () => new Error("wrong refusal"),
      unavailable: () => unavailable },
  })).rejects.toBe(unavailable);
  expect(requireSharedSession.mock.calls).toEqual([[{}]]);
});
