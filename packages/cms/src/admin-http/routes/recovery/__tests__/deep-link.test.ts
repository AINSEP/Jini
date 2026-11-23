import { describe, expect, it, vi } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { recoveryDeepLinkRoute, type RecoveryDeepLinkRouteDeps } from "../deep-link.js";

const envelope = { v: 1, correlationId: "c", siteId: "s", ledgerEventId: null, restorePointId: "rp-1", drift: "none", intent: "inspect", issuedAt: "2026-01-01T00:00:00Z" };

function harness(found: { restorePointId: string; capturedAt: string } | null = null) {
  const deps: RecoveryDeepLinkRouteDeps = { deepLinkRestorePointLookup: { findRestorePointById: vi.fn(async () => found) } };
  const authorize = vi.fn(async () => undefined);
  return { deps, authorize };
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
    const { deps, authorize } = harness({ restorePointId: "rp-1", capturedAt: "2026-01-01T00:00:00Z" });
    const parsed = recoveryDeepLinkRoute.parse({ body: { envelope }, query: {}, params: {} });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await recoveryDeepLinkRoute.handle({ input: parsed.value, deps, context: { id: "p-1" }, authorize }, {});
    expect(result).toEqual({ ok: true, value: { found: true, restorePoint: { restorePointId: "rp-1", capturedAt: "2026-01-01T00:00:00Z" } } });
    expect(authorize).toHaveBeenCalledWith({ permission: "backup.read", entityType: "restore-point" });
    expect(deps.deepLinkRestorePointLookup.findRestorePointById).toHaveBeenCalledWith("rp-1");
  });

  it("refuses a missing, absent-body or non-object envelope with 400 VALIDATION_ERROR, after authorizing", async () => {
    for (const body of [{}, undefined, { envelope: "nope" }]) {
      const { deps, authorize } = harness();
      const parsed = recoveryDeepLinkRoute.parse({ body, query: {}, params: {} });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const response = await refusal(Promise.resolve(recoveryDeepLinkRoute.handle({ input: parsed.value, deps, context: { id: "p-1" }, authorize }, {})));
      expect(response).toEqual({ status: 400, body: { error: "'envelope' (object) is required", code: "VALIDATION_ERROR" } });
      expect(authorize).toHaveBeenCalledOnce();
    }
  });

  it("lets an authorization refusal win over invalid input", async () => {
    const { deps } = harness();
    const authorize = vi.fn(async () => { throw new RouteRefusalError({ status: 403, body: { error: "no" } }); });
    const response = await refusal(Promise.resolve(recoveryDeepLinkRoute.handle({ input: {}, deps, context: { id: "p-1" }, authorize }, {})));
    expect(response.status).toBe(403);
  });

  it("throws when mounted without a principal or an authorizer", async () => {
    const { deps, authorize } = harness();
    await expect(Promise.resolve(recoveryDeepLinkRoute.handle({ input: { envelope }, deps, authorize }, {}))).rejects.toThrow(/principal/);
    await expect(Promise.resolve(recoveryDeepLinkRoute.handle({ input: { envelope }, deps, context: { id: "p-1" } }, {}))).rejects.toThrow(/authoriz/);
  });
});
