import { expect, it, describe } from 'vitest';
import type { VaultRepoPort } from '@jini-ai/core/contracts/vault';
import { AesGcmSecretSealer } from '@jini-ai/platform/secrets';
import { createVaultMetaParsers, InMemoryVaultRepo, SecretsVaultService } from '@jini-ai/platform/secrets/credential-sets';
import { VaultError } from '@jini-ai/core/contracts/vault';
import { InMemoryKeyring } from '@jini-ai/platform/secrets/testing';
import * as entry from '../index.js';
import type { CredentialSetStoreHost, CredentialSetVaultPolicy, CredentialSetWriteDeps } from '../index.js';

/** @file Branch-level behaviour of the credential-set store and its vault repository, driven through the public entry with a real in-memory vault. */

type Cat = 'red' | 'blue';
const OWNER = 'second-host';
const WS = 'ws-1';
const packageRoot = new URL('../../../../', import.meta.url);

function makeHost() {
  const policy: CredentialSetVaultPolicy = {
    ownerKey: OWNER,
    parseMeta: ({ kind, meta, provider }) => createVaultMetaParsers({})[kind]({ meta, provider }),
    compareLabels: (a, b) => a.label.localeCompare(b.label),
    vaultErrors: { create: ({ code }) => new VaultError({ code }), codeOf: error => (error instanceof VaultError ? error.code : undefined) },
    labelConflict: () => new Error('SECOND-UNIQUE label'),
  };
  const host: CredentialSetStoreHost<Cat> = {
    vault: policy,
    openVault: ({ deps, kind }) => new SecretsVaultService({
      repo: deps.repo.vault!, keyring: deps.keyring!, sealer: deps.sealer, metaParsers: createVaultMetaParsers({}),
      authorize: async ({ context }) => { if (context.ownerKey !== OWNER || context.kind !== kind) throw new VaultError({ code: 'context' }); },
      now: () => '2026-11-09T00:00:00.000Z', newId: () => { throw new Error('ids come from the store'); },
    }),
    scopes: (deps, workspaceId) => [{ deps, workspaceId, scope: 'site' as const }],
    createTarget: (deps, input) => ({ deps, workspaceId: input.workspaceId, scope: 'site' }),
    isUniqueViolation: error => error instanceof Error && error.message.startsWith('SECOND-UNIQUE'),
    isCreateConflict: (error): error is Error => error instanceof TypeError && error.message === 'second create conflict',
    token: {
      normalize: ({ value }) => { if (typeof value !== 'string' || !value.trim()) throw new RangeError('second: token needed'); return value.trim(); },
      assertFreeField: () => undefined,
      isInputError: (error): error is Error => error instanceof RangeError,
    },
    normalizeWorksFor: ({ value }) => (Array.isArray(value) ? value.map(String) : []),
    categories: ['red', 'blue'],
    messages: {
      storage: 'second storage', worksForInvalid: 'second worksFor', sharedReplacementReadOnly: 'second replace read-only',
      sharedDeleteReadOnly: 'second delete read-only', duplicateLabel: ({ label }) => `second dup ${label}`,
      projectDuplicateLabel: ({ label }) => `second project dup ${label}`, notFound: ({ id }) => `second missing ${id}`,
    },
  };
  const inner = new InMemoryVaultRepo({});
  const platformKeyring = new InMemoryKeyring({ hkdfSalt: 'second-host' }, { keyId: 'k1' });
  const real = new AesGcmSecretSealer({ keyring: platformKeyring });
  // CredentialSetKeyringPort takes a zero-argument activeKey; the host adapts its keyring.
  const keyring = { activeKey: () => platformKeyring.activeKey({}), derive: platformKeyring.derive.bind(platformKeyring),
    deriveSigningSecret: platformKeyring.deriveSigningSecret.bind(platformKeyring) };
  const counts = { open: 0, seal: 0 };
  const sealer = {
    seal: (input: Parameters<AesGcmSecretSealer['seal']>[0]) => { counts.seal++; return real.seal(input); },
    open: (input: Parameters<AesGcmSecretSealer['open']>[0], optional?: Parameters<AesGcmSecretSealer['open']>[1]) => { counts.open++; return real.open(input, optional); },
  };
  const vault: VaultRepoPort = inner;
  const repo = new entry.CredentialSetVaultRepo<Cat>({ vault, policy });
  let n = 0;
  const deps: CredentialSetWriteDeps<Cat> = { repo, sealer, keyring, clock: { nowMs: () => 0 }, idGen: { newId: () => `id-${++n}` } };
  return { host, policy, deps, inner, counts, repo, vault };
}


const input = { workspaceId: WS, label: 'Main', category: 'red', baseUrl: 'https://api.second.test', connection: { token: 'tok-abcdefghijklmnop' } };
const call = (s: ReturnType<typeof makeHost>, over: Record<string, unknown>) => entry.createCredentialSet({ host: s.host, deps: s.deps, input: { ...input, ...over } as never });
const reason = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Error);

describe('read models', () => {
  it('describes by id and by label, and reports null for an unknown one', async () => {
    const s = makeHost();
    const made = await call(s, {});
    expect(await entry.describeCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: made.id } })).toMatchObject({ id: made.id, label: 'Main', category: 'red', baseUrl: 'https://api.second.test' });
    expect(await entry.describeCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: 'nope' } })).toBeNull();
    expect((await entry.describeCredentialSetByLabel({ host: s.host, deps: s.deps, input: { workspaceId: WS, label: 'Main' } }))?.id).toBe(made.id);
    expect(await entry.describeCredentialSetByLabel({ host: s.host, deps: s.deps, input: { workspaceId: WS, label: 'Other' } })).toBeNull();
    expect(s.counts.open).toBe(0);
  });

  it('uses the vault\'s indexed label lookup when the repo is given one, and ignores non-custom rows', async () => {
    const s = makeHost();
    await call(s, {});
    const rows = await s.inner.list({ workspaceId: WS, kind: 'vendor', ownerKey: OWNER, principalId: null });
    const calls: string[] = [];
    const indexed = new entry.CredentialSetVaultRepo<Cat>({ vault: s.vault, policy: s.policy }, { findRowByLabel: async ({ label }) => { calls.push(label); return rows.find(r => r.label === label) ?? null; } });
    expect((await indexed.findByLabel!({ workspaceId: WS, label: 'Main' }))?.label).toBe('Main');
    expect(await indexed.findByLabel!({ workspaceId: WS, label: 'absent' })).toBeNull();
    const notCustom = new entry.CredentialSetVaultRepo<Cat>({ vault: s.vault, policy: s.policy }, { findRowByLabel: async () => ({ ...rows[0]!, meta: { ...rows[0]!.meta, credentialType: 'other' } }) });
    expect(await notCustom.findByLabel!({ workspaceId: WS, label: 'Main' })).toBeNull();
    expect(calls).toEqual(['Main', 'absent']);
    const viaStore = await entry.describeCredentialSetByLabel({ host: s.host, deps: { ...s.deps, repo: indexed }, input: { workspaceId: WS, label: 'Main' } });
    expect(viaStore?.label).toBe('Main');
  });

  it('lists the admin inventory sorted by label without opening any envelope', async () => {
    const s = makeHost();
    await call(s, { label: 'Zed' });
    await call(s, { label: 'Alpha' });
    expect((await entry.listCredentialSetInventory({ host: s.host, deps: s.deps, workspaceId: WS })).map(x => x.label)).toEqual(['Alpha', 'Zed']);
    expect(s.counts.open).toBe(0);
  });
});

describe('create validation', () => {
  it.each([
    [{ label: 5 }, 'label must be a non-empty string'],
    [{ label: '   ' }, 'label must be a non-empty string'],
    [{ label: 'x'.repeat(500) }, /^label must be \d+ characters or fewer$/],
    [{ category: 7 }, 'category must be one of: red, blue'],
    [{ baseUrl: '' }, 'baseUrl must be a non-empty string'],
    [{ baseUrl: 'not a url' }, 'baseUrl must be a valid absolute URL'],
    [{ baseUrl: 'ftp://files.test' }, 'baseUrl must use http or https'],
    [{ additionalHosts: 'https://x.test' }, 'additionalHosts must be an array of absolute http/https URLs'],
    [{ additionalHosts: [''] }, 'additionalHosts[0] must be a non-empty string'],
    [{ additionalHosts: ['https://ok.test', 3] }, 'additionalHosts[1] must be a non-empty string'],
    [{ additionalHosts: ['nope'] }, 'additionalHosts[0] must be a valid absolute URL'],
    [{ additionalHosts: ['ftp://h.test'] }, 'additionalHosts[0] must use http or https'],
    [{ connection: 'tok' }, 'connection must be an object'],
    [{ connection: [] }, 'connection must be an object'],
    [{ connection: null }, 'connection must be an object'],
    [{ connection: { token: 'tok-abcdefghijklmnop', username: '' } }, "'username' must be a non-empty string when provided"],
    [{ connection: { token: 'tok-abcdefghijklmnop', username: 4 } }, "'username' must be a non-empty string when provided"],
  ])('refuses %j', async (over, message) => {
    const error = await reason(call(makeHost(), over));
    expect(error).toBeInstanceOf(entry.CustomCredentialValidationError);
    if (typeof message === 'string') expect(error.message).toBe(message); else expect(error.message).toMatch(message);
  });

  it('normalizes additional hosts to deduplicated origins and stores username and worksFor as metadata', async () => {
    const s = makeHost();
    const made = await call(s, { additionalHosts: ['https://a.test/path', 'https://a.test/other', 'http://b.test:8080/x'], worksFor: ['w1'], connection: { token: 'tok-abcdefghijklmnop', username: 'alice' } });
    expect(made).toMatchObject({ additionalHosts: ['https://a.test', 'http://b.test:8080'], username: 'alice', worksFor: ['w1'] });
  });

  it('turns a host worksFor refusal into the host\'s validation wording and rethrows unknown failures', async () => {
    const s = makeHost();
    s.host.normalizeWorksFor = () => { throw new VaultError({ code: 'context' }); };
    expect((await reason(call(s, { worksFor: ['x'] }))).message).toBe('second worksFor');
    const boom = new Error('unrelated');
    s.host.normalizeWorksFor = () => { throw boom; };
    expect(await reason(call(s, { worksFor: ['x'] }))).toBe(boom);
  });

  it('rethrows token errors that are not input errors, and maps free-field refusals to validation errors', async () => {
    const s = makeHost();
    const boom = new Error('token backend down');
    s.host.token.normalize = () => { throw boom; };
    expect(await reason(call(s, {}))).toBe(boom);
    const t = makeHost();
    t.host.token.assertFreeField = ({ field }) => { if (field === 'label') throw new RangeError('second: label looks like a secret'); };
    const refused = await reason(call(t, {}));
    expect(refused).toBeInstanceOf(entry.CustomCredentialValidationError);
    expect(refused.message).toBe('second: label looks like a secret');
    const u = makeHost();
    const bug = new Error('free-field check crashed');
    u.host.token.assertFreeField = () => { throw bug; };
    expect(await reason(call(u, {}))).toBe(bug);
  });

  it('refuses a duplicate label and translates a raw unique-index violation', async () => {
    const s = makeHost();
    await call(s, {});
    expect((await reason(call(s, {}))).message).toBe('second dup Main');
    const t = makeHost();
    t.host.isUniqueViolation = () => true;
    const real = t.repo.insert.bind(t.repo);
    t.repo.insert = async () => { throw new Error('UNIQUE constraint failed'); };
    expect(await reason(call(t, {}))).toBeInstanceOf(entry.CustomCredentialDuplicateLabelError);
    t.repo.insert = real;
  });

  it('maps a host create conflict to a duplicate-label error carrying its message and rethrows other storage errors', async () => {
    const s = makeHost();
    s.repo.insert = async () => { throw new TypeError('second create conflict'); };
    const dup = await reason(call(s, {}));
    expect(dup).toBeInstanceOf(entry.CustomCredentialDuplicateLabelError);
    expect(dup.message).toBe('second create conflict');
    const boom = new Error('disk');
    s.repo.insert = async () => { throw boom; };
    expect(await reason(call(s, {}))).toBe(boom);
  });
});

describe('update', () => {
  const update = (s: ReturnType<typeof makeHost>, id: string, over: Record<string, unknown>) => entry.updateCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id, ...over } as never });

  it('patches metadata fields independently and leaves omitted ones and the envelope alone', async () => {
    const s = makeHost();
    const made = await call(s, { additionalHosts: ['https://a.test'], connection: { token: 'tok-abcdefghijklmnop', username: 'alice' } });
    const next = await update(s, made.id, { label: 'Renamed', category: 'blue', baseUrl: 'https://api.other.test', additionalHosts: ['https://c.test/x'], worksFor: ['w2'] });
    expect(next).toMatchObject({ label: 'Renamed', category: 'blue', baseUrl: 'https://api.other.test', additionalHosts: ['https://c.test'], username: 'alice', worksFor: ['w2'] });
    const same = await update(s, made.id, {});
    expect(same).toMatchObject({ label: 'Renamed', category: 'blue', additionalHosts: ['https://c.test'], worksFor: ['w2'] });
    const resolved = await entry.resolveCredentialSetByLabel({ host: s.host, deps: s.deps, input: { workspaceId: WS, label: 'Renamed' } });
    expect(resolved?.connection).toEqual({ token: 'tok-abcdefghijklmnop', username: 'alice' });
  });

  it('keeps the envelope and username for a blank or tokenless connection patch', async () => {
    const s = makeHost();
    const made = await call(s, { connection: { token: 'tok-abcdefghijklmnop', username: 'alice' } });
    for (const connection of [{ token: '' }, {}]) {
      await update(s, made.id, { connection });
      expect((await entry.resolveCredentialSetByLabel({ host: s.host, deps: s.deps, input: { workspaceId: WS, label: 'Main' } }))?.connection).toEqual({ token: 'tok-abcdefghijklmnop', username: 'alice' });
    }
    await expect(update(s, made.id, { connection: [] })).rejects.toThrow('connection must be an object');
    await expect(update(s, made.id, { connection: 'x' })).rejects.toThrow('connection must be an object');
    await expect(update(s, made.id, { connection: null })).rejects.toThrow('connection must be an object');
  });

  it('replacing the connection resets the username unless one is supplied, and a top-level username wins', async () => {
    const s = makeHost();
    const made = await call(s, { connection: { token: 'tok-abcdefghijklmnop', username: 'alice' } });
    expect((await update(s, made.id, { connection: { token: 'tok-new-qrstuvwxyz' } })).username).toBeUndefined();
    expect((await update(s, made.id, { connection: { token: 'tok-new-qrstuvwxyz', username: 'bob' } })).username).toBe('bob');
    expect((await update(s, made.id, { username: 'carol' })).username).toBe('carol');
    expect((await update(s, made.id, { connection: { token: 'tok-third-abcdefgh', username: 'dave' }, username: null })).username).toBeUndefined();
    expect((await update(s, made.id, { username: 'erin' })).username).toBe('erin');
    expect((await update(s, made.id, { username: null })).username).toBeUndefined();
  });

  it('refuses a blank or non-string username patch and a username the host calls a secret', async () => {
    const s = makeHost();
    const made = await call(s, {});
    for (const username of ['', '  ', 5]) expect((await reason(update(s, made.id, { username }))).message).toBe("'username' must be a non-empty string, or null to clear it");
    s.host.token.assertFreeField = ({ field }) => { if (field === 'username') throw new RangeError('second: username looks like a secret'); };
    expect((await reason(update(s, made.id, { username: 'tok-xyz' }))).message).toBe('second: username looks like a secret');
  });

  it('reports an unknown id with the host wording', async () => {
    expect((await reason(update(makeHost(), 'missing-id', {}))).message).toBe('second missing missing-id');
  });

  it('refuses renaming onto another row\'s label as a duplicate', async () => {
    const s = makeHost();
    await call(s, { label: 'One' });
    const two = await call(s, { label: 'Two' });
    s.host.isUniqueViolation = () => true;
    const dup = await reason(update(s, two.id, { label: 'One' }));
    expect(dup).toBeInstanceOf(entry.CustomCredentialDuplicateLabelError);
    expect(dup.message).toBe('second dup One');
  });

  it('rethrows a storage failure that is not a duplicate', async () => {
    const s = makeHost();
    const made = await call(s, {});
    const boom = new Error('write failed');
    s.repo.update = async () => { throw boom; };
    expect(await reason(update(s, made.id, { label: 'New' }))).toBe(boom);
  });
});

describe('delete', () => {
  it('removes the row and is a no-op for an unknown id', async () => {
    const s = makeHost();
    const made = await call(s, {});
    await entry.deleteCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: 'unknown' } });
    expect(await entry.describeCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: made.id } })).not.toBeNull();
    await entry.deleteCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: made.id } });
    expect(await entry.describeCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: made.id } })).toBeNull();
  });
});

describe('resolve', () => {
  it('returns null for an unknown label and refuses a payload without a token', async () => {
    const s = makeHost();
    expect(await entry.resolveCredentialSetByLabel({ host: s.host, deps: s.deps, input: { workspaceId: WS, label: 'none' } })).toBeNull();
    await call(s, {});
    const open = s.host.openVault;
    s.host.openVault = (args) => ({ ...open(args), get: async () => null }) as never;
    expect(await entry.resolveCredentialSetByLabel({ host: s.host, deps: s.deps, input: { workspaceId: WS, label: 'Main' } })).toBeNull();
    s.host.openVault = (args) => ({ ...open(args), get: async () => ({ summary: { meta: {} }, payload: {} }) }) as never;
    await expect(entry.resolveCredentialSetByLabel({ host: s.host, deps: s.deps, input: { workspaceId: WS, label: 'Main' } })).rejects.toBeInstanceOf(entry.CustomCredentialSecretStoreUnconfiguredError);
  });
});

describe('vault repository', () => {
  it('lists unified and legacy custom rows in policy label order and finds by id', async () => {
    const s = makeHost();
    const a = await call(s, { label: 'B-one' });
    await call(s, { label: 'A-two' });
    const rows = await s.inner.list({ workspaceId: WS, kind: 'vendor', ownerKey: OWNER, principalId: null });
    const legacyRow = { ...rows.find(r => r.label === 'B-one')!, id: 'legacy-1', label: 'C-legacy', kind: 'custom' as const };
    await s.inner.put({ record: legacyRow, expectedRevision: null });
    expect((await s.repo.listByWorkspace({ workspaceId: WS })).map(r => r.label)).toEqual(['A-two', 'B-one', 'C-legacy']);
    expect((await s.repo.findById({ workspaceId: WS, id: a.id }))?.label).toBe('B-one');
    expect(await s.repo.findById({ workspaceId: WS, id: 'absent' })).toBeNull();
    expect((await s.repo.findById({ workspaceId: WS, id: 'legacy-1' }))?.label).toBe('C-legacy');
  });

  it('refuses rows without an envelope or outside the trusted ownership', async () => {
    const s = makeHost();
    await call(s, {});
    const [row] = await s.inner.list({ workspaceId: WS, kind: 'vendor', ownerKey: OWNER, principalId: null });
    const policyCode = (e: unknown) => s.policy.vaultErrors.codeOf(e);
    expect(policyCode(await reason(Promise.resolve().then(() => entry.credentialSetVaultRecord({ row: { ...row!, ownerKey: 'x' }, policy: s.policy }))))).toBe('context');
    expect(policyCode(await reason(Promise.resolve().then(() => entry.credentialSetVaultRecord({ row: { ...row!, principalId: 'p' }, policy: s.policy }))))).toBe('context');
    expect(policyCode(await reason(Promise.resolve().then(() => entry.credentialSetVaultRecord({ row: { ...row!, binding: 'b' as never }, policy: s.policy }))))).toBe('context');
    expect(policyCode(await reason(Promise.resolve().then(() => entry.credentialSetVaultRecord({ row: { ...row!, provider: 'p' }, policy: s.policy }))))).toBe('context');
    expect(policyCode(await reason(Promise.resolve().then(() => entry.credentialSetVaultRecord({ row: { ...row!, sealed: null as never }, policy: s.policy }))))).toBe('invalid-record');
  });

  it('updates through the compatibility path: unchanged envelopes keep their hints, changed ones drop them', async () => {
    const s = makeHost();
    const made = await call(s, {});
    const stored = await s.repo.findById({ workspaceId: WS, id: made.id });
    const plain = { ...stored!, label: 'Renamed' };
    expect(plain.vaultRecord).toBeUndefined();
    const before = (await s.inner.find({ workspaceId: WS, id: made.id }))!;
    await s.repo.update(plain);
    const after = (await s.inner.find({ workspaceId: WS, id: made.id }))!;
    expect(after).toMatchObject({ label: 'Renamed', revision: before.revision + 1, last4: before.last4, tokenLength: before.tokenLength, createdAt: before.createdAt });
    await s.repo.update({ ...plain, sealed: { ...plain.sealed, ciphertext: 'different' }, label: 'Again' });
    const changed = (await s.inner.find({ workspaceId: WS, id: made.id }))!;
    expect(changed).toMatchObject({ label: 'Again', last4: null, tokenLength: null });
  });

  it('ignores a compatibility update for a row that no longer exists and deletes only existing rows with the CAS revision', async () => {
    const s = makeHost();
    const made = await call(s, {});
    const stored = (await s.repo.findById({ workspaceId: WS, id: made.id }))!;
    await s.repo.update({ ...stored, id: 'ghost' });
    expect(await s.inner.find({ workspaceId: WS, id: 'ghost' })).toBeNull();
    await s.repo.delete({ workspaceId: WS, id: 'ghost' });
    await s.repo.delete({ workspaceId: WS, id: made.id });
    expect(await s.inner.find({ workspaceId: WS, id: made.id })).toBeNull();
  });

  it('rewrites a legacy custom row under its own kind and keeps the stored default flag', async () => {
    const s = makeHost();
    const made = await call(s, {});
    const [row] = await s.inner.list({ workspaceId: WS, kind: 'vendor', ownerKey: OWNER, principalId: null });
    await s.inner.delete({ workspaceId: WS, id: made.id, expectedRevision: row!.revision });
    await s.inner.put({ record: { ...row!, kind: 'custom', isDefault: true }, expectedRevision: null });
    const stored = (await s.repo.findById({ workspaceId: WS, id: made.id }))!;
    await s.repo.update({ ...stored, label: 'Legacy renamed' });
    expect(await s.inner.find({ workspaceId: WS, id: made.id })).toMatchObject({ kind: 'custom', isDefault: true, label: 'Legacy renamed' });
  });

  it('turns a CAS conflict into the host label-conflict error when another row owns the label, else rethrows it', async () => {
    const s = makeHost();
    const one = await call(s, { label: 'One' });
    const two = await call(s, { label: 'Two' });
    const stored = (await s.repo.findById({ workspaceId: WS, id: two.id }))!;
    const conflict = new VaultError({ code: 'conflict' });
    const realPut = s.inner.put.bind(s.inner);
    s.inner.put = async () => { throw conflict; };
    await expect(s.repo.update({ ...stored, label: 'One' })).rejects.toThrow('SECOND-UNIQUE label');
    await expect(s.repo.update({ ...stored, label: 'Unused' })).rejects.toBe(conflict);
    s.inner.put = async () => { throw new Error('other'); };
    await expect(s.repo.update({ ...stored, label: 'One' })).rejects.toThrow('other');
    s.inner.put = realPut;
    expect(one.id).not.toBe(two.id);
  });

  it('uses an explicit scope for the vault context and omits the id when none is given', () => {
    expect(entry.credentialSetVaultScope({ workspaceId: WS, ownerKey: OWNER })).toEqual({ workspaceId: WS, kind: 'vendor', ownerKey: OWNER, principalId: null, binding: null });
    expect(entry.credentialSetVaultScope({ workspaceId: WS, ownerKey: OWNER, id: 'i', kind: 'custom' })).toEqual({ workspaceId: WS, kind: 'custom', ownerKey: OWNER, principalId: null, binding: null, id: 'i' });
  });
});

/** A second host that also has an attached project store: site rows first, then project rows. */
function makeProjectHost(project: { createRepo?: boolean; replaceRepo?: boolean; inventoryRepo?: boolean } = {}) {
  const s = makeHost();
  const projectInner = new InMemoryVaultRepo({});
  const projectRepo = new entry.CredentialSetVaultRepo<Cat>({ vault: projectInner as VaultRepoPort, policy: s.policy });
  const replaceRepo = new entry.CredentialSetVaultRepo<Cat>({ vault: projectInner as VaultRepoPort, policy: s.policy });
  const projectScope = {
    workspaceId: 'proj-ws', repo: projectRepo, sealer: s.deps.sealer, keyring: s.deps.keyring,
    ...(project.createRepo ? { createRepo: projectRepo } : {}), ...(project.replaceRepo ? { replaceRepo } : {}),
    ...(project.inventoryRepo ? { inventoryRepo: projectRepo } : {}),
  };
  const siteRepo = new entry.CredentialSetVaultRepo<Cat>({ vault: s.vault, policy: s.policy }, { project: projectScope });
  const deps: CredentialSetWriteDeps<Cat> = { ...s.deps, repo: siteRepo };
  s.host.scopes = (d, workspaceId) => [
    { deps: d, workspaceId, scope: 'site' as const },
    ...(d.repo.project ? [{ deps: { ...d, repo: d.repo.project.repo }, workspaceId: d.repo.project.workspaceId, scope: 'project' as const }] : []),
  ];
  s.host.createTarget = (d, i, refuse) => {
    if (i.scope === 'site' || !d.repo.project) return { deps: d, workspaceId: i.workspaceId, scope: 'site' as const };
    if (i.scope !== undefined && i.scope !== 'project') throw refuse('scope must be site or project');
    return { deps: { ...d, repo: d.repo.project.repo }, workspaceId: d.repo.project.workspaceId, scope: 'project' as const };
  };
  return { ...s, deps, projectInner, projectRepo, siteRepo };
}
const pcall = (s: ReturnType<typeof makeProjectHost>, over: Record<string, unknown>) =>
  entry.createCredentialSet({ host: s.host, deps: s.deps, input: { ...input, ...over } as never });

describe('project store', () => {
  it('writes to the project store by default and to this site when asked, reporting each scope', async () => {
    const s = makeProjectHost();
    const shared = await pcall(s, { label: 'Shared' });
    const own = await pcall(s, { label: 'Own', scope: 'site' });
    expect([shared.scope, own.scope]).toEqual(['project', 'site']);
    expect((await s.projectInner.list({ workspaceId: 'proj-ws', kind: 'vendor', ownerKey: OWNER, principalId: null })).map(r => r.label)).toEqual(['Shared']);
    expect((await s.inner.list({ workspaceId: WS, kind: 'vendor', ownerKey: OWNER, principalId: null })).map(r => r.label)).toEqual(['Own']);
    expect((await reason(pcall(s, { scope: 'elsewhere' }))).message).toBe('scope must be site or project');
  });

  it('lists effective rows with the site row overriding a same-label project row', async () => {
    const s = makeProjectHost();
    await pcall(s, { label: 'Same', baseUrl: 'https://project.test' });
    await pcall(s, { label: 'Same', baseUrl: 'https://site.test', scope: 'site' });
    await pcall(s, { label: 'Only-project' });
    const listed = await entry.listCredentialSets({ host: s.host, deps: s.deps, input: { workspaceId: WS } });
    expect(listed.map(x => `${x.label}:${x.scope}:${x.baseUrl}`)).toEqual(['Only-project:project:https://api.second.test', 'Same:site:https://site.test']);
    const found = await entry.describeCredentialSetByLabel({ host: s.host, deps: s.deps, input: { workspaceId: WS, label: 'Only-project' } });
    expect(found?.scope).toBe('project');
  });

  it('refuses a project row whose label this site already uses, with the same duplicate wording', async () => {
    const s = makeProjectHost();
    await pcall(s, { label: 'Taken', scope: 'site' });
    const error = await reason(pcall(s, { label: 'Taken' }));
    expect(error).toBeInstanceOf(entry.CustomCredentialDuplicateLabelError);
    expect(error.message).toBe('second dup Taken');
  });

  it('distinguishes a hidden project duplicate from a plain CAS conflict, and uses the project wording', async () => {
    const s = makeProjectHost();
    await pcall(s, { label: 'Hidden' });
    const conflict = new VaultError({ code: 'conflict' });
    s.projectRepo.insert = async () => { throw conflict; };
    const dup = await reason(pcall(s, { label: 'Hidden' }));
    expect(dup).toBeInstanceOf(entry.CustomCredentialDuplicateLabelError);
    expect(dup.message).toBe('second project dup Hidden');
    expect(await reason(pcall(s, { label: 'Fresh' }))).toBe(conflict);
    s.host.isUniqueViolation = () => true;
    expect((await reason(pcall(s, { label: 'Fresh' }))).message).toBe('second project dup Fresh');
  });

  it('refuses replacing or deleting a granted shared row unless the trusted owner session allows it', async () => {
    const s = makeProjectHost({ createRepo: true, replaceRepo: true });
    const made = await pcall(s, { label: 'Granted' });
    const update = (deps = s.deps) => entry.updateCredentialSet({ host: s.host, deps, input: { workspaceId: WS, id: made.id, label: 'Granted 2' } });
    expect((await reason(update())).message).toBe('second replace read-only');
    expect(await update({ ...s.deps, allowSharedKeyReplacement: true })).toMatchObject({ label: 'Granted 2', scope: 'project' });
    expect((await reason(entry.deleteCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: made.id } }))).message).toBe('second delete read-only');
  });

  it('refuses a trusted replacement when the project has no replace repository', async () => {
    const s = makeProjectHost({ createRepo: true });
    const made = await pcall(s, { label: 'Granted' });
    const error = await reason(entry.updateCredentialSet({ host: s.host, deps: { ...s.deps, allowSharedKeyReplacement: true }, input: { workspaceId: WS, id: made.id, label: 'x' } }));
    expect(error.message).toBe('second replace read-only');
  });

  it('updates and deletes an owned project row directly when the project has no shared-create repository', async () => {
    const s = makeProjectHost();
    const made = await pcall(s, { label: 'Owned' });
    expect((await entry.updateCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: made.id, category: 'blue' } })).category).toBe('blue');
    await entry.deleteCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: made.id } });
    expect(await entry.describeCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: made.id } })).toBeNull();
  });

  it('builds the admin inventory from the project inventory repo when present and from the scoped repo otherwise', async () => {
    const a = makeProjectHost({ inventoryRepo: true });
    await pcall(a, { label: 'B-proj' });
    await pcall(a, { label: 'A-site', scope: 'site' });
    expect((await entry.listCredentialSetInventory({ host: a.host, deps: a.deps, workspaceId: WS })).map(x => `${x.label}:${x.scope}`)).toEqual(['A-site:site', 'B-proj:project']);
    const b = makeProjectHost();
    await pcall(b, { label: 'C-proj' });
    expect((await entry.listCredentialSetInventory({ host: b.host, deps: b.deps, workspaceId: WS })).map(x => x.label)).toEqual(['C-proj']);
  });
});

describe('token hints', () => {
  it('reports length and last4 for a long token, only length for a short one, and no hint once the envelope changed under compatibility rules', async () => {
    const s = makeHost();
    const long = await call(s, { label: 'Long' });
    const short = await call(s, { label: 'Short', connection: { token: 'abcdefgh' } });
    expect(long.tokenHint).toEqual({ length: 20, last4: 'mnop' });
    expect(short.tokenHint).toEqual({ length: 8, last4: null });
    const stored = (await s.repo.findById({ workspaceId: WS, id: long.id }))!;
    await s.repo.update({ ...stored, sealed: { ...stored.sealed, ciphertext: 'other' } });
    expect((await entry.describeCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: long.id } }))?.tokenHint).toBeNull();
  });
});

describe('remaining store and repository branches', () => {
  /** Re-labels the stored row as a legacy `custom`-kind row (envelope untouched, so it is never opened here). */
  async function makeLegacy(s: ReturnType<typeof makeHost>, id: string, dropMeta: string[] = []) {
    const [row] = await s.inner.list({ workspaceId: WS, kind: 'vendor', ownerKey: OWNER, principalId: null });
    await s.inner.delete({ workspaceId: WS, id, expectedRevision: row!.revision });
    const meta = { ...row!.meta } as Record<string, unknown>;
    for (const key of dropMeta) delete meta[key];
    await s.inner.put({ record: { ...row!, kind: 'custom', meta: meta as never }, expectedRevision: null });
  }

  it('maps a token input error from normalization to a validation error with its message', async () => {
    const error = await reason(call(makeHost(), { connection: { token: '   ' } }));
    expect(error).toBeInstanceOf(entry.CustomCredentialValidationError);
    expect(error.message).toBe('second: token needed');
  });

  it('updates a legacy custom-kind row under its own kind without opening it, tolerating a missing worksFor', async () => {
    const s = makeHost();
    const made = await call(s, {});
    await makeLegacy(s, made.id, ['worksFor']);
    const next = await entry.updateCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: made.id, category: 'blue' } });
    expect(next).toMatchObject({ category: 'blue', worksFor: [] });
    expect((await s.inner.find({ workspaceId: WS, id: made.id }))!.kind).toBe('custom');
    expect(s.counts.open).toBe(0);
  });

  it('resolves a token-only credential without a username', async () => {
    const s = makeHost();
    await call(s, {});
    expect((await entry.resolveCredentialSetByLabel({ host: s.host, deps: s.deps, input: { workspaceId: WS, label: 'Main' } }))?.connection).toEqual({ token: 'tok-abcdefghijklmnop' });
  });

  it('writes a plain record through the compatibility path on insert, defaulting hints, flag, revision and worksFor', async () => {
    const s = makeHost();
    const made = await call(s, {});
    const stored = (await s.repo.findById({ workspaceId: WS, id: made.id }))!;
    const { worksFor: _drop, ...rest } = { ...stored };
    await s.repo.insert({ ...rest, id: 'fresh-1', label: 'Fresh' } as never);
    expect(await s.inner.find({ workspaceId: WS, id: 'fresh-1' })).toMatchObject({
      label: 'Fresh', kind: 'vendor', isDefault: false, revision: 1, last4: null, tokenLength: null, meta: expect.objectContaining({ worksFor: [] }),
    });
  });

  it('keeps stored worksFor on a compatibility update whose record carries none', async () => {
    const s = makeHost();
    const made = await call(s, { worksFor: ['w9'] });
    const stored = (await s.repo.findById({ workspaceId: WS, id: made.id }))!;
    const { worksFor: _drop, ...rest } = { ...stored };
    await s.repo.update({ ...rest, label: 'Kept' } as never);
    expect((await s.inner.find({ workspaceId: WS, id: made.id }))!.meta.worksFor).toEqual(['w9']);
  });

  it('refuses a prepared record whose vault row names another workspace or id than the record', async () => {
    const s = makeHost();
    const made = await call(s, {});
    const stored = (await s.repo.findById({ workspaceId: WS, id: made.id }))!;
    const prepared = (stored as unknown as { vaultRecord: unknown }).vaultRecord;
    for (const over of [{ id: 'other-id' }, { workspaceId: 'other-ws' }]) {
      const copy = { ...stored, ...over };
      Object.defineProperty(copy, 'vaultRecord', { value: prepared });
      Object.defineProperty(copy, 'vaultExpectedRevision', { value: 1 });
      const error = await reason(s.repo.update(copy as never));
      expect(s.policy.vaultErrors.codeOf(error)).toBe('context');
    }
  });

  it('summarizes a record that carries no vault row without a token hint', async () => {
    const s = makeHost();
    const made = await call(s, {});
    const stored = (await s.repo.findById({ workspaceId: WS, id: made.id }))!;
    const plain = { ...stored };
    const repo = { ...s.repo, findById: async () => plain, listByWorkspace: async () => [], vault: s.vault } as never;
    const summary = await entry.describeCredentialSet({ host: s.host, deps: { ...s.deps, repo }, input: { workspaceId: WS, id: made.id } });
    expect(summary).toMatchObject({ id: made.id, label: 'Main', tokenHint: null });
  });
});
