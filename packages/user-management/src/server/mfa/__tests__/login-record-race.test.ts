import { expect, test, vi } from 'vitest';
import { seedIdentity } from '../../seed.js';
import { NodeSessionTokens } from '../../session-tokens.js';
import { createTransactionalInMemoryIdentityRepos } from '../../repo.memory-transactions.js';
import * as memory from '../../repo.memory.js';
import type { AuthServiceDeps } from '../../auth-service.js';
import { recoverOwner } from '../../recovery-codes.js';
import type { MfaFactor, MfaPending, OwnerMfaDeps } from '../ports.js';
import { beginOwnerLogin, completeOwnerLogin } from '../service.js';

async function fixture() {
  const users = new memory.InMemoryUserRepo({}), sessions = new memory.InMemorySessionRepo({});
  const repos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new memory.InMemoryPrincipalRepo({}), users, sessions,
    roles: new memory.InMemoryRoleRepo({}), policies: new memory.InMemoryPolicyRepo({}),
    policyPermissions: new memory.InMemoryPolicyPermissionRepo({}), rolePolicies: new memory.InMemoryRolePolicyRepo({}),
    principalRoles: new memory.InMemoryPrincipalRoleRepo({}), principalPolicies: new memory.InMemoryPrincipalPolicyRepo({}),
  } });
  let id = 0;
  let factors: MfaFactor[] = [], pending: MfaPending[] = [];
  const auth: AuthServiceDeps = { repos, tokens: new NodeSessionTokens({}), clock: { nowMs: () => 1_800_000_000_000 },
    idGen: { newId: () => `id-${++id}` }, hasher: { hash: async ({ password }) => `hash:${password}`,
      verify: async ({ password, hash }) => hash === `hash:${password}` } };
  const owner = await seedIdentity({ deps: auth, input: { workspaceId: 'a', ownerUsername: 'owner', ownerPassword: 'old' } });
  const same = (a: { workspaceId: string; principalId: string }, b: { workspaceId: string; principalId: string }) => a.workspaceId === b.workspaceId && a.principalId === b.principalId;
  const deps: OwnerMfaDeps = { auth, seededOwnerPrincipalId: owner.ownerPrincipalId,
    store: {
      factor: async s => structuredClone(factors.find(f => same(f, s)) ?? null),
      saveFactor: async f => { factors = factors.filter(x => !same(x, f)); factors.push(structuredClone(f)); },
      pending: async s => structuredClone(pending.find(p => p.workspaceId === s.workspaceId && p.tokenHash === s.tokenHash) ?? null),
      savePending: async p => { pending = pending.filter(x => !same(x, p) || x.purpose !== p.purpose); pending.push(structuredClone(p)); },
      clearPending: async s => { pending = pending.filter(x => !same(x, s)); },
      clear: async s => { factors = factors.filter(x => !same(x, s)); pending = pending.filter(x => !same(x, s)); },
    },
    secrets: { seal: async s => s.secret, open: async s => s.sealedSecret },
    totp: { generate: () => 'secret', uri: () => 'otpauth://test', verify: async ({ code, nowMs }) => code === '123456' ? Math.floor(nowMs / 30000) : null },
  };
  auth.mfaStore = deps.store;
  return { deps, scope: { workspaceId: 'a', principalId: owner.ownerPrincipalId }, users, sessions };
}

test('TOTP and recovery login update lastLoginAt without restoring the old password hash', async () => {
  for (const mode of ['totp', 'recovery']) {
    const f = await fixture();
    await f.deps.store.saveFactor({ ...f.scope, sealedSecret: 'secret', lastStep: -1 });
    let pendingToken = '';
    if (mode === 'totp') {
      const login = await beginOwnerLogin({ deps: f.deps, input: { workspaceId: 'a', username: 'owner', password: 'old' } });
      if (!('pendingToken' in login)) throw new Error('missing challenge');
      pendingToken = login.pendingToken;
    } else {
      await recoverOwner({ deps: { auth: f.deps.auth, mfa: f.deps, seededOwnerPrincipalId: f.scope.principalId,
        codes: { replace: async () => {}, contains: async () => true, clear: async () => {} } },
        input: { ...f.scope, code: 'a'.repeat(64), password: 'recovered' } });
    }
    const save = vi.fn(f.users.save.bind(f.users));
    const recordLogin = vi.fn(f.users.recordLogin.bind(f.users));
    const persistSession = f.sessions.save.bind(f.sessions);
    vi.spyOn(f.sessions, 'save').mockImplementation(async session => {
      await persistSession(session);
      const current = await f.deps.auth.repos.users.findByPrincipalId(f.scope);
      await f.deps.auth.repos.users.save({ ...current!, passwordHash: 'hash:new' });
      f.users.save = save;
      f.users.recordLogin = recordLogin;
    });
    const result = mode === 'totp'
      ? await completeOwnerLogin({ deps: f.deps, input: { workspaceId: 'a', pendingToken, code: '123456' } })
      : await beginOwnerLogin({ deps: f.deps, input: { workspaceId: 'a', username: 'owner', password: 'recovered' } });
    if (!('session' in result)) throw new Error('missing session');
    expect(save).not.toHaveBeenCalled();
    expect(recordLogin).toHaveBeenCalledTimes(1);
    expect(recordLogin).toHaveBeenCalledWith({ ...f.scope, lastLoginAt: result.session.createdAt });
    expect(await f.deps.auth.repos.users.findByPrincipalId(f.scope)).toMatchObject({ passwordHash: 'hash:new', lastLoginAt: result.session.createdAt });
  }
});
