import { afterEach, expect, test, vi } from "vitest";
import { toolMetadata } from "@jini-ai/core/tool-metadata/recovery";
import { humanConfirmedHandler, type ToolExecutionContext } from "@jini-ai/core";
import { createRecoveryAgentToolCatalog } from "../agent-tools.js";
import type { GatewayDeps, plan as planGateway, confirm as confirmGateway, execute as executeGateway } from "@jini-ai/core/gated-mutations";
import type { buildRestoreHooks as restoreHooks } from "../restore-hooks.js";
import { toRecoveryResult } from "../restore-hooks.js";
import * as orchestrator from "../recovery-orchestrator.js";
import { bindRecoveryTools, type RecoveryToolDeps, type RecoveryToolHost } from "../tool-registrations.js";

const ctx: ToolExecutionContext = { executionId: "execution", principal: { id: "human" }, run: { id: "run" }, signal: new AbortController().signal, input: { restorePointId: "point" } };
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const calls: string[] = [];
  const dialogs: unknown[] = [];
  let held = false;
  const deps: RecoveryToolDeps = { workspaceId: "site", clock: { nowMs: () => 0 }, authorize: vi.fn(),
    dbOps: { getCapabilities: vi.fn().mockResolvedValue({ restorePoint: { costClass: "cheap", kind: "snapshot" } }) },
    restorePointsRepo: { list: vi.fn().mockResolvedValue([{ id: "point", createdAt: "now" }]) },
    siteStatusRepo: { get: vi.fn() }, disclosureWatermarkSource: { getBaseline: vi.fn().mockResolvedValue({ available: false }), getCategoryCounts: vi.fn().mockResolvedValue({}) },
    deepLinkRestorePointLookup: { findRestorePointById: vi.fn() },
  };
  const surfaces = { surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: vi.fn() } };
  const hooks = {} as ReturnType<typeof restoreHooks>;
  const host: Omit<RecoveryToolHost<RecoveryToolDeps>, "plan" | "confirm" | "execute" | "buildRestoreHooks" | "describe"> = {
    refuseUnexpectedKeys: vi.fn(),
    catalog: createRecoveryAgentToolCatalog({ backupWorkflowGuidance: "backup", restorePointIdSource: "list" }), metadata: toolMetadata, catalogModule: "host/recovery", readPermission: "read", restorePermission: "restore", coveredCategories: [],
    capabilityGuidance: { fullSiteBackup: { discoveryTool: "discover", planTool: "plan", pushTool: "push", guidance: "backup" }, portableExport: { href: "/export", guidance: "export" } },
    authorize: vi.fn(async () => { calls.push("authorize"); }),
    operationLock: {
      acquireOperationLock: vi.fn(async () => { held = true; calls.push("lock"); return { ok: true as const, value: { siteId: "site", operationKind: "restore", acquiredAt: "now" } }; }),
      releaseOperationLock: vi.fn(async () => { calls.push("release"); held = false; }),
    }, isOperationInFlight: () => held,
    confirmedRestore: required => {
      const surfaceExchanges = required.surfaces.surfaceExchanges;
      return humanConfirmedHandler({
        prepare: required.prepare,
        askHuman: async ({ prepared }, options) => {
          dialogs.push(required.describe(prepared));
          return surfaceExchanges && options?.emitSurface ? { confirmed: true } : { confirmed: false, result: { restored: false } };
        },
        run: required.run,
      });
    },
  };
  const boundDeps = { ...deps, idGen: { newId: () => "id" }, databaseLedgerRepo: {} as never,
    migrationRunsRepo: {} as never, siteStatusRepo: { ...deps.siteStatusRepo, set: vi.fn() },
    dbOps: { ...deps.dbOps, restoreFromArtifact: vi.fn() }, gatedMutations: { gatewayDeps: {} as GatewayDeps } };
  const gatewayPlan = vi.fn(async (input: Parameters<typeof planGateway>[0]) => { calls.push(`plan:${input.principalId}:${input.principalKind}`); return { domain: "backup.restore", planId: "plan", planHash: "hash", details: {} }; });
  const gatewayConfirm = vi.fn(async (input: Parameters<typeof confirmGateway>[0]) => { calls.push(`confirm:${input.principalId}:${input.principalKind}`); return { confirmationToken: "token" } as never; });
  const gatewayExecute = vi.fn(async (input: Parameters<typeof executeGateway>[0]) => { expect(held).toBe(true); calls.push(`execute:${input.principalId}`); return { restoreRunId: "restore", state: "RESTORED", restartRequired: false }; });
  const buildRestoreHooks = vi.fn(() => hooks);
  const binding = bindRecoveryTools<typeof boundDeps>({ ...host, authorize: input => host.authorize(input), buildRestoreHooks, gatewayPlan, gatewayConfirm, gatewayExecute, toRecoveryResult,
    dialog: { errorCode: "RECOVERY", title: "Restore the site's data?", restorePointLabel: "Restore point",
      warning: "Your current data will be replaced with this restore point. Anything changed since then is lost. No restore point is taken first, so this can't be undone.", confirmLabel: "Replace current data" },
    humanConfirmedToolHandler: (surfaceDeps, spec) => host.confirmedRestore({ surfaces: surfaceDeps, prepare: spec.prepare, describe: spec.dialog, run: spec.run }),
  });
  return { deps: boundDeps, surfaces, host, calls, binding, buildRestoreHooks, gatewayPlan, gatewayConfirm, gatewayExecute, dialogs };
}

test("restore plans as agent, confirms as human, and executes under shared lock as agent", async () => {
  const f = fixture();
  const execute = vi.spyOn(orchestrator, "executeRestore");
  const registration = f.binding.buildRecoveryRegistrations(f.deps, f.surfaces).find(row => row.descriptor.id === "backup_execute_restore");
  if (!registration) throw new Error("restore missing");
  expect(await registration.handler(ctx, { emitSurface: vi.fn() })).toMatchObject({ restored: true, restoreRunId: "restore" });
  expect(f.calls).toEqual(["authorize", "plan:human:agent", "confirm:human:user", "lock", "execute:human", "release"]);
  expect(f.buildRestoreHooks).toHaveBeenCalledTimes(2);
  expect(f.dialogs).toEqual([{ toolId: "backup_execute_restore", errorCode: "RECOVERY", title: "Restore the site's data?",
    details: [{ label: "Restore point", value: "point (now)" }],
    warning: "Your current data will be replaced with this restore point. Anything changed since then is lost. No restore point is taken first, so this can't be undone.", danger: true, confirmLabel: "Replace current data" }]);
  expect(f.gatewayConfirm).toHaveBeenCalledWith(expect.objectContaining({ principalId: "human", principalKind: "user", planId: "plan", planHash: "hash", signal: ctx.signal }));
  expect(f.gatewayExecute).toHaveBeenCalledWith(expect.objectContaining({ principalId: "human", principalKind: "agent", confirmationToken: "token", signal: ctx.signal }));
  expect(f.gatewayConfirm.mock.calls[0]![0].hooks).toBe(f.gatewayExecute.mock.calls[0]![0].hooks);
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ input: { principalId: "human", principalKind: "agent", confirmationToken: "token", siteId: "site", delegatedByPrincipalId: "human" } }));
});

test("no bound human surface means no restore", async () => {
  const f = fixture();
  expect(() => Reflect.apply(f.binding.buildRecoveryRegistrations, undefined, [f.deps])).toThrow();
  const registration = f.binding.buildRecoveryRegistrations(f.deps, f.surfaces).find(row => row.descriptor.id === "backup_execute_restore");
  if (!registration) throw new Error("restore missing");
  expect(await registration.handler(ctx)).toEqual({ restored: false });
  expect(f.gatewayConfirm).not.toHaveBeenCalled();
  expect(f.gatewayExecute).not.toHaveBeenCalled();
});

test("denied plan cannot reach the unavailable-capability branch", async () => {
  const f = fixture();
  f.host.authorize = vi.fn(async () => { throw new Error("denied"); });
  const registration = f.binding.buildRecoveryRegistrations(f.deps, f.surfaces).find(row => row.descriptor.id === "backup_plan_restore");
  if (!registration) throw new Error("plan missing");
  await expect(registration.handler(ctx)).rejects.toThrow("denied");
  expect(f.deps.dbOps.getCapabilities).not.toHaveBeenCalled();
  expect(f.gatewayPlan).not.toHaveBeenCalled();
});

test("malformed deep-link input refuses before lookup and authorization precedes a valid lookup", async () => {
  const f = fixture();
  const registration = f.binding.buildRecoveryRegistrations(f.deps, f.surfaces).find(row => row.descriptor.id === "recovery_resolve_deep_link")!;
  await expect(registration.handler({ ...ctx, input: { envelope: { v: "invalid" } } })).rejects.toThrow();
  expect(f.deps.deepLinkRestorePointLookup.findRestorePointById).not.toHaveBeenCalled();
  f.host.authorize = vi.fn(async () => { throw new Error("denied"); });
  await expect(registration.handler({ ...ctx, input: { envelope: { v: 1, correlationId: "correlation", siteId: "site", restorePointId: "point", ledgerEventId: null, drift: "none", intent: "restore", issuedAt: "now" } } })).rejects.toThrow("denied");
  expect(f.host.authorize).toHaveBeenCalled();
  expect(f.deps.deepLinkRestorePointLookup.findRestorePointById).not.toHaveBeenCalled();
});


test("an unknown restore point is refused before capability or plan work", async () => {
  const f = fixture();
  f.deps.restorePointsRepo.list = vi.fn(async () => []);
  const registration = f.binding.buildRecoveryRegistrations(f.deps, f.surfaces).find(row => row.descriptor.id === "backup_plan_restore")!;
  await expect(registration.handler(ctx)).rejects.toThrow("restore point 'point' was not found");
  expect(f.deps.dbOps.getCapabilities).not.toHaveBeenCalled();
  expect(f.gatewayPlan).not.toHaveBeenCalled();
});
