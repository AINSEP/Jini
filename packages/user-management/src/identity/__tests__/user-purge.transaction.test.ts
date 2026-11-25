import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { DomainEvent } from '@jini-ai/core/contracts/events';
import { SqlUserPurge, type UserPurgeSqlPorts } from '../user-purge.js';

function fixture(failAudit = false) {
  const calls: string[] = [];
  let active = false;
  let rows = 8;
  const scope = (input: { workspaceId: string; principalId: string }) => {
    assert.equal(input.workspaceId, 'ws'); assert.equal(input.principalId, 'principal'); assert.equal(active, true);
  };
  const ports: UserPurgeSqlPorts = {
    async transaction({ run }) { calls.push('begin'); active = true; const before = rows; try { const value = await run(); calls.push('commit'); return value; } catch (error) { rows = before; calls.push('rollback'); throw error; } finally { active = false; } },
    async deleteCounted(input) { scope(input); calls.push(input.table); rows--; return calls.length - 1; },
    async deletePrincipalVault(input) { scope(input); calls.push('secrets_vault'); rows--; },
    async deleteIdentityUser(input) { scope(input); calls.push('identity_users'); rows--; },
    async deletePrincipal(input) { scope(input); calls.push('principals'); rows--; },
    async appendOutbox({ event }) { assert.equal(active, true); assert.equal(event.name, 'identity.user.purged'); calls.push('outbox'); if (failAudit) throw new Error('audit failed'); },
  };
  const buildEvent = ({ removed }: { removed: { roles: number; policies: number; sessions: number; apiKeys: number; userSettings: number } }, optional?: { reason?: string }): DomainEvent => {
    assert.equal(active, true); assert.deepEqual(calls.slice(1), ['principal_roles', 'principal_policies', 'sessions', 'api_keys', 'setting_values_user', 'secrets_vault', 'identity_users', 'principals']);
    assert.deepEqual(removed, { roles: 1, policies: 2, sessions: 3, apiKeys: 4, userSettings: 5 });
    calls.push(`event:${JSON.stringify(optional)}`);
    return { name: 'identity.user.purged' } as DomainEvent;
  };
  return { purge: new SqlUserPurge({ ports }), buildEvent, calls, remaining: () => rows };
}

test('all scoped deletes and the outbox share a transaction', async () => {
  const f = fixture();
  await f.purge.purgeUser({ workspaceId: 'ws', principalId: 'principal', buildEvent: f.buildEvent });
  assert.deepEqual(f.calls, ['begin', 'principal_roles', 'principal_policies', 'sessions', 'api_keys', 'setting_values_user', 'secrets_vault', 'identity_users', 'principals', 'event:{}', 'outbox', 'commit']);
  assert.equal(f.remaining(), 0);
});

test('audit failure rolls back the purge', async () => {
  const f = fixture(true);
  await assert.rejects(f.purge.purgeUser({ workspaceId: 'ws', principalId: 'principal', buildEvent: f.buildEvent }), /audit failed/);
  assert.equal(f.remaining(), 8);
  assert.deepEqual(f.calls.slice(-2), ['outbox', 'rollback']);
  assert.equal(f.calls.includes('commit'), false);
});

test('counts and optional reason report exactly the completed deletes', async () => {
  for (const reason of [undefined, 'manual', 'retention'] as const) {
    const f = fixture();
    const result = await f.purge.purgeUser({ workspaceId: 'ws', principalId: 'principal', buildEvent: f.buildEvent, ...(reason === undefined ? {} : { reason }) });
    assert.deepEqual(result, { roles: 1, policies: 2, sessions: 3, apiKeys: 4, userSettings: 5 });
    assert.equal(f.calls[9], `event:${JSON.stringify(reason === undefined ? {} : { reason })}`);
  }
});
