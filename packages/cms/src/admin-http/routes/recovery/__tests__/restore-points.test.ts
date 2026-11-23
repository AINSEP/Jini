import { describe, expect, it, vi } from "vitest";

import { recoveryRestorePointsListRoute, type RecoveryRestorePointsListRouteDeps } from "../restore-points.js";

/** A typed fake on the same seam production injects: the host binds `listRestorePoints` to the
 *  database package's listing over its repository; this spec answers that listing as-is. */
function bound(items: readonly unknown[]) {
  const listRestorePoints = vi.fn<RecoveryRestorePointsListRouteDeps["listRestorePoints"]>(async () => ({ items }));
  const deps: RecoveryRestorePointsListRouteDeps = { listRestorePoints };
  return { deps, listRestorePoints };
}

const row = { id: "rp-1", kind: "manual", watermarkAtCapture: null, createdAt: "2026-01-01T00:00:00Z", artifactRef: "a" };

describe("recoveryRestorePointsListRoute", () => {
  it("keeps the method and path byte-identical", () => {
    expect(recoveryRestorePointsListRoute.method).toBe("get");
    expect(recoveryRestorePointsListRoute.path).toBe("/api/admin/v1/recovery/restore-points");
  });

  it("lists the shared restore-point ledger after authorizing backup.read on restore-point", async () => {
    const { deps, listRestorePoints } = bound([row]);
    const authorize = vi.fn(async () => undefined);
    const parsed = recoveryRestorePointsListRoute.parse({ body: undefined, query: {}, params: {} });
    if (!parsed.ok) throw new Error("parse must be total");
    const result = await recoveryRestorePointsListRoute.handle({ input: parsed.value, deps, context: { id: "p-1" }, authorize }, {});
    expect(result).toEqual({ ok: true, value: { items: [row] } });
    expect(authorize).toHaveBeenCalledWith({ permission: "backup.read", entityType: "restore-point" });
    expect(listRestorePoints.mock.calls).toEqual([[]]);
  });

  it("never reads the ledger when authorization refuses", async () => {
    const { deps, listRestorePoints } = bound([row]);
    const authorize = vi.fn(async () => { throw new Error("denied"); });
    await expect(Promise.resolve(recoveryRestorePointsListRoute.handle({ input: undefined, deps, context: { id: "p-1" }, authorize }, {}))).rejects.toThrow("denied");
    expect(listRestorePoints).not.toHaveBeenCalled();
  });

  it("throws when mounted without a principal or an authorizer", async () => {
    const { deps } = bound([]);
    await expect(Promise.resolve(recoveryRestorePointsListRoute.handle({ input: undefined, deps, authorize: vi.fn(async () => undefined) }, {}))).rejects.toThrow(/principal/);
    await expect(Promise.resolve(recoveryRestorePointsListRoute.handle({ input: undefined, deps, context: { id: "p-1" } }, {}))).rejects.toThrow(/authoriz/);
  });
});
