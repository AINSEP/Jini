import { describe, expect, it } from "vitest";
import { commerceStatusRoute } from "../status.js";
import { PRINCIPAL, recordingAuthorize, signal, WORKSPACE_ID } from "./helpers.js";

const raw = (params: Record<string, string> = {}) => ({ body: undefined, query: {}, params });

/** A status the injected reader answers, so the response can be pinned as exactly what the host's reader produced. */
const STATUS = { contractVersion: 1, workspaceId: WORKSPACE_ID, providers: [{ id: "fake" }] };

function fakeReader(answer: () => object = () => STATUS) {
  const seen: Array<{ workspaceId: string }> = [];
  return { seen, readCommerceStatus: (required: { workspaceId: string }) => { seen.push(required); return answer(); } };
}

describe("commerceStatusRoute", () => {
  it("is a plain GET on the workspace's commerce status with no body cap or custom status", () => {
    expect(commerceStatusRoute.method).toBe("get");
    expect(commerceStatusRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/commerce/status");
    expect(commerceStatusRoute.successStatus).toBeUndefined();
    expect(commerceStatusRoute.maxBodyBytes).toBeUndefined();
  });

  it("reads nothing from the request: parse never refuses and carries no input", () => {
    expect(commerceStatusRoute.parse(raw())).toEqual({ ok: true, value: {} });
    expect(commerceStatusRoute.parse({ body: { junk: 1 }, query: { a: "b" }, params: { workspaceId: "x" } })).toEqual({ ok: true, value: {} });
  });

  it("authorizes the integrations permission on the integration entity type, with no entity id", async () => {
    const { authorize, calls } = recordingAuthorize();
    const { readCommerceStatus } = fakeReader();
    await commerceStatusRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, readCommerceStatus }, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.integrations.manage", entityType: "integration" }]);
  });

  it("answers exactly what the injected reader returns for the served workspace", async () => {
    const { seen, readCommerceStatus } = fakeReader();
    const result = await commerceStatusRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, readCommerceStatus }, context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal });
    expect(seen).toEqual([{ workspaceId: WORKSPACE_ID }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value).toBe(STATUS);
  });

  it("a refused authorization stops before the reader runs", async () => {
    const { seen, readCommerceStatus } = fakeReader();
    await expect(commerceStatusRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, readCommerceStatus }, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } }, { signal })).rejects.toThrow("denied");
    expect(seen).toEqual([]);
  });

  it("rethrows a reader failure unchanged so the host answers its fixed redacted 500 (adapter errors can carry secrets)", async () => {
    const { readCommerceStatus } = fakeReader(() => { throw new Error("provider secret sk_live_123 leaked"); });
    await expect(commerceStatusRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, readCommerceStatus }, context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal })).rejects.toThrow("provider secret sk_live_123 leaked");
  });

  it("fails closed without an authorizer (a wiring bug, not a caller error)", async () => {
    const { seen, readCommerceStatus } = fakeReader();
    const deps = { workspaceId: WORKSPACE_ID, readCommerceStatus };
    await expect(commerceStatusRoute.handle({ input: {}, deps, context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
    expect(seen).toEqual([]);
  });
});
