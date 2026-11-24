import { describe, expect, it, vi } from "vitest";
import { createSecurityApi } from "../security-api.js";

function setup() {
  const request = vi.fn(async () => ({}));
  const authenticatedRequest = vi.fn(async () => ({}));
  return { request, authenticatedRequest, api: createSecurityApi({ request: request as never, authenticatedRequest: authenticatedRequest as never, workspaceId: "w1" }) };
}
const body = (init: RequestInit | undefined) => JSON.parse(String(init?.body));

describe("createSecurityApi request shapes", () => {
  it("lists and writes publish credentials on the workspace's publish path", async () => {
    const { request, api } = setup();
    await api.listPublishCredentials();
    await api.createPublishCredential({ label: "L", connection: { providerId: "vercel", token: "t" }, isDefault: true });
    await api.updatePublishCredential({ id: "a/b", input: { label: "N" } });
    await api.deletePublishCredential({ id: "a/b" });
    await api.verifyPublishCredential({ id: "a/b" });
    const calls = request.mock.calls as unknown as [{ path: string }, { init?: RequestInit }?][];
    expect(calls.map(([r, o]) => [r.path, o?.init?.method])).toEqual([
      ["/workspaces/w1/system/publish/credentials", undefined],
      ["/workspaces/w1/system/publish/credentials", "POST"],
      ["/workspaces/w1/system/publish/credentials/a%2Fb", "PUT"],
      ["/workspaces/w1/system/publish/credentials/a%2Fb", "DELETE"],
      ["/workspaces/w1/system/publish/credentials/a%2Fb/verify", "POST"],
    ]);
    expect(body(calls[1]![1]!.init)).toEqual({ label: "L", connection: { providerId: "vercel", token: "t" }, isDefault: true });
  });
  it("lists and writes custom credentials", async () => {
    const { request, api } = setup();
    await api.listCustomCredentials();
    await api.createCustomCredential({ label: "x", category: "ops", baseUrl: "https://a.b", connection: { token: "t" } });
    await api.updateCustomCredential({ id: "c1", input: { username: null } });
    await api.deleteCustomCredential({ id: "c1" });
    const calls = request.mock.calls as unknown as [{ path: string }, { init?: RequestInit }?][];
    expect(calls.map(([r, o]) => [r.path, o?.init?.method])).toEqual([
      ["/workspaces/w1/system/custom/credentials", undefined],
      ["/workspaces/w1/system/custom/credentials", "POST"],
      ["/workspaces/w1/system/custom/credentials/c1", "PUT"],
      ["/workspaces/w1/system/custom/credentials/c1", "DELETE"],
    ]);
    expect(body(calls[2]![1]!.init)).toEqual({ username: null });
  });
  it("routes credential copy through the authenticated request with a body object", async () => {
    const { authenticatedRequest, api } = setup();
    const signal = new AbortController().signal;
    await api.listCredentialCopySources({}, { signal });
    await api.copyCredentials({ sourceSiteId: "s", ids: ["k"], overwrite: false }, { signal });
    expect(authenticatedRequest.mock.calls).toEqual([
      [{ path: "/workspaces/w1/system/credential-copy", method: "GET" }, { signal }],
      [{ path: "/workspaces/w1/system/credential-copy", method: "POST", body: { sourceSiteId: "s", ids: ["k"], overwrite: false } }, { signal }],
    ]);
  });
});
