import { resetUserPassword } from '../admin-crud-service.js';
import { issueRecoveryCodes, resetOwnerPassword } from '../recovery-codes.js';
import { expect, test } from 'vitest';
import { seedIdentity } from '../seed.js';
import { NodeSessionTokens } from '../session-tokens.js';
import { createTransactionalInMemoryIdentityRepos } from '../repo.memory-transactions.js';
import * as memory from '../repo.memory.js';
import { login as legacyLogin, type AuthServiceDeps } from '../auth-service.js';
import type { MfaFactor, MfaPending, OwnerMfaDeps } from '../mfa/ports.js';
import { beginOwnerLogin, completeOwnerLogin, beginOwnerEnrollment, confirmOwnerEnrollment, removeOwnerFactor } from '../mfa/service.js';

async function fixture() {
  const repos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new memory.InMemoryPrincipalRepo({}), users: new memory.InMemoryUserRepo({}),
    sessions: new memory.InMemorySessionRepo({}), roles: new memory.InMemoryRoleRepo({}),
    policies: new memory.InMemoryPolicyRepo({}), policyPermissions: new memory.InMemoryPolicyPermissionRepo({}),
    rolePolicies: new memory.InMemoryRolePolicyRepo({}), principalRoles: new memory.InMemoryPrincipalRoleRepo({}),
    principalPolicies: new memory.InMemoryPrincipalPolicyRepo({}),
  } });
  let now = 1_800_000_000_000, id = 0;
  let factors: MfaFactor[] = [], pending: MfaPending[] = [];
  const auth: AuthServiceDeps = { repos, tokens: new NodeSessionTokens({}), clock: { nowMs: () => now },
    idGen: { newId: () => `id-${++id}` }, hasher: { hash: async ({ password }) => `hash:${password}`,
      verify: async ({ password, hash }) => hash === `hash:${password}` } };
  const transactions = repos.transactions;
  repos.transactions = { run: input => transactions.run({ ...input, execute: async () => {
    const snapshot = structuredClone({ factors, pending });
    try { return await input.execute(); } catch (error) { ({ factors, pending } = snapshot); throw error; }
  } }) };
  const owner = await seedIdentity({ deps: auth, input: { workspaceId: 'a', ownerUsername: 'owner', ownerPassword: 'old' } });
  const same = (a: {workspaceId:string;principalId:string}, b: {workspaceId:string;principalId:string}) => a.workspaceId === b.workspaceId && a.principalId === b.principalId;
  const deps: OwnerMfaDeps = { auth, seededOwnerPrincipalId: owner.ownerPrincipalId,
    store: {
      factor: async s => structuredClone(factors.find(f => same(f,s)) ?? null),
      saveFactor: async f => { factors = factors.filter(x => !same(x,f)); factors.push(structuredClone(f)); },
      pending: async s => structuredClone(pending.find(p => p.workspaceId === s.workspaceId && p.tokenHash === s.tokenHash) ?? null),
      savePending: async p => { pending = pending.filter(x => !same(x,p) || x.purpose !== p.purpose); pending.push(structuredClone(p)); },
      clearPending: async s => { pending = pending.filter(x => !same(x,s)); },
      clear: async s => { factors = factors.filter(x => !same(x,s)); pending = pending.filter(x => !same(x,s)); },
    },
    secrets: { seal: async s => JSON.stringify([s.workspaceId,s.principalId,s.secret]), open: async s => {
      const [w,p,secret] = JSON.parse(s.sealedSecret); if (w !== s.workspaceId || p !== s.principalId) throw Error('AAD'); return secret;
    } },
    totp: { generate: () => 'secret', uri: () => 'otpauth://test', verify: async ({code,nowMs}) => code === '123456' ? Math.floor(nowMs / 30000) : null },
  };
  auth.mfaStore = deps.store;
  const scope = { workspaceId: 'a', principalId: owner.ownerPrincipalId };
  const login = () => beginOwnerLogin({ deps, input: { workspaceId: 'a', username: 'owner', password: 'old' } });
  const enroll = async () => {
    const e = await beginOwnerEnrollment({ deps, input: { ...scope, password: 'old', label: 'Owner', issuer: 'Test' } });
    await confirmOwnerEnrollment({ deps, input: { ...scope, pendingToken: e.pendingToken, code: '123456' } }); now += 30000;
  };
  return { deps, scope, login, enroll, advance: (ms = 30000) => { now += ms; }, pending: () => pending,
    sessions: () => repos.sessions.listByPrincipalId(scope) };
}

test('unenrolled login creates a session; unconfirmed enrollment grants nothing', async () => {
  const f = await fixture();
  await beginOwnerEnrollment({deps:f.deps,input:{...f.scope,password:'old',label:'Owner',issuer:'Test'}});
  expect(await f.deps.store.factor(f.scope)).toBeNull();
  expect(await f.login()).toHaveProperty('rawToken');
});

test('enrolled password login returns only an expiring pending proof, never a session', async () => {
  const f = await fixture(); await f.enroll();
  const result = await f.login(); expect(result).toMatchObject({mfaRequired:true});
  expect(result).not.toHaveProperty('rawToken'); expect(await f.sessions()).toHaveLength(0);
  expect(JSON.stringify(f.pending())).not.toContain((result as {pendingToken:string}).pendingToken);
});

test('one concurrent completion wins; pending proof and accepted timestep cannot be replayed', async () => {
  const f = await fixture(); await f.enroll(); const result = await f.login();
  if (!('pendingToken' in result)) throw Error('missing challenge');
  const finish = () => completeOwnerLogin({deps:f.deps,input:{workspaceId:'a',pendingToken:result.pendingToken,code:'123456'}});
  const outcomes = await Promise.allSettled([finish(),finish()]);
  expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(await f.sessions()).toHaveLength(1);
  const next = await f.login(); if (!('pendingToken' in next)) throw Error('missing');
  await expect(completeOwnerLogin({deps:f.deps,input:{workspaceId:'a',pendingToken:next.pendingToken,code:'123456'}})).rejects.toThrow();
});

test('bad attempts stay spent, exhaust after five, and expiry/wrong workspace grant no session', async () => {
  const f = await fixture(); await f.enroll(); const r = await f.login(); if (!('pendingToken' in r)) throw Error('missing');
  for (let i=0;i<5;i++) await expect(completeOwnerLogin({deps:f.deps,input:{workspaceId:'a',pendingToken:r.pendingToken,code:'000000'}})).rejects.toThrow();
  await expect(completeOwnerLogin({deps:f.deps,input:{workspaceId:'a',pendingToken:r.pendingToken,code:'123456'}})).rejects.toThrow();
  const r2 = await f.login(); if (!('pendingToken' in r2)) throw Error('missing');
  await expect(completeOwnerLogin({deps:f.deps,input:{workspaceId:'b',pendingToken:r2.pendingToken,code:'123456'}})).rejects.toThrow();
  f.advance(300001);
  await expect(completeOwnerLogin({deps:f.deps,input:{workspaceId:'a',pendingToken:r2.pendingToken,code:'123456'}})).rejects.toThrow();
  expect(await f.sessions()).toHaveLength(0);
});

test('session persistence failure rolls back consumption and factor advancement', async () => {
  const f = await fixture(); await f.enroll(); const r = await f.login(); if (!('pendingToken' in r)) throw Error('missing');
  const save = f.deps.auth.repos.sessions.save;
  f.deps.auth.repos.sessions.save = async () => { throw Error('disk'); };
  await expect(completeOwnerLogin({deps:f.deps,input:{workspaceId:'a',pendingToken:r.pendingToken,code:'123456'}})).rejects.toThrow('disk');
  expect(await f.sessions()).toHaveLength(0); f.deps.auth.repos.sessions.save = save;
  expect(await completeOwnerLogin({deps:f.deps,input:{workspaceId:'a',pendingToken:r.pendingToken,code:'123456'}})).toHaveProperty('rawToken');
});

test('replacement/removal require current password and factor; staff cannot enroll', async () => {
  const f = await fixture(); await f.enroll();
  await expect(beginOwnerEnrollment({deps:f.deps,input:{...f.scope,password:'old',label:'O',issuer:'T'}})).rejects.toThrow();
  await expect(removeOwnerFactor({deps:f.deps,input:{...f.scope,password:'wrong',code:'123456'}})).rejects.toThrow();
  await expect(beginOwnerEnrollment({deps:f.deps,input:{...f.scope,principalId:'staff',password:'old',label:'S',issuer:'T'}})).rejects.toThrow();
  await removeOwnerFactor({deps:f.deps,input:{...f.scope,password:'old',code:'123456'}});
  expect(await f.deps.store.factor(f.scope)).toBeNull();
});


test('ordinary password reset preserves factor and invalidates pending proofs made with the old password', async () => {
  const f = await fixture(); await f.enroll(); const r = await f.login(); if (!('pendingToken' in r)) throw Error('missing');
  await resetUserPassword({deps:f.deps.auth,input:{...f.scope,password:'new',callerPrincipalId:f.scope.principalId,seededOwnerPrincipalId:f.scope.principalId}});
  expect(await f.deps.store.factor(f.scope)).not.toBeNull();
  await expect(completeOwnerLogin({deps:f.deps,input:{workspaceId:'a',pendingToken:r.pendingToken,code:'123456'}})).rejects.toThrow();
  expect(await f.sessions()).toHaveLength(0);
});

test('recovery kit rotation needs the existing factor, and explicit host recovery clears factors/proofs', async () => {
  const f = await fixture(); await f.enroll(); await f.login();
  let hashes: string[] = [];
  const deps = {auth:f.deps.auth,mfa:f.deps,seededOwnerPrincipalId:f.scope.principalId,codes:{
    replace: async (s:{hashes:string[]}) => { hashes=s.hashes; }, clear:async()=>{hashes=[];}, contains:async()=>false,
  }};
  await expect(issueRecoveryCodes({deps,input:{...f.scope,password:'old'}})).rejects.toThrow();
  expect(hashes).toEqual([]);
  const kit = await issueRecoveryCodes({deps,input:{...f.scope,password:'old',code:'123456'}});
  expect(kit.codes).toHaveLength(10);
  await resetOwnerPassword({deps,input:{...f.scope,password:'new'}});
  expect(await f.deps.store.factor(f.scope)).toBeNull(); expect(f.pending()).toHaveLength(0); expect(hashes).toEqual([]);
});


test('legacy password login cannot create a surviving session after concurrent first-factor activation', async () => {
  const f = await fixture();
  const enrollment = await beginOwnerEnrollment({ deps: f.deps,
    input: { ...f.scope, password: 'old', label: 'Owner', issuer: 'Test' } });
  let captured!: () => void, release!: () => void;
  const factorRead = new Promise<void>(resolve => { captured = resolve; });
  const resumeLogin = new Promise<void>(resolve => { release = resolve; });
  const factor = f.deps.store.factor;
  let firstRead = true;
  f.deps.store.factor = async scope => {
    const snapshot = await factor(scope);
    if (firstRead) { firstRead = false; captured(); await resumeLogin; }
    return snapshot;
  };
  const login = legacyLogin({ deps: f.deps.auth, input: { workspaceId: 'a', username: 'owner', password: 'old' } });
  await factorRead;
  // Activation queues before the paused login can persist its session. With a single identity
  // transaction, activation instead waits for that login and revokes its session before returning.
  const activation = confirmOwnerEnrollment({ deps: f.deps,
    input: { ...f.scope, pendingToken: enrollment.pendingToken, code: '123456' } });
  release();
  await Promise.all([login, activation]);
  expect(await f.deps.store.factor(f.scope)).not.toBeNull();
  expect((await f.sessions()).filter(session => !session.revokedAt)).toHaveLength(0);
});
