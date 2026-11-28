import { describe, expect, it } from 'vitest';
import { VaultError, type VaultPutRecord } from '@jini-ai/core/contracts/vault';
import type { CredentialSetRecord } from '@jini-ai/core/contracts/credentials';
import { createCredentialSet } from '../store.js';
import { credentialSetVaultRecord, credentialSetVaultScope, CredentialSetVaultRepo } from '../vault-repo.js';
import { host, input, makeSets, OWNER, policy, seedLegacyCustomRow, WS, type Cat } from './sets-harness.js';

/**
 * @file The credential-set vault repo's compatibility path: plain record DTOs (no prepared vault row)
 * written through it, the ownership refusals of the row reader, and the label-conflict mapping.
 */

const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error('expected a rejection'); }, (error: unknown) => error);
const rows = async (sets: ReturnType<typeof makeSets>, kind: 'vendor' | 'custom' = 'vendor') => sets.inner.list({ workspaceId: WS, kind, ownerKey: OWNER, principalId: null });

/** A saved row read back as a plain DTO: spreading drops the private prepared row and revision. */
async function savedDto(sets: ReturnType<typeof makeSets>, over: Record<string, unknown> = {}): Promise<CredentialSetRecord<Cat>> {
  const made = await createCredentialSet({ host, deps: sets.deps, input: { ...input, ...over } });
  const found = await sets.repo.findById({ workspaceId: WS, id: made.id });
  if (!found) throw new Error('saved row must read back');
  return { ...found };
}

describe('compatibility writes of plain records', () => {
  it('an update of an unchanged envelope keeps the stored hints, kind, default flag and creation time', async () => {
    const sets = makeSets();
    const dto = await savedDto(sets, { connection: { token: 'tok-abcdefghijklmnop', username: 'ada' } });
    expect(dto).not.toHaveProperty('vaultRecord');
    const { username: _cleared, ...withoutUsername } = dto;
    await sets.repo.update({ ...withoutUsername, label: 'Renamed', updatedAt: '2026-12-01T00:00:00.000Z' });
    const [row] = await rows(sets);
    expect(row).toMatchObject({ kind: 'vendor', label: 'Renamed', revision: 2, last4: 'mnop', tokenLength: 20, isDefault: true,
      createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-12-01T00:00:00.000Z' });
    expect(row?.meta).toMatchObject({ credentialType: 'custom', username: null, worksFor: [], category: 'red' });
  });

  it('a changed envelope drops the hints; a record without worksFor keeps the stored list', async () => {
    const sets = makeSets();
    const dto = await savedDto(sets, { worksFor: ['agent-a'] });
    const changes: ReadonlyArray<Partial<CredentialSetRecord<Cat>['sealed']>> = [{ nonce: 'other-nonce' }, { alg: 'other-alg' }, { ciphertext: 'other' }, { keyId: 'k2' }];
    for (const change of changes) {
      const current = await sets.repo.findById({ workspaceId: WS, id: dto.id });
      if (!current) throw new Error('row must exist');
      const { worksFor: _dropped, ...withoutWorksFor } = { ...current };
      await sets.repo.update({ ...withoutWorksFor, sealed: { ...current.sealed, ...change } });
      const [row] = await rows(sets);
      expect([row?.last4, row?.tokenLength], JSON.stringify(change)).toEqual([null, null]);
      expect(row?.meta.worksFor).toEqual(['agent-a']);
    }
  });

  it('a legacy custom row stays custom when rewritten from a plain record', async () => {
    const sets = makeSets();
    await seedLegacyCustomRow(sets, { id: 'legacy-1', label: 'Legacy', token: 'tok-legacy-0001' });
    const found = await sets.repo.findById({ workspaceId: WS, id: 'legacy-1' });
    if (!found) throw new Error('legacy row must read');
    await sets.repo.update({ ...found, label: 'Legacy 2' });
    expect((await rows(sets, 'custom')).map(row => [row.label, row.revision])).toEqual([['Legacy 2', 2]]);
    expect(await rows(sets)).toEqual([]);
  });

  it('a plain insert is a new vendor row with no hints; updating a missing id writes nothing', async () => {
    const sets = makeSets();
    const dto = await savedDto(sets, { worksFor: ['agent-a'] });
    const { worksFor: _none, ...withoutWorksFor } = dto;
    await sets.repo.insert({ ...withoutWorksFor, id: 'copy-1', label: 'Copy' });
    const copy = (await rows(sets)).find(row => row.id === 'copy-1');
    expect(copy).toMatchObject({ kind: 'vendor', revision: 1, last4: null, tokenLength: null, isDefault: false, createdAt: dto.createdAt });
    expect(copy?.meta.worksFor).toEqual([]);
    await sets.repo.update({ ...dto, id: 'missing', label: 'Ghost' });
    expect((await rows(sets)).map(row => row.id).sort()).toEqual(['copy-1', 'id-1']);
  });
});

describe('write failures', () => {
  it('a vault conflict without a same-label row is a CAS conflict, and other failures surface unchanged', async () => {
    const sets = makeSets();
    const dto = await savedDto(sets);
    const stale = await failure(sets.repo.insert({ ...dto }));
    expect(stale).toBeInstanceOf(VaultError);
    expect((stale as VaultError).code).toBe('conflict');
    const broken = new Error('disk full');
    const failing = new CredentialSetVaultRepo<Cat>({ vault: Object.assign(Object.create(sets.inner), { put: async () => { throw broken; } }), policy });
    expect(await failure(failing.insert({ ...dto, id: 'x', label: 'X' }))).toBe(broken);
  });
});

describe('reading rows', () => {
  it('lists only custom credential rows in label order and resolves a label only to a custom row', async () => {
    const sets = makeSets();
    await savedDto(sets, { label: 'b-second' });
    await seedLegacyCustomRow(sets, { id: 'legacy-1', label: 'a-first', token: 'tok-legacy-0001' });
    const vendorRow: VaultPutRecord = { workspaceId: WS, kind: 'vendor', ownerKey: OWNER, principalId: null, binding: null, id: 'vendor-1', provider: null,
      label: 'vendor key', sealed: null, revision: 1, last4: null, tokenLength: null, createdAt: 'then', updatedAt: 'then',
      meta: { credentialType: 'vendor', worksFor: [] } };
    await sets.inner.put({ record: vendorRow, expectedRevision: null });
    expect((await sets.repo.listByWorkspace({ workspaceId: WS })).map(record => record.label)).toEqual(['a-first', 'b-second']);
    expect(await sets.repo.findById({ workspaceId: WS, id: 'vendor-1' })).toBeNull();
    const byLabel = makeSets({ findRowByLabel: async ({ label }) => (label === 'vendor key' ? vendorRow : label === 'legacy' ? legacy : null) });
    const legacy = await seedLegacyCustomRow(byLabel, { id: 'legacy-1', label: 'legacy', token: 'tok-legacy-0001' });
    expect(await byLabel.repo.findByLabel?.({ workspaceId: WS, label: 'vendor key' })).toBeNull();
    expect(await byLabel.repo.findByLabel?.({ workspaceId: WS, label: 'nothing' })).toBeNull();
    expect((await byLabel.repo.findByLabel?.({ workspaceId: WS, label: 'legacy' }))?.id).toBe('legacy-1');
  });

  it('refuses rows outside the trusted ownership as context errors and an envelope-less row as invalid', async () => {
    const sets = makeSets();
    const legacy = await seedLegacyCustomRow(sets, { id: 'legacy-1', label: 'Legacy', token: 'tok-legacy-0001' });
    const codeOf = (row: VaultPutRecord) => { try { credentialSetVaultRecord({ row, policy }); return 'accepted'; } catch (error) { return policy.vaultErrors.codeOf(error); } };
    expect(codeOf(legacy)).toBe('accepted');
    for (const over of [{ ownerKey: 'other' }, { principalId: 'p-1' }, { binding: 'b-1' }, { provider: 'acme' }, { kind: 'vendor' as const, meta: { ...legacy.meta, credentialType: 'vendor' } }]) {
      expect(codeOf({ ...legacy, ...over }), JSON.stringify(over)).toBe('context');
    }
    expect(codeOf({ ...legacy, sealed: null })).toBe('invalid-record');
  });

  it('a prepared row for another id or workspace is refused before any write', async () => {
    const sets = makeSets();
    await savedDto(sets);
    const prepared = await sets.repo.findById({ workspaceId: WS, id: 'id-1' });
    if (!prepared?.vaultRecord) throw new Error('prepared row expected');
    for (const over of [{ id: 'other' }, { workspaceId: 'ws-2' }]) {
      const record = credentialSetVaultRecord<Cat>({ row: prepared.vaultRecord, expectedRevision: 1, policy });
      const error = await failure(sets.repo.update({ ...record, ...over, vaultRecord: prepared.vaultRecord, vaultExpectedRevision: 1 }));
      expect(policy.vaultErrors.codeOf(error), JSON.stringify(over)).toBe('context');
    }
    expect((await rows(sets)).map(row => row.revision)).toEqual([1]);
  });

  it('the vault scope carries the trusted owner with null principal and binding, and an id only when given', () => {
    expect(credentialSetVaultScope({ workspaceId: WS, ownerKey: OWNER })).toEqual({ workspaceId: WS, kind: 'vendor', ownerKey: OWNER, principalId: null, binding: null });
    expect(credentialSetVaultScope({ workspaceId: WS, ownerKey: OWNER, kind: 'custom', id: 'r-1' })).toEqual({ workspaceId: WS, kind: 'custom', ownerKey: OWNER, principalId: null, binding: null, id: 'r-1' });
  });
});
