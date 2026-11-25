import { afterEach, expect, test, vi } from "vitest";
import { toolMetadata } from "@jini-ai/core/tool-metadata/recovery";
import { humanConfirmedHandler, type ToolExecutionContext } from "@jini-ai/core";
import { createRecoveryAgentToolCatalog } from "../agent-tools.js";
import * as orchestrator from "../recovery-orchestrator.js";
import { buildRecoveryRegistrations, type RecoveryToolDeps, type RecoveryToolHost } from "../tool-registrations.js";

const ctx: ToolExecutionContext = { executionId: "execution", principal: { id: "human" }, run: { id: "run" }, signal: new AbortController().signal, input: { restorePointId: "point" } };
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const calls: string[] = [];
  let held = false;
  const deps: RecoveryToolDeps = { workspaceId: "site", clock: { nowMs: () => 0 }, authorize: vi.fn(),
    dbOps: { getCapabilities: vi.fn().mockResolvedValue({ restorePoint: { costClass: "cheap", kind: "snapshot" } }) },
    restorePointsRepo: { list: vi.fn().mockResolvedValue([{ id: "point", createdAt: "now" }]) },
    siteStatusRepo: { get: vi.fn() }, disclosureWatermarkSource: { getBaseline: vi.fn().mockResolvedValue({ available: false }), getCategoryCounts: vi.fn().mockResolvedValue({}) },
    deepLinkRestorePointLookup: { findRestorePointById: vi.fn() }, refuseUnexpectedKeys: vi.fn(),
  };
  const surfaces = { surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: vi.fn() } };
  const host: RecoveryToolHost<RecoveryToolDeps> = {
    catalog: createRecoveryAgentToolCatalog({ backupWorkflowGuidance: "backup", restorePointIdSource: "list" }), metadata: toolMetadata, catalogModule: "host/recovery", readPermission: "read", restorePermission: "restore", coveredCategories: [],
    capabilityGuidance: { fullSiteBackup: { discoveryTool: "discover", planTool: "plan", pushTool: "push", guidance: "backup" }, portableExport: { href: "/export", guidance: "export" } },
    authorize: vi.fn(async () => { calls.push("authorize"); }),
    plan: vi.fn(async input => { calls.push(`plan:${input.actorId}:${input.principalKind}`); return { ok: true as const, value: { planId: "plan", planHash: "hash" } }; }),
    confirm: vi.fn(async input => { calls.push(`confirm:${input.confirmer.id}:${input.confirmer.kind}`); return { ok: true as const, value: { confirmationToken: "token" } }; }),
    execute: vi.fn(async input => { expect(held).toBe(true); calls.push(`execute:${input.actorId}`); return { ok: true as const, value: { restoreRunId: "restore", state: "RESTORED" } }; }),
    operationLock: {
      acquireOperationLock: vi.fn(async () => { held = true; calls.push("lock"); return { ok: true as const, value: { siteId: "site", operationKind: "restore", acquiredAt: "now" } }; }),
      releaseOperationLock: vi.fn(async () => { calls.push("release"); held = false; }),
    }, isOperationInFlight: () => held,
    describe: () => ({ toolId: "backup_execute_restore", errorCode: "RECOVERY", title: "restore", details: [], warning: "replace", danger: true, confirmLabel: "restore" }),
    confirmedRestore: required => {
      const surfaceExchanges = required.surfaces.surfaceExchanges;
      return humanConfirmedHandler({
        prepare: required.prepare,
        askHuman: async ({ prepared }, options) => {
          required.describe(prepared);
          return surfaceExchanges && options?.emitSurface ? { confirmed: true } : { confirmed: false, result: { restored: false } };
        },
        run: required.run,
      });
    },
  };
  return { deps, surfaces, host, calls };
}

test("restore plans as agent, confirms as human, and executes under shared lock as agent", async () => {
  const f = fixture();
  const execute = vi.spyOn(orchestrator, "executeRestore");
  const registration = buildRecoveryRegistrations(f).find(row => row.descriptor.id === "backup_execute_restore");
  if (!registration) throw new Error("restore missing");
  expect(await registration.handler(ctx, { emitSurface: vi.fn() })).toMatchObject({ restored: true, restoreRunId: "restore" });
  expect(f.calls).toEqual(["authorize", "plan:human:agent", "confirm:human:user", "lock", "execute:human", "release"]);
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ input: { principalId: "human", principalKind: "agent", confirmationToken: "token", siteId: "site", delegatedByPrincipalId: "human" } }));
});

test("the card's point and plan pair reach confirm and execution unchanged", async () => {
  const f = fixture();
  const registration = buildRecoveryRegistrations(f).find(row => row.descriptor.id === "backup_execute_restore");
  if (!registration) throw new Error("restore missing");
  await registration.handler(ctx, { emitSurface: vi.fn() });
  expect(f.host.confirm).toHaveBeenCalledWith(expect.objectContaining({ actorId: "human", restorePointId: "point", planId: "plan", planHash: "hash", signal: ctx.signal }));
  expect(f.host.execute).toHaveBeenCalledWith(expect.objectContaining({ actorId: "human", restorePointId: "point", confirmationToken: "token", signal: ctx.signal }));
});

test("no bound human surface means no restore", async () => {
  const f = fixture();
  expect(() => Reflect.apply(buildRecoveryRegistrations, undefined, [{ deps: f.deps, host: f.host }])).toThrow();
  const registration = buildRecoveryRegistrations(f).find(row => row.descriptor.id === "backup_execute_restore");
  if (!registration) throw new Error("restore missing");
  expect(await registration.handler(ctx)).toEqual({ restored: false });
  expect(f.host.confirm).not.toHaveBeenCalled();
  expect(f.host.execute).not.toHaveBeenCalled();
});

test("denied plan cannot reach the unavailable-capability branch", async () => {
  const f = fixture();
  f.host.authorize = vi.fn(async () => { throw new Error("denied"); });
  const registration = buildRecoveryRegistrations(f).find(row => row.descriptor.id === "backup_plan_restore");
  if (!registration) throw new Error("plan missing");
  await expect(registration.handler(ctx)).rejects.toThrow("denied");
  expect(f.deps.dbOps.getCapabilities).not.toHaveBeenCalled();
  expect(f.host.plan).not.toHaveBeenCalled();
});

test("a malformed internal confirm result must not proceed to execute", async () => {
  const f = fixture();
  // Deliberately the wrong result shape: the registration must reject it at runtime.
  f.host.confirm = vi.fn(async () => ({ ok: true, value: { token: "wrong-field" } })) as unknown as typeof f.host.confirm;
  const registration = buildRecoveryRegistrations(f).find(row => row.descriptor.id === "backup_execute_restore");
  if (!registration) throw new Error("restore missing");
  await expect(registration.handler(ctx, { emitSurface: vi.fn() })).rejects.toThrow();
  expect(f.host.execute).not.toHaveBeenCalled();
  expect(f.host.operationLock.acquireOperationLock).not.toHaveBeenCalled();
});

test("Recovery never registers restore-point creation", () => {
  expect(buildRecoveryRegistrations(fixture()).map(row => row.descriptor.id)).not.toContain("backup_create_restore_point");
});
