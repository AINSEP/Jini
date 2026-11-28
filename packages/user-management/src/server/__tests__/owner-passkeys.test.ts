import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
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
const passkeyRefusal = 'This passkey attempt was not accepted or has expired. Start a new attempt, or use your authenticator app or recovery code.';

async function mfaFixture() {
  const repos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new memory.InMemoryPrincipalRepo({}), users: new memory.InMemoryUserRepo({ assertVersionedWrite }),
    sessions: new memory.InMemorySessionRepo({}), roles: new memory.InMemoryRoleRepo({ assertVersionedWrite }),
    policies: new memory.InMemoryPolicyRepo({ assertVersionedWrite }), policyPermissions: new memory.InMemoryPolicyPermissionRepo({}),
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
  await expect(beginOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, password: 'wrong', code: '123456' } })).rejects.toThrow('The current owner password was not accepted. Enter your current password and try again.');
  await expect(beginOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, principalId: 'staff', password: 'old', code: '123456' } })).rejects.toThrow('Only the active site owner can change this authenticator. Sign in as the owner and try again.');
  const started = await f.register();
  expect(f.credentials()).toEqual([{ ...f.scope, id: 'key', publicKey: 'public', counter: 0, rpId: 'localhost' }]);
  await expect(confirmOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, pendingToken: started.pendingToken, response: 'valid' } })).rejects.toThrow(passkeyRefusal);
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
  await expect(f.complete(begun.pendingToken, { id: 'key', valid: false })).rejects.toThrow(passkeyRefusal);
  await expect(f.complete(begun.pendingToken)).rejects.toThrow(passkeyRefusal);
  expect(f.pending().find(p => p.purpose === 'login')?.attempts).toBe(0);
  expect(await f.sessions()).toHaveLength(0);
});

test('expired, changed origin/port, wrong workspace or owner challenges grant nothing', async () => {
  const f = await fixture(); await f.enroll(); await f.register();
  const begun = await f.begin(); f.deps.site.origin = 'http://localhost:3001';
  await expect(f.complete(begun.pendingToken)).rejects.toThrow(passkeyRefusal);
  f.deps.site.origin = 'http://localhost:3000'; const next = await f.begin();
  await expect(completeOwnerPasskeyLogin({ deps: f.deps, input: { workspaceId: 'b', pendingToken: next.pendingToken, response: { id: 'key', valid: true } } })).rejects.toThrow(passkeyRefusal);
  f.advance(300001); await expect(f.complete(next.pendingToken)).rejects.toThrow(passkeyRefusal);
  const enrollment = await beginOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, password: 'old', code: '123456' } });
  await expect(confirmOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, principalId: 'other', pendingToken: enrollment.pendingToken, response: 'valid' } })).rejects.toThrow(passkeyRefusal);
  expect(await f.sessions()).toHaveLength(0);
});

test('credential ownership and RP are checked before the protocol verifier', async () => {
  const f = await fixture(); await f.enroll(); await f.register();
  let begun = await f.begin(); await expect(f.complete(begun.pendingToken, { id: 'foreign', valid: true })).rejects.toThrow(passkeyRefusal);
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
  await expect(removeOwnerPasskey({ deps: f.deps, input: { ...f.scope, id: 'key-0', password: 'old', code: '000000' } })).rejects.toThrow('The authenticator code was not accepted or has expired. Enter a fresh code, or sign in again to start a new attempt.');
  await removeOwnerPasskey({ deps: f.deps, input: { ...f.scope, id: 'key-0', password: 'old', code: '123456' } });
  expect(f.credentials()).toHaveLength(4);
});

test('registration cannot reset the counter of an already registered credential', async () => {
  const f = await fixture(); await f.enroll(); await f.register();
  await f.deps.credentials.save({ ...f.credentials()[0]!, counter: 42 });
  await expect(f.register()).rejects.toThrow(passkeyRefusal);
  expect(f.credentials()[0]?.counter).toBe(42);
});

test('successful passkey completion records the existing last-login timestamp', async () => {
  const f = await fixture(); await f.enroll(); await f.register(); const begun = await f.begin();
  const result = await f.complete(begun.pendingToken);
  const owner = await f.deps.mfa.auth.repos.users.findByPrincipalId(f.scope);
  expect(owner?.lastLoginAt).toBe(result.session.createdAt);
});

test('TOTP and passkey completions compete for the same password proof, with one session total', async () => {
  const f = await fixture(); await f.enroll(); await f.register();
  const password = await f.login(); if (!('pendingToken' in password)) throw Error('missing');
  const passkey = await beginOwnerPasskeyLogin({ deps: f.deps, input: { workspaceId: 'a', pendingToken: password.pendingToken } });
  const results = await Promise.allSettled([
    completeOwnerLogin({ deps: f.deps.mfa, input: { workspaceId: 'a', pendingToken: password.pendingToken, code: '123456' } }),
    f.complete(passkey.pendingToken),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(await f.sessions()).toHaveLength(1);
});

test('purpose substitution, expired registration and replaced password proofs grant nothing', async () => {
  const f = await fixture(); await f.enroll(); await f.register();
  const begun = await f.begin();
  await expect(confirmOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, pendingToken: begun.pendingToken, response: 'valid' } })).rejects.toThrow(passkeyRefusal);
  await f.login();
  await expect(f.complete(begun.pendingToken)).rejects.toThrow(passkeyRefusal);
  const registration = await beginOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, password: 'old', code: '123456' } });
  f.advance(300001);
  await expect(confirmOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, pendingToken: registration.pendingToken, response: 'valid' } })).rejects.toThrow(passkeyRefusal);
  expect(f.credentials()).toHaveLength(1); expect(await f.sessions()).toHaveLength(0);
});

test('parallel registration confirmation activates once; a suspended owner cannot complete login', async () => {
  const f = await fixture(); await f.enroll();
  const registration = await beginOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, password: 'old', code: '123456' } });
  const confirm = () => confirmOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, pendingToken: registration.pendingToken, response: 'valid' } });
  const results = await Promise.allSettled([confirm(), confirm()]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const begun = await f.begin();
  const principal = await f.deps.mfa.auth.repos.principals.findById({ workspaceId: 'a', id: f.scope.principalId });
  if (!principal) throw Error('missing principal');
  await f.deps.mfa.auth.repos.principals.save({ ...principal, status: 'disabled' });
  await expect(f.complete(begun.pendingToken)).rejects.toThrow(passkeyRefusal);
  expect(await f.sessions()).toHaveLength(0);
});

test('a registration response the verifier refuses stores nothing and spends the challenge', async () => {
  const f = await fixture(); await f.enroll();
  const started = await beginOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, password: 'old', code: '123456' } });
  await expect(confirmOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, pendingToken: started.pendingToken, response: 'forged' } })).rejects.toThrow(passkeyRefusal);
  expect(f.credentials()).toEqual([]);
  await expect(confirmOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, pendingToken: started.pendingToken, response: 'valid' } })).rejects.toThrow(passkeyRefusal);
  expect(f.credentials()).toEqual([]);
});

test('the five-key cap is re-checked at confirmation when a key lands after the challenge began', async () => {
  const f = await fixture(); await f.enroll();
  for (let i = 0; i < 4; i++) { f.next(`key-${i}`); await f.register(); }
  const started = await beginOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, password: 'old', code: '123456' } });
  await f.deps.credentials.save({ ...f.scope, id: 'key-concurrent', publicKey: 'public', counter: 0, rpId: 'localhost' });
  f.next('key-6');
  await expect(confirmOwnerPasskeyEnrollment({ deps: f.deps, input: { ...f.scope, pendingToken: started.pendingToken, response: 'valid' } })).rejects.toThrow(passkeyRefusal);
  expect(f.credentials().map(c => c.id)).toEqual(['key-0', 'key-1', 'key-2', 'key-3', 'key-concurrent']);
});

test('an unknown password proof cannot begin a passkey login', async () => {
  const f = await fixture(); await f.enroll(); await f.register();
  await expect(beginOwnerPasskeyLogin({ deps: f.deps, input: { workspaceId: 'a', pendingToken: 'not-issued' } })).rejects.toThrow(passkeyRefusal);
  expect(f.pending().filter(p => p.purpose === 'passkey-login')).toHaveLength(0);
});

test('a password proof for a principal that is no longer the configured owner cannot begin a passkey login', async () => {
  const f = await fixture(); await f.enroll(); await f.register();
  const password = await f.login(); if (!('pendingToken' in password)) throw Error('missing MFA');
  f.deps.mfa.seededOwnerPrincipalId = 'successor';
  await expect(beginOwnerPasskeyLogin({ deps: f.deps, input: { workspaceId: 'a', pendingToken: password.pendingToken } })).rejects.toThrow(passkeyRefusal);
  expect(f.pending().filter(p => p.purpose === 'passkey-login')).toHaveLength(0);
});

test('an owner whose credential row is missing at completion gets no session and keeps the counter', async () => {
  const f = await fixture(); await f.enroll(); await f.register(); const begun = await f.begin();
  const users = f.deps.mfa.auth.repos.users;
  const find = users.findByPrincipalId.bind(users);
  users.findByPrincipalId = async scope => (scope.principalId === f.scope.principalId ? null : find(scope));
  f.next('key', 9);
  await expect(f.complete(begun.pendingToken)).rejects.toThrow(passkeyRefusal);
  expect(f.credentials()[0]?.counter).toBe(0);
  expect(await f.sessions()).toHaveLength(0);
});

test('an expired or attempt-exhausted password proof cannot begin a passkey login', async () => {
  const f = await fixture(); await f.enroll(); await f.register();
  const expired = await f.login(); if (!('pendingToken' in expired)) throw Error('missing MFA');
  f.advance(300001);
  await expect(beginOwnerPasskeyLogin({ deps: f.deps, input: { workspaceId: 'a', pendingToken: expired.pendingToken } })).rejects.toThrow(passkeyRefusal);
  const exhausted = await f.login(); if (!('pendingToken' in exhausted)) throw Error('missing MFA');
  for (let i = 0; i < 5; i++) {
    await expect(completeOwnerLogin({ deps: f.deps.mfa, input: { workspaceId: 'a', pendingToken: exhausted.pendingToken, code: '000000' } })).rejects.toThrow('authenticator code');
  }
  expect(f.pending().find(p => p.purpose === 'login')?.attempts).toBe(5);
  await expect(beginOwnerPasskeyLogin({ deps: f.deps, input: { workspaceId: 'a', pendingToken: exhausted.pendingToken } })).rejects.toThrow(passkeyRefusal);
  expect(f.pending().filter(p => p.purpose === 'passkey-login')).toHaveLength(0);
});
