import { describe, expect, it, vi } from "vitest";

import type { AdminDegradedBannerDto } from "@jini-ai/core/contracts/site/cms-recovery";

import { recoveryStatusRoute, type RecoveryStatusRouteDeps } from "../status.js";

/** A real wire banner (the database package's precedence returns this shape or `null`). */
const BANNER: AdminDegradedBannerDto = { kind: "pending-migration", accessibleText: "A database migration is pending.", actionKind: "deep-link-to-database-migration" };

/** Typed fakes on the seams production injects: the host binds `dbOps`/`siteStatusRepo` to its
 *  database adapters, `isOperationInFlight` to its operation lock and `resolveDegradedBanner` to the
 *  database package's pure banner precedence. */
function bound(overrides: Partial<RecoveryStatusRouteDeps> = {}) {
  const getCapabilities = vi.fn(async () => ({ restorePoint: { costClass: "cheap" as const } }));
  const get = vi.fn(async (_workspaceId: string) => "OPEN" as string | null);
  const isOperationInFlight = vi.fn((_required: { siteId: string }) => false);
  const resolveDegradedBanner = vi.fn((_input: Parameters<RecoveryStatusRouteDeps["resolveDegradedBanner"]>[0]): AdminDegradedBannerDto | null => BANNER);
  const deps: RecoveryStatusRouteDeps = {
    workspaceId: "ws-1", dbOps: { getCapabilities }, siteStatusRepo: { get }, isOperationInFlight, resolveDegradedBanner, ...overrides,
  };
  return { deps, getCapabilities, get, isOperationInFlight, resolveDegradedBanner };
}

const allow = () => vi.fn(async () => undefined);
const run = (deps: RecoveryStatusRouteDeps, authorize = allow()) =>
  Promise.resolve(recoveryStatusRoute.handle({ input: undefined, deps, context: { id: "p-1" }, authorize }, {}));

describe("recoveryStatusRoute", () => {
  it("keeps the method, path, success status and body cap byte-identical", () => {
    expect(recoveryStatusRoute.method).toBe("get");
    expect(recoveryStatusRoute.path).toBe("/api/admin/v1/recovery/status");
    expect(recoveryStatusRoute.successStatus).toBeUndefined();
    expect(recoveryStatusRoute.maxBodyBytes).toBeUndefined();
    expect(recoveryStatusRoute.parse({ body: { ignored: true }, query: {}, params: {} })).toEqual({ ok: true, value: undefined });
  });

  it("authorizes backup.read on restore-point with no entity scope", async () => {
    const { deps } = bound();
    const authorize = allow();
    await run(deps, authorize);
    expect(authorize.mock.calls).toEqual([[{ permission: "backup.read", entityType: "restore-point" }]]);
  });

  it("answers the cost class and the banner resolved from every capability source", async () => {
    const { deps, get, isOperationInFlight, resolveDegradedBanner } = bound();
    const result = await run(deps);
    expect(result).toEqual({ ok: true, value: { costClass: "cheap", banner: BANNER } });
    expect(resolveDegradedBanner.mock.calls).toEqual([[{ capabilities: {
      costClass: "cheap", operationInFlight: false, pendingMigration: false, migrationInterrupted: false, watermarkBaselineAvailable: false,
    } }]]);
    expect(get.mock.calls).toEqual([["ws-1"]]);
    expect(isOperationInFlight.mock.calls).toEqual([[{ siteId: "ws-1" }, {}]]);
  });

  it.each([
    ["PENDING_MIGRATION", { pendingMigration: true, migrationInterrupted: false }],
    ["BLOCKED_PENDING_RECOVERY", { pendingMigration: false, migrationInterrupted: true }],
  ])("maps site status %s onto the banner flags", async (status, flags) => {
    const { deps, resolveDegradedBanner } = bound({ siteStatusRepo: { get: async () => status } });
    await run({ ...deps, isOperationInFlight: () => true });
    expect(resolveDegradedBanner.mock.calls[0]?.[0].capabilities).toMatchObject({ ...flags, operationInFlight: true });
  });

  it("answers a null banner when nothing is degraded", async () => {
    const { deps } = bound({ resolveDegradedBanner: () => null });
    expect(await run(deps)).toEqual({ ok: true, value: { costClass: "cheap", banner: null } });
  });

  it("reads nothing when authorization refuses", async () => {
    const { deps, getCapabilities, get } = bound();
    await expect(run(deps, vi.fn(async () => { throw new Error("denied"); }))).rejects.toThrow("denied");
    expect(getCapabilities).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("rethrows a failing capability probe unchanged (the host 500)", async () => {
    const { deps } = bound({ dbOps: { getCapabilities: async () => { throw new Error("probe failed"); } } });
    await expect(run(deps)).rejects.toThrow("probe failed");
  });

  it("fails closed without an authorizer or a principal", async () => {
    const { deps } = bound();
    await expect(Promise.resolve(recoveryStatusRoute.handle({ input: undefined, deps, context: { id: "p-1" } }, {}))).rejects.toThrow(/authoriz/);
    await expect(Promise.resolve(recoveryStatusRoute.handle({ input: undefined, deps, authorize: allow() }, {}))).rejects.toThrow(/principal/);
  });
});
