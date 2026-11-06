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

import { beginOwnerPasskeyEnrollment, confirmOwnerPasskeyEnrollment, beginOwnerPasskeyLogin, completeOwnerPasskeyLogin, removeOwnerPasskey } from '../mfa/passkey-service.js';
import type { OwnerPasskeyDeps, PasskeyCredential } from '../mfa/passkey-ports.js';
async function mfaFixture() {
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


async function fixture() {
  const f = await mfaFixture();
  let credentials: PasskeyCredential[] = [];
  let nextId = 'key';
  let nextCounter = 0;
  const transactions = f.deps.auth.repos.transactions;
  f.deps.auth.repos.transactions = { run: input => transactions.run({ ...input, execute: async () => {
    const snapshot = structuredClone(credentials);
    try { return await input.execute(); } catch (error) { credentials = snapshot; throw error; }
  } }) };
  const deps: OwnerPasskeyDeps = { mfa: f.deps, site: { origin: 'http://localhost:3000', rpId: 'localhost', name: 'Test' },
    credentials: {
      list: async scope => credentials.filter(c => c.workspaceId === scope.workspaceId && c.principalId === scope.principalId),
      save: async value => { credentials = credentials.filter(c => c.id !== value.id); credentials.push(value); },
      remove: async input => { credentials = credentials.filter(c => c.id !== input.id || c.workspaceId !== input.workspaceId || c.principalId !== input.principalId); },
      clear: async scope => { credentials = credentials.filter(c => c.workspaceId !== scope.workspaceId || c.principalId !== scope.principalId); },
    },
    webauthn: {
      registration: async () => ({ challenge: 'register-challenge' }),
      authentication: async () => ({ challenge: 'login-challenge' }),
      register: async input => { expect(input.site.origin).toBe(deps.site.origin); expect(input.challenge).toBe('register-challenge');
        if (input.response !== 'valid') throw Error('UV/signature');
        return { id: nextId, publicKey: 'public', counter: nextCounter }; },
      authenticate: async input => { expect(input.challenge).toBe('login-challenge'); expect(input.site.rpId).toBe('localhost');
        if ((input.response as { valid?: boolean }).valid !== true) throw Error('UV/signature'); return nextCounter; },
    },
  };
  async function register() {
    const started = await beginOwnerPasskeyEnrollment({ deps, input: { ...f.scope, password: 'old', code: '123456' } });
    await confirmOwnerPasskeyEnrollment({ deps, input: { ...f.scope, pendingToken: started.pendingToken, response: 'valid' } });
    f.advance();
    return started;
  }
  async function begin() {
    const password = await f.login(); if (!('pendingToken' in password)) throw Error('missing MFA');
    return beginOwnerPasskeyLogin({ deps, input: { workspaceId: 'a', pendingToken: password.pendingToken } });
  }
  const complete = (token: string, response: unknown = { id: 'key', valid: true }) => completeOwnerPasskeyLogin({ deps, input: { workspaceId: 'a', pendingToken: token, response } });
  return { ...f, deps, register, begin, complete, credentials: () => credentials,
    next: (id: string, counter = 0) => { nextId = id; nextCounter = counter; } };
}

test('enrollment requires current owner password and confirmed TOTP, stores only a public credential', async () => {
  const f = await fixture();
  await expect(f.register()).rejects.toThrow('Set up your authenticator');
  await f.enroll();
  await expect(beginOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, password: 'wrong', code: '123456' } })).rejects.toThrow();
  await expect(beginOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, principalId: 'staff', password: 'old', code: '123456' } })).rejects.toThrow();
  const started = await f.register();
  expect(f.credentials()).toEqual([{ ...f.scope, id: 'key', publicKey: 'public', counter: 0, rpId: 'localhost' }]);
  await expect(confirmOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, pendingToken: started.pendingToken, response: 'valid' } })).rejects.toThrow();
});

test('password and passkey proofs create exactly one session under concurrent replay', async () => {
  const f = await fixture(); await f.enroll(); await f.register(); const begun = await f.begin();
  expect(await f.sessions()).toHaveLength(0);
  const outcomes = await Promise.allSettled([f.complete(begun.pendingToken), f.complete(begun.pendingToken)]);
  expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
  expect(await f.sessions()).toHaveLength(1);
  expect(f.pending()).toHaveLength(0);
});

test('wrong signature or missing UV spends challenge, but leaves TOTP fallback intact', async () => {
  const f = await fixture(); await f.enroll(); await f.register(); const begun = await f.begin();
  await expect(f.complete(begun.pendingToken, { id: 'key', valid: false })).rejects.toThrow();
  await expect(f.complete(begun.pendingToken)).rejects.toThrow();
  expect(f.pending().find(p => p.purpose === 'login')?.attempts).toBe(0);
  expect(await f.sessions()).toHaveLength(0);
});

test('expired, changed origin/port, wrong workspace or owner challenges grant nothing', async () => {
  const f = await fixture(); await f.enroll(); await f.register();
  const begun = await f.begin(); f.deps.site.origin = 'http://localhost:3001';
  await expect(f.complete(begun.pendingToken)).rejects.toThrow();
  f.deps.site.origin = 'http://localhost:3000'; const next = await f.begin();
  await expect(completeOwnerPasskeyLogin({ deps: f.deps, input: { workspaceId: 'b', pendingToken: next.pendingToken, response: { id: 'key', valid: true } } })).rejects.toThrow();
  f.advance(300001); await expect(f.complete(next.pendingToken)).rejects.toThrow();
  const enrollment = await beginOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, password: 'old', code: '123456' } });
  await expect(confirmOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, principalId: 'other', pendingToken: enrollment.pendingToken, response: 'valid' } })).rejects.toThrow();
  expect(await f.sessions()).toHaveLength(0);
});

test('credential ownership and RP are checked before the protocol verifier', async () => {
  const f = await fixture(); await f.enroll(); await f.register();
  let begun = await f.begin(); await expect(f.complete(begun.pendingToken, { id: 'foreign', valid: true })).rejects.toThrow();
  await f.deps.credentials.save({ ...f.scope, id: 'key', publicKey: 'public', counter: 0, rpId: 'evil.test' });
  await expect(f.begin()).rejects.toThrow('No passkey');
  expect(await f.sessions()).toHaveLength(0);
});

test('session failure rolls back challenge and counter; zero and incrementing counters persist', async () => {
  const f = await fixture(); await f.enroll(); await f.register(); const begun = await f.begin();
  const save = f.deps.mfa.auth.repos.sessions.save;
  f.deps.mfa.auth.repos.sessions.save = async () => { throw Error('disk'); };
  f.next('key', 2); await expect(f.complete(begun.pendingToken)).rejects.toThrow('disk');
  expect(f.credentials()[0]?.counter).toBe(0); expect(await f.sessions()).toHaveLength(0);
  f.deps.mfa.auth.repos.sessions.save = save; await f.complete(begun.pendingToken);
  expect(f.credentials()[0]?.counter).toBe(2);
});

test('five-key cap and fresh-factor removal keep the credential set bounded', async () => {
  const f = await fixture(); await f.enroll();
  for (let i = 0; i < 5; i++) { f.next(`key-${i}`); await f.register(); }
  await expect(f.register()).rejects.toThrow('Five passkeys');
  await expect(removeOwnerPasskey({ deps: f.deps, input: { ...f.scope, id: 'key-0', password: 'old', code: '000000' } })).rejects.toThrow();
  await removeOwnerPasskey({ deps: f.deps, input: { ...f.scope, id: 'key-0', password: 'old', code: '123456' } });
  expect(f.credentials()).toHaveLength(4);
});

test('registration cannot reset the counter of an already registered credential', async () => {
  const f = await fixture(); await f.enroll(); await f.register();
  await f.deps.credentials.save({ ...f.credentials()[0]!, counter: 42 });
  await expect(f.register()).rejects.toThrow();
  expect(f.credentials()[0]?.counter).toBe(42);
});
