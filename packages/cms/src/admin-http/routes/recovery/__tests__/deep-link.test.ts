import { describe, expect, it, vi } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { recoveryDeepLinkRoute, type RecoveryDeepLinkRouteDeps } from "../deep-link.js";

const envelope = { v: 1, correlationId: "c", siteId: "s", ledgerEventId: null, restorePointId: "rp-1", drift: "none", intent: "inspect", issuedAt: "2026-01-01T00:00:00Z" };
const resolved = { found: true, restorePoint: { restorePointId: "rp-1", capturedAt: "2026-01-01T00:00:00Z" } };

/** A typed fake on the same seam production injects: the host binds `resolveDeepLinkContext` to the
 *  database package's re-resolution; this spec only forwards to it and answers its result as-is. */
function harness() {
  const resolveDeepLinkContext = vi.fn<RecoveryDeepLinkRouteDeps["resolveDeepLinkContext"]>(async () => resolved);
  const deps: RecoveryDeepLinkRouteDeps = { resolveDeepLinkContext };
  const authorize = vi.fn(async () => undefined);
  return { deps, resolveDeepLinkContext, authorize };
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(RouteRefusalError);
  return (error as RouteRefusalError).response;
}

describe("recoveryDeepLinkRoute", () => {
  it("keeps the method and path byte-identical", () => {
    expect(recoveryDeepLinkRoute.method).toBe("post");
    expect(recoveryDeepLinkRoute.path).toBe("/api/admin/v1/recovery/deep-link");
  });

  it("re-resolves the envelope server-side after authorizing backup.read on restore-point", async () => {
    const { deps, resolveDeepLinkContext, authorize } = harness();
    const parsed = recoveryDeepLinkRoute.parse({ body: { envelope }, query: {}, params: {} });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await recoveryDeepLinkRoute.handle({ input: parsed.value, deps, context: { id: "p-1" }, authorize }, {});
    expect(result).toEqual({ ok: true, value: resolved });
    expect(authorize).toHaveBeenCalledWith({ permission: "backup.read", entityType: "restore-point" });
    expect(resolveDeepLinkContext.mock.calls).toEqual([[{ principalId: "p-1", principalKind: "user", envelope }]]);
  });

  it("refuses a missing, absent-body or non-object envelope with 400 VALIDATION_ERROR, after authorizing", async () => {
    for (const body of [{}, undefined, { envelope: "nope" }]) {
      const { deps, resolveDeepLinkContext, authorize } = harness();
      const parsed = recoveryDeepLinkRoute.parse({ body, query: {}, params: {} });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const response = await refusal(Promise.resolve(recoveryDeepLinkRoute.handle({ input: parsed.value, deps, context: { id: "p-1" }, authorize }, {})));
      expect(response).toEqual({ status: 400, body: { error: "'envelope' (object) is required", code: "VALIDATION_ERROR" } });
      expect(authorize).toHaveBeenCalledOnce();
      expect(resolveDeepLinkContext).not.toHaveBeenCalled();
    }
  });

  it("lets an authorization refusal win over invalid input", async () => {
    const { deps, resolveDeepLinkContext } = harness();
    const authorize = vi.fn(async () => { throw new RouteRefusalError({ status: 403, body: { error: "no" } }); });
    const response = await refusal(Promise.resolve(recoveryDeepLinkRoute.handle({ input: {}, deps, context: { id: "p-1" }, authorize }, {})));
    expect(response.status).toBe(403);
    expect(resolveDeepLinkContext).not.toHaveBeenCalled();
  });

  it("throws when mounted without a principal or an authorizer", async () => {
    const { deps, authorize } = harness();
    await expect(Promise.resolve(recoveryDeepLinkRoute.handle({ input: { envelope }, deps, authorize }, {}))).rejects.toThrow(/principal/);
    await expect(Promise.resolve(recoveryDeepLinkRoute.handle({ input: { envelope }, deps, context: { id: "p-1" } }, {}))).rejects.toThrow(/authoriz/);
  });
});
