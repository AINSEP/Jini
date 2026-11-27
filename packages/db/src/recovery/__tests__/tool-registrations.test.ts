import { afterEach, expect, test, vi } from "vitest";
import { toolMetadata } from "@jini-ai/core/tool-metadata/recovery";
import { humanConfirmedHandler, ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
import { createRecoveryAgentToolCatalog } from "../agent-tools.js";
import { InMemoryRestorePointsRepo } from "../../site/repo.memory.js";
import * as orchestrator from "../recovery-orchestrator.js";
import type { buildRestoreHooks } from "../restore-hooks.js";
import { buildRecoveryRegistrations, contributeRecoveryTools, type RecoveryToolDeps, type RecoveryToolHost } from "../tool-registrations.js";

const ctx: ToolExecutionContext = { executionId: "execution", principal: { id: "human" }, run: { id: "run" }, signal: new AbortController().signal, input: { restorePointId: "point" } };
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const calls: string[] = [];
  let held = false;
  const deps: RecoveryToolDeps = { workspaceId: "site", clock: { nowMs: () => 0 }, authorize: vi.fn(),
    dbOps: { getCapabilities: vi.fn().mockResolvedValue({ restorePoint: { costClass: "cheap", kind: "snapshot" } }) },
    restorePointsRepo: { list: vi.fn().mockResolvedValue([{ id: "point", createdAt: "now" }]) },
    siteStatusRepo: { get: vi.fn() }, disclosureWatermarkSource: { getBaseline: vi.fn().mockResolvedValue({ available: false }), getCategoryCounts: vi.fn().mockResolvedValue({}) },
    deepLinkRestorePointLookup: { findRestorePointById: vi.fn() },
  };
  const surfaces = { surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: vi.fn() } };
  const host: RecoveryToolHost<RecoveryToolDeps> = {
    refuseUnexpectedKeys: vi.fn(), buildRestoreHooks: vi.fn(() => ({} as ReturnType<typeof buildRestoreHooks>)),
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

test("malformed deep-link input refuses before lookup and authorization precedes a valid lookup", async () => {
  const f = fixture();
  const registration = buildRecoveryRegistrations(f).find(row => row.descriptor.id === "recovery_resolve_deep_link")!;
  await expect(registration.handler({ ...ctx, input: { envelope: { v: "invalid" } } })).rejects.toThrow();
  expect(f.deps.deepLinkRestorePointLookup.findRestorePointById).not.toHaveBeenCalled();
  f.host.authorize = vi.fn(async () => { throw new Error("denied"); });
  await expect(registration.handler({ ...ctx, input: { envelope: { v: 1, correlationId: "correlation", siteId: "site", restorePointId: "point", ledgerEventId: null, drift: "none", intent: "restore", issuedAt: "now" } } })).rejects.toThrow("denied");
  expect(f.host.authorize).toHaveBeenCalled();
  expect(f.deps.deepLinkRestorePointLookup.findRestorePointById).not.toHaveBeenCalled();
});


test("the prepared restore preserves the gateway plan and an undefined createdAt property", async () => {
  const f = fixture();
  const plan = { planId: "plan", planHash: "hash", extra: "gateway-field" };
  f.host.plan = vi.fn(async () => ({ ok: true as const, value: plan }));
  f.deps.restorePointsRepo.list = vi.fn(async () => []);
  let prepared: unknown;
  const describe = f.host.describe;
  f.host.describe = value => { prepared = value; return describe(value); };
  await buildRecoveryRegistrations(f).find(row => row.descriptor.id === "backup_execute_restore")!.handler(ctx, { emitSurface: vi.fn() });
  expect(prepared).toEqual({ restorePointId: "point", plan, createdAt: undefined });
  expect((prepared as { plan: unknown }).plan).toBe(plan);
  expect(Object.hasOwn(prepared as object, "createdAt")).toBe(true);
});

function registered(f: ReturnType<typeof fixture>, id: string) {
  const row = contributeRecoveryTools({ host: f.host }).build(f.deps, f.surfaces).find(candidate => candidate.descriptor.id === id);
  if (!row) throw new Error(`missing tool ${id}`);
  return row.handler;
}

const noInput: ToolExecutionContext = { ...ctx, input: undefined };

test("Recovery lists authorized persisted restore points and reports injected capability guidance", async () => {
  const f = fixture();
  const points = new InMemoryRestorePointsRepo();
  await points.save({ restorePointId: "ready", idempotencyKey: "key", trigger: "manual", createdBy: "operator", createdAt: "2026-10-01T00:00:00Z" });
  f.deps.restorePointsRepo = points;
  f.deps.dbOps.getCapabilities = vi.fn(async () => ({ restorePoint: { costClass: "expensive" as const, kind: "logical-dump" as const } }));
  expect(await registered(f, "backup_list_restore_points")(noInput)).toEqual({ items: [
    { id: "ready", trigger: "manual", costClass: "cheap", kind: "file-snapshot", watermarkAtCapture: null, createdAt: "2026-10-01T00:00:00Z", artifactRef: "memory://restore-point/ready" },
  ] });
  expect(await registered(f, "backup_get_capabilities")(noInput)).toEqual({
    costClass: "expensive", kind: "logical-dump",
    fullSiteBackup: { discoveryTool: "discover", planTool: "plan", pushTool: "push", guidance: "backup" },
    portableExport: { href: "/export", guidance: "export" },
  });
  const permission = { deps: f.deps, ctx: noInput, permission: "read", entityType: "restore-point" };
  expect(vi.mocked(f.host.authorize).mock.calls).toEqual([[permission], [permission]]);
});

test.each([
  { status: "SERVING", banner: "operation-in-flight" },
  { status: "PENDING_MIGRATION", banner: "pending-migration" },
  { status: "BLOCKED_PENDING_RECOVERY", banner: "migration-interrupted" },
] as const)("status for $status reads the site's lock and reports $banner", async ({ status, banner }) => {
  const f = fixture();
  f.deps.siteStatusRepo.get = vi.fn(async () => status);
  f.host.isOperationInFlight = vi.fn(() => true);
  expect(await registered(f, "recovery_get_status")(noInput)).toMatchObject({ costClass: "cheap", banner: { kind: banner } });
  expect(vi.mocked(f.host.authorize).mock.calls).toEqual([[{ deps: f.deps, ctx: noInput, permission: "read", entityType: "restore-point" }]]);
  expect(vi.mocked(f.deps.siteStatusRepo.get).mock.calls).toEqual([["site"]]);
  expect(vi.mocked(f.host.isOperationInFlight).mock.calls).toEqual([[{ siteId: "site" }, {}]]);
  expect(f.host.operationLock.acquireOperationLock).not.toHaveBeenCalled();
});

const envelope = { v: 1, correlationId: "corr", siteId: "site", ledgerEventId: "ledger-1", restorePointId: "saved-point",
  drift: "none", intent: "restore", issuedAt: "2026-10-01T00:00:00Z" };

test("deep-link resolution authorizes first, retrieves the captured point, and never trusts supplied metadata", async () => {
  const f = fixture();
  const stored = { restorePointId: "saved-point", capturedAt: "2026-09-29T10:00:00Z" };
  f.deps.deepLinkRestorePointLookup.findRestorePointById = vi.fn(async (id) => {
    f.calls.push(`lookup:${id}`);
    return id === "saved-point" ? stored : null;
  });
  const resolve = registered(f, "recovery_resolve_deep_link");
  const request = { ...noInput, input: { envelope } };
  expect(await resolve(request)).toEqual({ found: true, restorePoint: stored });
  expect(f.calls).toEqual(["authorize", "lookup:saved-point"]);
  expect(vi.mocked(f.host.authorize).mock.calls[0]).toEqual([{ deps: f.deps, ctx: request, permission: "read", entityType: "restore-point" }]);
  expect(await resolve({ ...noInput, input: { envelope: { ...envelope, ledgerEventId: null, restorePointId: null } } })).toEqual({ found: false, restorePoint: null });
  expect(vi.mocked(f.deps.deepLinkRestorePointLookup.findRestorePointById).mock.calls).toEqual([["saved-point"]]);
});

test.each([
  { input: [], message: "'envelope' (object) is required" },
  { input: { envelope: null }, message: "'envelope' (object) is required" },
  { input: { envelope: { ...envelope, v: "1" } }, message: "'envelope.v' (number) is required" },
  { input: { envelope: { ...envelope, siteId: 99 } }, message: "'envelope.siteId' (string) is required" },
  { input: { envelope: { ...envelope, restorePointId: 99 } }, message: "'envelope.restorePointId' must be a string or null" },
])("invalid deep link refuses before authorization or lookup ($message)", async ({ input, message }) => {
  const f = fixture();
  const rejected = registered(f, "recovery_resolve_deep_link")({ ...noInput, input });
  await expect(rejected).rejects.toBeInstanceOf(ToolInputError);
  await expect(rejected).rejects.toThrow(message);
  expect(f.host.authorize).not.toHaveBeenCalled();
  expect(f.deps.deepLinkRestorePointLookup.findRestorePointById).not.toHaveBeenCalled();
});

test("restore planning returns the plan with only covered discarded-write counts", async () => {
  const f = fixture();
  f.host.coveredCategories = ["posts", "pages"];
  f.deps.disclosureWatermarkSource = {
    getBaseline: async () => ({ available: true, watermarkAtCapture: 4 }),
    getCategoryCounts: async () => ({ posts: 5, excluded: 99 }),
  };
  expect(await registered(f, "backup_plan_restore")(ctx)).toEqual({
    plan: { planId: "plan", planHash: "hash" }, disclosure: { partial: true, watermarkBaselineAvailable: true, counts: { posts: 5, pages: 0 } },
  });
  expect(vi.mocked(f.host.plan).mock.calls).toEqual([[{ deps: f.deps, actorId: "human", restorePointId: "point", principalKind: "agent" }]]);
  expect(f.calls).toEqual(["authorize", "plan:human:agent"]);
});

test.each([{ code: "REFUSED" }, { code: "REFUSED", message: "The plan expired" }])(
  "restore planning surfaces the gateway diagnostic $code ($message) without calculating disclosure",
  async error => {
    const f = fixture();
    f.host.plan = vi.fn(async () => ({ ok: false as const, error }));
    await expect(registered(f, "backup_plan_restore")(ctx)).rejects.toThrow(error.message ?? error.code);
    expect(f.deps.disclosureWatermarkSource.getBaseline).not.toHaveBeenCalled();
    expect(f.host.confirm).not.toHaveBeenCalled();
  },
);

test.each([{ code: "TOKEN_DENIED" }, { code: "TOKEN_DENIED", message: "The confirmation was not accepted" }])(
  "a failed confirmation surfaces its diagnostic $code ($message) without acquiring the lock",
  async error => {
    const f = fixture();
    f.host.confirm = vi.fn(async () => ({ ok: false as const, error }));
    await expect(registered(f, "backup_execute_restore")(ctx, { emitSurface: vi.fn() })).rejects.toThrow(error.message ?? error.code);
    expect(f.host.operationLock.acquireOperationLock).not.toHaveBeenCalled();
    expect(f.host.execute).not.toHaveBeenCalled();
  },
);

test.each([{ code: "RESTORE_REJECTED" }, { code: "RESTORE_REJECTED", message: "The snapshot cannot be read" }])(
  "a failed execute surfaces its diagnostic $code ($message) and releases the shared lock",
  async error => {
    const f = fixture();
    f.host.execute = vi.fn(async () => { f.calls.push("failed execution"); return { ok: false as const, error }; });
    await expect(registered(f, "backup_execute_restore")(ctx, { emitSurface: vi.fn() })).rejects.toThrow(error.message ?? error.code);
    expect(f.calls).toEqual(["authorize", "plan:human:agent", "confirm:human:user", "lock", "failed execution", "release"]);
    expect(vi.mocked(f.host.operationLock.releaseOperationLock).mock.calls).toEqual([[
      { deps: { clock: f.deps.clock }, input: { siteId: "site", handle: { siteId: "site", operationKind: "restore", acquiredAt: "now" } } },
    ]]);
  },
);
