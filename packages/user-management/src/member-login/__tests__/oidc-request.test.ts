import { expect, it, vi } from "vitest";
import { completeMemberOidcCallback, readOidcCallbackParams, readOidcEmailProof, verifyMemberOidcEmailProof } from "../oidc-request.js";
import { completeOidcLogin, openLoginEmailContinuation, sealLoginEmailContinuation, type OidcLoginDeps } from "../oidc-login.js";
import { requestLoginEmailProof, resolveFederatedIdentity, type MemberLoginLinkDeps } from "../link-service.js";

vi.mock("../oidc-login.js", () => ({ completeOidcLogin: vi.fn(), openLoginEmailContinuation: vi.fn(), sealLoginEmailContinuation: vi.fn() }));
vi.mock("../link-service.js", () => ({ requestLoginEmailProof: vi.fn(), resolveFederatedIdentity: vi.fn() }));

it("checks limits before issuing a bound continuation and rejects extra proof keys", async () => {
  vi.mocked(completeOidcLogin).mockResolvedValue({ identity: { providerId: "p", issuer: "issuer", subject: "subject", email: "a@example.com", emailAuthoritative: false }, startedAt: "now", authenticatedAt: "now", returnPath: "/account" });
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
