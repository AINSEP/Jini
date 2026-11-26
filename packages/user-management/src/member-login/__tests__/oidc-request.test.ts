import { expect, it, vi } from "vitest";
import { completeMemberOidcCallback, readOidcCallbackParams, readOidcEmailProof, requireOidcContinuationDelivery, verifyMemberOidcEmailProof } from "../oidc-request.js";
import { completeOidcLogin, openLoginEmailContinuation, sealLoginEmailContinuation, type OidcLoginDeps } from "../oidc-login.js";
import { requestLoginEmailProof, resolveFederatedIdentity, type MemberLoginLinkDeps } from "../link-service.js";

vi.mock("../oidc-login.js", () => ({ completeOidcLogin: vi.fn(), openLoginEmailContinuation: vi.fn(), sealLoginEmailContinuation: vi.fn() }));
vi.mock("../link-service.js", () => ({ requestLoginEmailProof: vi.fn(), resolveFederatedIdentity: vi.fn() }));

it("admits continuation delivery or raises the fixed login-unavailable refusal", async () => {
  const check = vi.fn(async () => true);
  await expect(requireOidcContinuationDelivery({ check })).resolves.toBeUndefined();
  expect(check).toHaveBeenCalledOnce();
  check.mockResolvedValueOnce(false);
  await expect(requireOidcContinuationDelivery({ check })).rejects.toMatchObject({ code: "LOGIN_UNAVAILABLE" });
  expect(check).toHaveBeenCalledTimes(2);
});

it("checks limits before issuing a bound continuation and rejects extra proof keys", async () => {
  vi.mocked(completeOidcLogin).mockResolvedValue({ identity: { providerId: "p", issuer: "issuer", subject: "subject", email: "a@example.com", emailAuthoritative: false }, startedAt: "now", authenticatedAt: "now", returnPath: "/account" as const });
  vi.mocked(resolveFederatedIdentity).mockResolvedValue({ kind: "email_verification_required", email: "a@example.com", providerId: "p" });
  const calls: string[] = [];
  const result = await completeMemberOidcCallback({ context: { workspaceId: "w", providerId: "p" }, protocol: {} as OidcLoginDeps, links: {} as MemberLoginLinkDeps, browserBinding: () => { calls.push("binding"); return "binding"; }, query: () => { calls.push("query"); return { code: "c", state: "s" }; }, cancelled: () => new Error("cancelled"), userAgent: undefined, ip: "ip", deliveryAllowed: async () => { throw new Error("limited"); }, continuationLocation: () => "location" });
  expect(calls).toEqual(["binding", "query"]);
  expect(requestLoginEmailProof).not.toHaveBeenCalled();
  if (result.kind !== "email_verification_required") throw new Error("expected continuation");
  await expect(result.continueByEmail()).rejects.toThrow("limited");
  expect(sealLoginEmailContinuation).not.toHaveBeenCalled();
  expect(requestLoginEmailProof).not.toHaveBeenCalled();
  expect(() => readOidcEmailProof({ body: { continuation: "c", challengeId: "id", code: "123456", verified: true } })).toThrow();
  expect(() => readOidcCallbackParams({ query: { error: "access_denied" }, cancelled: () => new Error("cancelled") })).toThrow("cancelled");
});

it("does not link a continuation whose browser binding mismatches", async () => {
  vi.mocked(resolveFederatedIdentity).mockClear();
  vi.mocked(openLoginEmailContinuation).mockRejectedValue(new Error("binding mismatch"));
  await expect(verifyMemberOidcEmailProof({ context: { workspaceId: "w", providerId: "p" }, protocol: {} as OidcLoginDeps, links: {} as MemberLoginLinkDeps, browserBinding: "wrong", proof: { continuation: "sealed", challengeId: "id", code: "123456" }, userAgent: undefined, ip: "ip" })).rejects.toThrow("binding mismatch");
  expect(openLoginEmailContinuation).toHaveBeenCalledWith({ deps: {}, input: { workspaceId: "w", providerId: "p", browserBinding: "wrong", continuation: "sealed" } });
  expect(resolveFederatedIdentity).not.toHaveBeenCalled();
});

it("reads link facts only after callback protocol completion and after a proof retry", async () => {
  const order: string[] = [];
  const login = { identity: { providerId: "p", issuer: "issuer", subject: "subject", email: "a@example.com", emailAuthoritative: false }, startedAt: "now", authenticatedAt: "now", returnPath: "/account" as const };
  vi.mocked(completeOidcLogin).mockImplementation(async () => { order.push("protocol"); return login; });
  vi.mocked(resolveFederatedIdentity).mockImplementation(async () => { order.push("link"); return { kind: "email_verification_required", email: "a@example.com", providerId: "p" }; });
  const required = {
    context: { workspaceId: "w", providerId: "p" }, protocol: {} as OidcLoginDeps,
    get links() { order.push("links"); return {} as MemberLoginLinkDeps; },
    get userAgent() { order.push("userAgent"); return "agent"; },
    get ip() { order.push("ip"); return "ip"; },
  };
  const callback = Object.defineProperties({
    context: required.context, protocol: required.protocol, browserBinding: () => "binding", query: () => ({ code: "c", state: "s" }),
    cancelled: () => new Error("cancelled"), deliveryAllowed: async () => {}, continuationLocation: () => "location",
  }, Object.getOwnPropertyDescriptors(required)) as unknown as Parameters<typeof completeMemberOidcCallback>[0];
  await completeMemberOidcCallback(callback);
  expect(order).toEqual(["protocol", "links", "userAgent", "ip", "link"]);
  order.length = 0;
  vi.mocked(openLoginEmailContinuation).mockImplementationOnce(async () => { order.push("proof-refused"); throw new Error("retry"); })
    .mockImplementationOnce(async () => { order.push("proof"); return login; });
  const proof = Object.defineProperties({ context: required.context, protocol: required.protocol, browserBinding: "binding", proof: { continuation: "c", challengeId: "id", code: "123456" } }, Object.getOwnPropertyDescriptors(required)) as Parameters<typeof verifyMemberOidcEmailProof>[0];
  await expect(verifyMemberOidcEmailProof(proof)).rejects.toThrow("retry");
  expect(order).toEqual(["proof-refused"]);
  order.length = 0;
  await verifyMemberOidcEmailProof(proof);
  expect(order).toEqual(["proof", "links", "userAgent", "ip", "link"]);
});
