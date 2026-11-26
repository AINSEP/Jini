import assert from 'node:assert/strict';
import { test } from 'vitest';
import { getDatabaseAgentToolCatalog, defaultDbMessages } from '../../tools/index.js';
import { buildDatabaseRegistrations, type DatabaseToolDeps } from '../tool-registrations.js';

function fixture(confirmed: boolean, costClass = 'cheap') {
  const order: string[] = []; const confirmedAs: unknown[] = []; const executedAs: unknown[] = []; let locked = false;
  const deps = { workspaceId: 'ws', clock: { nowMs: () => 0 }, idGen: { newId: () => 'id' }, gatedMutations: { gatewayDeps: {} },
    authorize: async () => ({ allowed: true, reason: 'fixture' }), adaptLegacyAuthorize: ({ authorize }: { authorize: unknown }) => authorize,
    catalog: getDatabaseAgentToolCatalog({}), messages: defaultDbMessages,
    migrateForwardDialog: { errorCode: 'DATABASE', title: 'Update?', details: [], confirmLabel: 'Update' },
    surfaces: {}, refuseUnexpectedKeys: () => {}, mutationActor: ({ principalId }: { principalId: string }) => ({ id: principalId, kind: 'agent' }),
    buildMigrateForwardHooks: () => ({}),
    gatewayPlan: async () => { order.push('plan'); return { planId: 'plan', planHash: 'hash', details: { costClass } }; },
    gatewayConfirm: async (input: unknown) => { confirmedAs.push(input); order.push('confirm'); return { confirmationToken: 'token' }; },
    gatewayExecute: async (input: unknown) => { assert.equal(locked, true); executedAs.push(input); order.push('restore-point', 'execute'); return { migrated: true }; },
    operationLock: { acquireOperationLock: async () => { order.push('lock'); locked = true; return { ok: true, value: { siteId: 'ws', operationKind: 'migration', acquiredAt: 'now' } }; }, releaseOperationLock: async () => { order.push('unlock'); locked = false; } },
    humanConfirmedToolHandler: (_surfaces: unknown, steps: { prepare(input: { ctx: unknown }): Promise<unknown>; run(input: { ctx: unknown; prepared: unknown; confirmer: { id: string; kind: 'user' } }): Promise<unknown> }) => async (ctx: unknown) => {
      const prepared = await steps.prepare({ ctx });
      if (!confirmed) return { migrated: false };
      return steps.run({ ctx, prepared, confirmer: { id: 'human', kind: 'user' } });
    },
  } as unknown as DatabaseToolDeps;
  const tool = buildDatabaseRegistrations(deps).find(tool => tool.descriptor.id === 'database_execute_migrate_forward')!;
  const call = () => tool.handler({ executionId: 'exec', principal: { id: 'agent' }, run: { id: 'run' }, input: {}, signal: new AbortController().signal });
  return { call, order, confirmedAs, executedAs };
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
  assert.equal((f.confirmedAs[0] as { principalId: string }).principalId, 'human');
  assert.equal((f.confirmedAs[0] as { principalKind: string }).principalKind, 'user');
  assert.equal((f.executedAs[0] as { confirmationToken: string }).confirmationToken, 'token');
  assert.equal((f.executedAs[0] as { principalId: string }).principalId, 'agent');
  assert.deepEqual(f.order, ['plan', 'confirm', 'lock', 'restore-point', 'execute', 'unlock']);
});
