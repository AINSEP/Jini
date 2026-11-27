import { executeMigrateForward } from "../../recovery/migrate-forward-execute.js";
import assert from 'node:assert/strict';
import { expect, test, vi } from 'vitest';
import { adaptLegacyAuthorize, humanConfirmedHandler, ToolInputError, ToolPermissionDeniedError, type ToolExecutionContext } from '@jini-ai/core';
import { InMemoryDatabaseIntrospectionAdapter, InMemoryDatabaseLedgerRepo, InMemoryDbOpsAdapter, InMemoryRestorePointsRepo } from '../repo.memory.js';
import { createDatabaseReadTools, getDatabaseAgentToolCatalog, defaultDbMessages } from '../../tools/index.js';
import { buildDatabaseRegistrations, contributeDatabaseTools, type DatabaseToolDeps } from '../tool-registrations.js';

function fixture(confirmed: boolean, costClass = 'cheap') {
  const order: string[] = []; const confirmedAs: unknown[] = []; const executedAs: unknown[] = []; let locked = false;
  const deps = { createDatabaseReadTools, executeMigrateForward, workspaceId: 'ws', clock: { nowMs: () => 0 }, idGen: { newId: () => 'id' }, gatedMutations: { gatewayDeps: {} },
    authorize: async () => ({ allowed: true, reason: 'fixture' }), adaptLegacyAuthorize: ({ authorize }: { authorize: unknown }) => authorize,
    catalog: getDatabaseAgentToolCatalog({}), messages: defaultDbMessages,
    migrateForwardDialog: { errorCode: 'DATABASE', title: 'Update?', details: [], confirmLabel: 'Update' },
    surfaces: {}, refuseUnexpectedKeys: () => {}, mutationActor: ({ principalId }: { principalId: string }) => ({ id: principalId, kind: 'agent' }),
    buildMigrateForwardHooks: () => ({}),
    gatewayPlan: async () => { order.push('plan'); return { planId: 'plan', planHash: 'hash', details: { costClass } }; },
    gatewayConfirm: async (input: unknown) => { confirmedAs.push(input); order.push('confirm'); return { confirmationToken: 'token' }; },
    gatewayExecute: async (input: unknown) => { assert.equal(locked, true); executedAs.push(input); order.push('restore-point', 'execute'); return { migrated: true }; },
    operationLock: { acquireOperationLock: async () => { order.push('lock'); locked = true; return { ok: true, value: { siteId: 'ws', operationKind: 'migration', acquiredAt: 'now' } }; }, releaseOperationLock: async () => { order.push('unlock'); locked = false; } },
    // core refuses to wire a confirmer-must-equal-own-delegatedBy tool unless its handler comes from
    // humanConfirmedHandler, so the host fake builds it there and only stands in for the human's answer.
    humanConfirmedToolHandler: (_surfaces: unknown, steps: { prepare(input: { ctx: ToolExecutionContext }): Promise<unknown>; run(input: { ctx: ToolExecutionContext; prepared: unknown; confirmer: { id: string; kind: 'user' } }): Promise<unknown> }) => humanConfirmedHandler({
      prepare: steps.prepare,
      askHuman: async () => (confirmed ? { confirmed: true } : { confirmed: false, result: { migrated: false } }),
      run: steps.run,
    }),
  } as unknown as DatabaseToolDeps;
  const tool = buildDatabaseRegistrations(deps).find(tool => tool.descriptor.id === 'database_execute_migrate_forward')!;
  const call = () => tool.handler({ executionId: 'exec', principal: { id: 'agent' }, run: { id: 'run' }, input: {}, signal: new AbortController().signal });
  return { call, order, confirmedAs, executedAs, deps };
}

test('no human click never confirms or executes', async () => {
  const f = fixture(false); assert.deepEqual(await f.call(), { migrated: false });
  assert.deepEqual(f.order, ['plan']); assert.deepEqual(f.confirmedAs, []); assert.deepEqual(f.executedAs, []);
});
test('a refused restore-point plan never executes', async () => {
  const f = fixture(true, 'unavailable'); await assert.rejects(f.call(), /DATABASE_RESTORE_POINT_UNAVAILABLE/);
  assert.deepEqual(f.order, ['plan']); assert.deepEqual(f.confirmedAs, []); assert.deepEqual(f.executedAs, []);
});
test('confirmation belongs to the human and execution to the agent inside the operation lock', async () => {
  const f = fixture(true); assert.deepEqual(await f.call(), { migrated: true });
  // The confirmer is the run's own delegating principal (humanConfirmedHandler), confirming as a user.
  assert.equal((f.confirmedAs[0] as { principalId: string }).principalId, 'agent');
  assert.equal((f.confirmedAs[0] as { principalKind: string }).principalKind, 'user');
  assert.equal((f.executedAs[0] as { confirmationToken: string }).confirmationToken, 'token');
  assert.equal((f.executedAs[0] as { principalId: string }).principalId, 'agent');
  assert.equal((f.executedAs[0] as { principalKind: string }).principalKind, 'agent');
  assert.deepEqual(f.order, ['plan', 'confirm', 'lock', 'restore-point', 'execute', 'unlock']);
});

test('planning uses the agent identity and exact host ports, rejects extra input, and performs no confirmation', async () => {
  const f = fixture(false);
  const buildMigrateForwardHooks = vi.fn(f.deps.buildMigrateForwardHooks);
  const gatewayPlan = vi.fn(f.deps.gatewayPlan);
  const authorize = vi.fn(f.deps.authorize);
  const actor = { id: 'agent', kind: 'agent' } as const;
  const mutationActor = vi.fn<DatabaseToolDeps['mutationActor']>(() => actor);
  const deps = { ...f.deps, buildMigrateForwardHooks, gatewayPlan, authorize, mutationActor,
    databaseLedgerRepo: new InMemoryDatabaseLedgerRepo(), restorePointsRepo: new InMemoryRestorePointsRepo(),
    dbOps: new InMemoryDbOpsAdapter(), databaseIntrospection: new InMemoryDatabaseIntrospectionAdapter() };
  const call = bind(deps, 'database_plan_migrate_forward');
  const malformed = call({ unsafe: 1 });
  await expect(malformed).rejects.toBeInstanceOf(ToolInputError);
  await expect(malformed).rejects.toThrow("this tool accepts no input — omit 'input' or pass {}");
  expect(buildMigrateForwardHooks.mock.calls).toEqual([]);
  expect(gatewayPlan.mock.calls).toEqual([]);
  expect(await call(undefined)).toEqual({ planId: 'plan', planHash: 'hash', details: { costClass: 'cheap' } });
  expect(mutationActor.mock.calls).toEqual([[{ principalId: 'agent' }]]);
  expect(buildMigrateForwardHooks.mock.calls).toEqual([[{
    workspaceId: 'ws', actor, clock: deps.clock, idGen: deps.idGen, dbOps: deps.dbOps,
    restorePointsRepo: deps.restorePointsRepo, databaseLedgerRepo: deps.databaseLedgerRepo,
  }]]);
  expect(gatewayPlan.mock.calls).toEqual([[{ deps: deps.gatedMutations.gatewayDeps, principalId: 'agent', principalKind: 'agent', hooks: {} }]]);
  expect(authorize.mock.calls).toEqual([]);
  expect(f.confirmedAs).toEqual([]);
  expect(f.executedAs).toEqual([]);
});

test('the human confirmation layer receives the migration-specific dialog and validated empty input', async () => {
  const f = fixture(false);
  const dialogs: unknown[] = [];
  const refuseUnexpectedKeys = vi.fn<DatabaseToolDeps['refuseUnexpectedKeys']>((input, allowed) => {
    if (Object.keys(input).some(key => !allowed.includes(key))) throw new ToolInputError({ message: 'unexpected migration input' });
  });
  const deps: DatabaseToolDeps = {
    ...f.deps, refuseUnexpectedKeys,
    humanConfirmedToolHandler: (surfaces, steps) => {
      assert.equal(surfaces, f.deps.surfaces);
      assert.equal(steps.flag, 'migrated');
      return humanConfirmedHandler({
        prepare: steps.prepare,
        askHuman: async () => { dialogs.push(steps.dialog()); return { confirmed: false, result: { migrated: false } }; },
        run: steps.run,
      });
    },
  };
  const call = bind(deps, 'database_execute_migrate_forward');
  await expect(call({ unsafe: 1 })).rejects.toThrow('unexpected migration input');
  await expect(call('not-an-object')).rejects.toBeInstanceOf(ToolInputError);
  expect(f.order).toEqual([]);
  expect(await call(undefined)).toEqual({ migrated: false });
  expect(refuseUnexpectedKeys.mock.calls).toEqual([[{ unsafe: 1 }, []], [{}, []]]);
  expect(dialogs).toEqual([{ toolId: 'database_execute_migrate_forward', errorCode: 'DATABASE', title: 'Update?', details: [], confirmLabel: 'Update' }]);
  expect(f.order).toEqual(['plan']);
  expect(f.confirmedAs).toEqual([]);
});

test('contributed database tools validate filters and authorize the right entity before returning site data', async () => {
  const f = fixture(false);
  const ledger = new InMemoryDatabaseLedgerRepo();
  const restorePoints = new InMemoryRestorePointsRepo();
  const row = { id: 'ledger-1', kind: 'restore', outcome: 'ok', createdAt: '2026-10-01T00:00:00Z', restorePointId: 'point' };
  await ledger.append(row);
  const authorize = vi.fn<DatabaseToolDeps['authorize']>(async () => ({ allowed: true, reason: 'fixture' }));
  const deps: DatabaseToolDeps = { ...f.deps, authorize, adaptLegacyAuthorize, databaseLedgerRepo: ledger,
    restorePointsRepo: restorePoints, dbOps: new InMemoryDbOpsAdapter(), databaseIntrospection: new InMemoryDatabaseIntrospectionAdapter() };
  const timeline = bind(deps, 'database_query_timeline');
  await expect(timeline('not-an-object')).rejects.toThrow('input must be an object');
  expect(authorize.mock.calls).toEqual([]);
  expect(await timeline({ kind: 'restore', outcome: 'ok', limit: 1 })).toEqual({ items: [row], nextCursor: null });
  expect(await timeline({ kind: 'migration', limit: 1 })).toEqual({ items: [], nextCursor: null });
  expect(await bind(deps, 'database_get_health')(undefined)).toEqual({ canOpenDb: true, migrationsTableReadable: true, driftStatus: 'in-sync' });
  expect(authorize.mock.calls).toEqual([
    [{ principalId: 'agent', permission: 'database.read', workspaceId: 'ws', entityType: 'database-ledger' }],
    [{ principalId: 'agent', permission: 'database.read', workspaceId: 'ws', entityType: 'database-ledger' }],
    [{ principalId: 'agent', permission: 'database.read', workspaceId: 'ws', entityType: 'database' }],
  ]);
});

test('the canonical capture handler uses host scope and persists a manual artifact only after authorization', async () => {
  const f = fixture(false);
  const restorePoints = new InMemoryRestorePointsRepo();
  const authorize = vi.fn<DatabaseToolDeps['authorize']>()
    .mockResolvedValueOnce({ allowed: false, reason: 'no-grant' }).mockResolvedValueOnce({ allowed: true, reason: 'fixture' });
  const dbOps = new InMemoryDbOpsAdapter();
  const capture = vi.spyOn(dbOps, 'captureRestorePoint');
  const deps = { ...f.deps, authorize, adaptLegacyAuthorize, dbOps, restorePointsRepo: restorePoints };
  const call = bind(deps, 'backup_create_restore_point');
  const denied = call({ costAck: true });
  await expect(denied).rejects.toBeInstanceOf(ToolPermissionDeniedError);
  await expect(denied).rejects.toMatchObject({
    message: "principal 'agent' is not authorized for 'backup.create' (no-grant)", permission: 'backup.create', reason: 'no-grant',
  });
  expect(capture.mock.calls).toEqual([]);
  expect(await restorePoints.list()).toEqual([]);
  const result = await call({ costAck: true, trigger: 'pre-migration' }) as { restorePoint: { id: string; costClass: string; kind: string } };
  expect(result).toEqual({ restorePoint: { id: expect.stringMatching(/^[0-9a-f-]{36}$/), costClass: 'cheap', kind: 'file-snapshot' } });
  expect(capture.mock.calls).toEqual([[{ scopeId: 'ws' }]]);
  expect(await restorePoints.findByIdempotencyKey('id')).toEqual({ idempotencyKey: 'id', restorePointId: result.restorePoint.id });
  expect(await restorePoints.list()).toEqual([{
    id: result.restorePoint.id, trigger: 'manual', createdAt: '1970-01-01T00:00:00.000Z',
    costClass: 'cheap', kind: 'file-snapshot', watermarkAtCapture: 1, artifactRef: 'memory://restore-point/ws/1',
  }]);
  expect(authorize.mock.calls).toEqual(Array.from({ length: 2 }, () => [
    { principalId: 'agent', permission: 'backup.create', workspaceId: 'ws', entityType: 'restore-point' },
  ]));
});

test('missing canonical capture in the host factory is rejected at registration time', () => {
  const f = fixture(false);
  const base = f.deps.createDatabaseReadTools;
  const withoutCapture: DatabaseToolDeps['createDatabaseReadTools'] = (...args) =>
    base(...args).filter(tool => tool.descriptor.id !== 'backup_create_restore_point');
  expect(() => buildDatabaseRegistrations({ ...f.deps, createDatabaseReadTools: withoutCapture }))
    .toThrow('Database tools have no backup restore point registration');
});

function bind(deps: DatabaseToolDeps, id: string) {
  const registrations = contributeDatabaseTools().build(deps, deps.surfaces);
  const registration = registrations.find(tool => tool.descriptor.id === id);
  if (!registration) throw new Error(`Missing database tool ${id}`);
  return (input: unknown) => registration.handler({
    executionId: 'exec', principal: { id: 'agent' }, run: { id: 'run' }, input, signal: new AbortController().signal,
  });
}
