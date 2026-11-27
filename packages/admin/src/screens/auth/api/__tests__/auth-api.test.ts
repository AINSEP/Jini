import { expect, it, vi } from "vitest";
import { createAuthApi, type AuthApiDeps } from "../auth-api.js";

function setup() {
  const request = vi.fn(async (_r: Parameters<AuthApiDeps["request"]>[0], _o?: Parameters<AuthApiDeps["request"]>[1]) => ({}));
  const requestOnce = vi.fn(async (_r: Parameters<AuthApiDeps["requestOnce"]>[0]) => ({}));
  const api = createAuthApi({ request: request as unknown as AuthApiDeps["request"], requestOnce: requestOnce as unknown as AuthApiDeps["requestOnce"] });
  return { api, request, requestOnce };
}

it("opts password login into retry but sends MFA completion once with no caching", async () => {
  const { api, request, requestOnce } = setup();
  request.mockResolvedValueOnce({ mfaRequired: true, pendingToken: "pending-7" });
  await expect(api.login({ username: "owner", password: "test-password-1" })).resolves.toEqual({ mfaRequired: true, pendingToken: "pending-7" });
  await api.completeMfa({ pendingToken: "pending-7", code: "012347" });
  expect(request.mock.calls).toEqual([
    [{ path: "/auth/login" }, { init: { method: "POST", body: '{"username":"owner","password":"test-password-1"}' }, options: { retryWrites: true } }],
  ]);
  expect(requestOnce.mock.calls).toEqual([[{
    path: "/auth/mfa/login",
    init: { method: "POST", headers: { "content-type": "application/json" }, body: '{"pendingToken":"pending-7","code":"012347"}', cache: "no-store" },
  }]]);
});

it("keeps token redemption, local sign-in, logout and session reads on separate endpoints", async () => {
  const { api, request, requestOnce } = setup();
  await api.redeemBootSession({ token: "boot-7" });
  await api.signInLocalOwner({});
  await api.logout();
  await api.me();
  await api.getPasswordStatus();
  expect(request.mock.calls).toEqual([
    [{ path: "/auth/boot-session" }, { init: { method: "POST", body: '{"token":"boot-7"}' } }],
    [{ path: "/auth/local-boot-session" }, { init: { method: "POST" } }],
    [{ path: "/auth/logout" }, { init: { method: "POST" } }],
    [{ path: "/auth/me" }],
    [{ path: "/auth/me/password-status" }],
  ]);
  expect(requestOnce.mock.calls).toEqual([]);
});
