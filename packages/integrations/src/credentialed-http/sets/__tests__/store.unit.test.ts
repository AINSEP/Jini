import { describe, expect, it } from 'vitest';
import { VaultError } from '@jini-ai/core/contracts/vault';
import {
  createCredentialSet, CustomCredentialDuplicateLabelError, CustomCredentialNotFoundError, CustomCredentialSecretStoreUnconfiguredError,
  CustomCredentialValidationError, deleteCredentialSet, describeCredentialSet, describeCredentialSetByLabel, listCredentialSetInventory,
  listCredentialSets, resolveCredentialSetByLabel, updateCredentialSet,
} from '../store.js';
import { CredentialSetVaultRepo } from '../vault-repo.js';
import { host, input, makeSets, OWNER, policy, PROJECT_WS, seedLegacyCustomRow, WS, type Cat } from './sets-harness.js';

/**
 * @file Credential-set store over the real in-memory vault and AES-GCM sealer: read models never open
 * an envelope, validation names the field, writes land in the store the scope policy picks, and a
 * resolve opens exactly the selected row.
 */

const create = (sets: ReturnType<typeof makeSets>, over: Record<string, unknown> = {}) =>
  createCredentialSet({ host, deps: sets.deps, input: { ...input, ...over } });
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error('expected a rejection'); }, (error: unknown) => error);

describe('read models', () => {
  it('describes a row by id and by label from metadata only, with a hint only for long tokens', async () => {
    const sets = makeSets();
    const made = await create(sets, { additionalHosts: ['https://cdn.second.test/path'], worksFor: ['agent-a'], connection: { token: 'tok-abcdefghijklmnop', username: 'ada' } });
    const short = await create(sets, { label: 'Short', connection: { token: 'tok-short' } });
    expect(await describeCredentialSet({ host, deps: sets.deps, input: { workspaceId: WS, id: made.id } })).toEqual({
      credentialType: 'custom', worksFor: ['agent-a'], id: 'id-1', label: 'Main', category: 'red', baseUrl: 'https://api.second.test',
      additionalHosts: ['https://cdn.second.test'], username: 'ada', configured: true, tokenHint: { length: 20, last4: 'mnop' },
      createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z' });
    const byLabel = await describeCredentialSetByLabel({ host, deps: sets.deps, input: { workspaceId: WS, label: 'Short' } });
    expect(byLabel).toMatchObject({ id: short.id, tokenHint: { length: 9, last4: null } });
    expect(byLabel).not.toHaveProperty('username');
    expect(byLabel).not.toHaveProperty('scope');
    expect(await describeCredentialSet({ host, deps: sets.deps, input: { workspaceId: WS, id: 'nope' } })).toBeNull();
    expect(await describeCredentialSetByLabel({ host, deps: sets.deps, input: { workspaceId: WS, label: 'Nope' } })).toBeNull();
  });

  it('a legacy row without stored hints reports no token hint and empty worksFor', async () => {
    const sets = makeSets();
    await seedLegacyCustomRow(sets, { id: 'legacy-1', label: 'Legacy', token: 'tok-legacy-0001' });
    expect(await describeCredentialSet({ host, deps: sets.deps, input: { workspaceId: WS, id: 'legacy-1' } })).toMatchObject({
      id: 'legacy-1', category: 'blue', worksFor: [], tokenHint: null });
    // A writer that stored a suffix for a short token still never gets it shown: under 12 characters, no last4.
    await seedLegacyCustomRow(sets, { id: 'legacy-2', label: 'Legacy short', token: 'tok-short', last4: 'hort', tokenLength: 9 });
    expect((await describeCredentialSet({ host, deps: sets.deps, input: { workspaceId: WS, id: 'legacy-2' } }))?.tokenHint).toEqual({ length: 9, last4: null });
  });

  it('with a project attached, site rows override project rows of the same label and summaries report their scope', async () => {
    const sets = makeSets({ project: true });
    await create(sets, { label: 'Shared', scope: 'project' });
    await create(sets, { label: 'Only-project', scope: 'project' });
    const site = await create(sets, { label: 'Site', scope: 'site' });
    expect(site.scope).toBe('site');
    const listed = await listCredentialSets({ host, deps: sets.deps, input: { workspaceId: WS } });
    expect(listed.map(item => [item.label, item.scope])).toEqual([['Only-project', 'project'], ['Shared', 'project'], ['Site', 'site']]);
    expect(await describeCredentialSet({ host, deps: sets.deps, input: { workspaceId: WS, id: 'id-1' } })).toMatchObject({ label: 'Shared', scope: 'project' });
    expect(await describeCredentialSetByLabel({ host, deps: sets.deps, input: { workspaceId: WS, label: 'Only-project' } })).toMatchObject({ scope: 'project' });
  });

  it('the admin inventory reads the project half through its inventory repo when one is attached', async () => {
    const plain = makeSets({ project: true });
    await create(plain, { label: 'Project key', scope: 'project' });
    await create(plain, { label: 'Site key', scope: 'site' });
    expect((await listCredentialSetInventory({ host, deps: plain.deps, workspaceId: WS })).map(item => [item.label, item.scope]))
      .toEqual([['Project key', 'project'], ['Site key', 'site']]);
    const seen: string[] = [];
    const inventoryRepo = { listByWorkspace: async ({ workspaceId }: { workspaceId: string }) => { seen.push(workspaceId); return []; } };
    const withInventory = makeSets({ project: { inventoryRepo } });
    await create(withInventory, { label: 'Hidden', scope: 'project' });
    expect(await listCredentialSetInventory({ host, deps: withInventory.deps, workspaceId: WS })).toEqual([]);
    expect(seen).toEqual([PROJECT_WS]);
  });

  it('label lookup asks the repo indexed finder instead of scanning when one is supplied', async () => {
    const asked: unknown[] = [];
    const sets = makeSets({ findRowByLabel: async query => { asked.push(query); return null; } });
    await create(sets);
    expect(await describeCredentialSetByLabel({ host, deps: sets.deps, input: { workspaceId: WS, label: 'Main' } })).toBeNull();
    expect(asked).toEqual([{ workspaceId: WS, label: 'Main' }]);
  });
});

describe('validation', () => {
  const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
    [{ label: 'x'.repeat(201) }, 'label must be 200 characters or fewer'],
    [{ label: 'PASTED-SECRET' }, 'second: label looks like a secret'],
    [{ category: 'PASTED-SECRET' }, 'second: category looks like a secret'],
    [{ baseUrl: ' ' }, 'baseUrl must be a non-empty string'],
    [{ baseUrl: 'not a url' }, 'baseUrl must be a valid absolute URL'],
    [{ baseUrl: 'ftp://files.second.test' }, 'baseUrl must use http or https'],
    [{ additionalHosts: 'https://cdn.second.test' }, 'additionalHosts must be an array of absolute http/https URLs'],
    [{ additionalHosts: ['https://ok.second.test', ''] }, 'additionalHosts[1] must be a non-empty string'],
    [{ additionalHosts: ['nope'] }, 'additionalHosts[0] must be a valid absolute URL'],
    [{ additionalHosts: ['mailto:a@second.test'] }, 'additionalHosts[0] must use http or https'],
    [{ additionalHosts: ['https://PASTED-SECRET.second.test'] }, 'second: additionalHosts looks like a secret'],
    [{ connection: 'tok-abc' }, 'connection must be an object'],
    [{ connection: { token: 'tok-abcdefghijklmnop', username: ' ' } }, "'username' must be a non-empty string when provided"],
    [{ connection: { token: 'tok-abcdefghijklmnop', username: 'PASTED-SECRET' } }, 'second: username looks like a secret'],
    [{ worksFor: 'agent-a' }, 'second worksFor'],
    [{ worksFor: ['PASTED-SECRET'] }, 'second: worksFor looks like a secret'],
    [{ scope: 'galaxy' }, 'scope must be site or project'],
  ];
  it('names the first invalid field as a validation error and writes nothing', async () => {
    for (const [over, message] of cases) {
      const sets = makeSets();
      const error = await failure(create(sets, over));
      expect(error, message).toBeInstanceOf(CustomCredentialValidationError);
      expect((error as Error).message).toBe(message);
      expect(await listCredentialSets({ host, deps: sets.deps, input: { workspaceId: WS } })).toEqual([]);
    }
  });

  it('non-input failures from the host token and worksFor policies propagate unchanged', async () => {
    const boom = new Error('policy crashed');
    const crashing = [
      { ...host, token: { ...host.token, normalize: () => { throw boom; } } },
      { ...host, token: { ...host.token, assertFreeField: () => { throw boom; } } },
    ];
    for (const broken of crashing) expect(await failure(createCredentialSet({ host: broken, deps: makeSets().deps, input }))).toBe(boom);
    const typeError = await failure(create(makeSets(), { worksFor: [7] }));
    expect(typeError).toBeInstanceOf(TypeError);
    expect((typeError as Error).message).toBe('second: worksFor ids are strings');
  });
});


const resolve = (sets: ReturnType<typeof makeSets>, label: string) => resolveCredentialSetByLabel({ host, deps: sets.deps, input: { workspaceId: WS, label } });
const update = (sets: ReturnType<typeof makeSets>, over: Record<string, unknown>) => updateCredentialSet({ host, deps: sets.deps, input: { workspaceId: WS, id: 'id-1', ...over } });

describe('updates', () => {
  it('replaces only the supplied metadata; a blank connection keeps the sealed token and its username', async () => {
    const sets = makeSets();
    await create(sets, { connection: { token: 'tok-abcdefghijklmnop', username: 'ada' } });
    const updated = await update(sets, { label: 'Renamed', category: 'blue', baseUrl: 'http://other.second.test', additionalHosts: ['https://h.second.test/p'], worksFor: ['agent-b'], connection: { token: '' } });
    expect(updated).toMatchObject({ id: 'id-1', label: 'Renamed', category: 'blue', baseUrl: 'http://other.second.test', additionalHosts: ['https://h.second.test'],
      worksFor: ['agent-b'], username: 'ada', tokenHint: { length: 20, last4: 'mnop' } });
    expect(await resolve(sets, 'Renamed')).toEqual({ id: 'id-1', category: 'blue', baseUrl: 'http://other.second.test', additionalHosts: ['https://h.second.test'],
      connection: { token: 'tok-abcdefghijklmnop', username: 'ada' } });
    expect(await update(sets, {})).toMatchObject({ label: 'Renamed', worksFor: ['agent-b'], username: 'ada' });
  });

  it('a new connection resets the username; a top-level username sets it and null clears it', async () => {
    const sets = makeSets();
    await create(sets, { connection: { token: 'tok-abcdefghijklmnop', username: 'ada' } });
    const replaced = await update(sets, { connection: { token: 'tok-zyxwvutsrqpo' } });
    expect(replaced).not.toHaveProperty('username');
    expect(replaced.tokenHint).toEqual({ length: 16, last4: 'rqpo' });
    expect((await update(sets, { username: 'bob' })).username).toBe('bob');
    expect((await resolve(sets, 'Main'))?.connection).toEqual({ token: 'tok-zyxwvutsrqpo', username: 'bob' });
    expect(await update(sets, { username: null })).not.toHaveProperty('username');
    expect((await resolve(sets, 'Main'))?.connection).toEqual({ token: 'tok-zyxwvutsrqpo' });
    for (const [username, message] of [[' ', "'username' must be a non-empty string, or null to clear it"], ['PASTED-SECRET', 'second: username looks like a secret']] as const) {
      const error = await failure(update(sets, { username }));
      expect(error).toBeInstanceOf(CustomCredentialValidationError);
      expect((error as Error).message).toBe(message);
    }
  });

  it('a legacy custom-kind row keeps its stored kind on update and still opens', async () => {
    const sets = makeSets();
    await seedLegacyCustomRow(sets, { id: 'id-1', label: 'Legacy', token: 'tok-legacy-0001' });
    expect(await update(sets, { label: 'Legacy renamed' })).toMatchObject({ label: 'Legacy renamed', category: 'blue' });
    const [row] = await sets.inner.list({ workspaceId: WS, kind: 'custom', ownerKey: OWNER, principalId: null });
    expect([row?.kind, row?.label, row?.revision]).toEqual(['custom', 'Legacy renamed', 2]);
    expect((await resolve(sets, 'Legacy renamed'))?.connection).toEqual({ token: 'tok-legacy-0001' });
  });

  it('a project row cannot be renamed to, or created under, a label this site already uses', async () => {
    const sets = makeSets({ project: true });
    await create(sets, { label: 'Project', scope: 'project' });
    await create(sets, { label: 'Site', scope: 'site' });
    for (const attempt of [update(sets, { label: 'Site' }), create(sets, { label: 'Site' })]) {
      const error = await failure(attempt);
      expect(error).toBeInstanceOf(CustomCredentialDuplicateLabelError);
      expect((error as Error).message).toBe('second dup Site');
    }
    expect((await listCredentialSetInventory({ host, deps: sets.deps, workspaceId: WS })).map(item => item.label)).toEqual(['Project', 'Site']);
  });
});

class RecordingRepo extends CredentialSetVaultRepo<Cat> {
  readonly updated: string[] = [];
  override async update(record: Parameters<CredentialSetVaultRepo<Cat>['update']>[0]): Promise<void> { this.updated.push(record.id); await super.update(record); }
}

describe('hosts whose metadata policy keeps absent fields absent', () => {
  it('a row without worksFor summarizes and updates as an empty compatibility list', async () => {
    const sets = makeSets();
    const loose = { ...policy, parseMeta: ({ meta }: { meta: unknown }) => JSON.parse(JSON.stringify(meta)) };
    const looseHost = { ...host, vault: loose };
    const deps = { ...sets.deps, repo: new CredentialSetVaultRepo<Cat>({ vault: sets.inner, policy: loose }) };
    await seedLegacyCustomRow(sets, { id: 'id-1', label: 'Old', token: 'tok-legacy-0001',
      meta: { credentialType: 'custom', category: 'blue', baseUrl: 'https://legacy.second.test', additionalHosts: [], username: null } });
    expect((await describeCredentialSet({ host: looseHost, deps, input: { workspaceId: WS, id: 'id-1' } }))?.worksFor).toEqual([]);
    expect((await updateCredentialSet({ host: looseHost, deps, input: { workspaceId: WS, id: 'id-1', label: 'Old renamed' } })).worksFor).toEqual([]);
    const [row] = await sets.inner.list({ workspaceId: WS, kind: 'custom', ownerKey: OWNER, principalId: null });
    expect(row?.meta.worksFor).toEqual([]);
  });

  it('an update connection must be an object; one without a token counts as blank and keeps the envelope', async () => {
    const sets = makeSets();
    await create(sets);
    for (const connection of ['tok-abc', ['tok-abc']]) {
      const error = await failure(update(sets, { connection }));
      expect(error).toBeInstanceOf(CustomCredentialValidationError);
      expect((error as Error).message).toBe('connection must be an object');
    }
    expect((await update(sets, { connection: { username: 'ignored' } })).tokenHint).toEqual({ length: 20, last4: 'mnop' });
    expect((await resolve(sets, 'Main'))?.connection).toEqual({ token: 'tok-abcdefghijklmnop' });
  });
});

describe('shared project rows', () => {
  it('replacing a granted shared row needs the trusted flag and a replacement repo, and then writes through it', async () => {
    const owner = makeSets({ project: true });
    await create(owner, { label: 'Shared', scope: 'project' });
    const replaceRepo = new RecordingRepo({ vault: owner.inner, policy });
    const base = { workspaceId: PROJECT_WS, repo: owner.base, sealer: owner.sealer, keyring: owner.keyring, createRepo: owner.base };
    const site = (project: Record<string, unknown>, allowSharedKeyReplacement?: boolean) => ({ ...owner.deps,
      repo: new CredentialSetVaultRepo<Cat>({ vault: owner.inner, policy }, { project: { ...base, ...project } }), ...(allowSharedKeyReplacement === undefined ? {} : { allowSharedKeyReplacement }) });
    for (const deps of [site({ replaceRepo }), site({}, true)]) {
      const error = await failure(updateCredentialSet({ host, deps, input: { workspaceId: WS, id: 'id-1', label: 'Changed' } }));
      expect(error).toBeInstanceOf(CustomCredentialValidationError);
      expect((error as Error).message).toBe('second replace read-only');
    }
    expect(replaceRepo.updated).toEqual([]);
    const replaced = await updateCredentialSet({ host, deps: site({ replaceRepo }, true), input: { workspaceId: WS, id: 'id-1', label: 'Changed' } });
    expect(replaced).toMatchObject({ label: 'Changed', scope: 'project' });
    expect(replaceRepo.updated).toEqual(['id-1']);
  });

  it('delete removes a site row, ignores an unknown id, and refuses a granted shared row', async () => {
    const sets = makeSets({ project: true });
    await create(sets, { label: 'Project', scope: 'project' });
    await create(sets, { label: 'Site', scope: 'site' });
    await deleteCredentialSet({ host, deps: sets.deps, input: { workspaceId: WS, id: 'id-2' } });
    await deleteCredentialSet({ host, deps: sets.deps, input: { workspaceId: WS, id: 'nope' } });
    expect((await listCredentialSets({ host, deps: sets.deps, input: { workspaceId: WS } })).map(item => item.label)).toEqual(['Project']);
    await deleteCredentialSet({ host, deps: sets.deps, input: { workspaceId: WS, id: 'id-1' } });
    expect(await listCredentialSets({ host, deps: sets.deps, input: { workspaceId: WS } })).toEqual([]);
    const granted = makeSets({ project: true });
    await create(granted, { label: 'Granted', scope: 'project' });
    const deps = { ...granted.deps, repo: new CredentialSetVaultRepo<Cat>({ vault: granted.inner, policy }, { project: { workspaceId: PROJECT_WS, repo: granted.base, sealer: granted.sealer, keyring: granted.keyring, createRepo: granted.base } }) };
    const error = await failure(deleteCredentialSet({ host, deps, input: { workspaceId: WS, id: 'id-1' } }));
    expect((error as Error).message).toBe('second delete read-only');
    expect((await listCredentialSets({ host, deps, input: { workspaceId: WS } })).map(item => item.label)).toEqual(['Granted']);
  });
});

/** The real repo with its insert replaced by one failure (prototype wrapper, as hosts derive repos). */
function failingInsert(sets: ReturnType<typeof makeSets>, error: unknown) {
  const repo: CredentialSetVaultRepo<Cat> = Object.create(sets.repo);
  repo.insert = async () => { throw error; };
  return { ...sets.deps, repo };
}

describe('save failures', () => {
  it('maps create conflicts and unique violations to the duplicate-label error of the target store', async () => {
    const site = makeSets();
    const cases: ReadonlyArray<readonly [unknown, string, ReturnType<typeof makeSets>]> = [
      [new TypeError('second create conflict'), 'second create conflict', site],
      [new Error('SECOND-UNIQUE label'), 'second dup Main', site],
      [new Error('SECOND-UNIQUE label'), 'second project dup Main', makeSets({ project: true })],
    ];
    for (const [thrown, message, sets] of cases) {
      const error = await failure(createCredentialSet({ host, deps: failingInsert(sets, thrown), input }));
      expect(error).toBeInstanceOf(CustomCredentialDuplicateLabelError);
      expect((error as Error).message).toBe(message);
    }
  });

  it('a project CAS conflict is a duplicate only when a hidden project row already holds the label', async () => {
    const sets = makeSets({ project: true });
    const conflict = new VaultError({ code: 'conflict' });
    expect(await failure(createCredentialSet({ host, deps: failingInsert(sets, conflict), input: { ...input, label: 'Fresh' } }))).toBe(conflict);
    await create(sets, { label: 'Fresh', scope: 'project' });
    const error = await failure(createCredentialSet({ host, deps: failingInsert(sets, conflict), input: { ...input, label: 'Fresh' } }));
    expect((error as Error).message).toBe('second project dup Fresh');
    const other = new Error('disk full');
    expect(await failure(createCredentialSet({ host, deps: failingInsert(makeSets(), other), input }))).toBe(other);
  });

  it('a duplicate label inside one store surfaces through the vault conflict as the host duplicate error', async () => {
    const sets = makeSets();
    await create(sets);
    await create(sets, { label: 'Second' });
    const error = await failure(update(sets, { id: 'id-2', label: 'Main' }));
    expect(error).toBeInstanceOf(CustomCredentialDuplicateLabelError);
    expect((error as Error).message).toBe('second dup Main');
  });
});

describe('resolve', () => {
  it('returns null for an unknown label and for a row deleted between selection and opening', async () => {
    let selected: Awaited<ReturnType<typeof seedLegacyCustomRow>> | null = null;
    const sets = makeSets({ findRowByLabel: async () => selected });
    expect(await resolve(sets, 'Legacy')).toBeNull();
    selected = await seedLegacyCustomRow(sets, { id: 'legacy-1', label: 'Legacy', token: 'tok-legacy-0001' });
    expect(await resolve(sets, 'Legacy')).toEqual({ id: 'legacy-1', category: 'blue', baseUrl: 'https://legacy.second.test', additionalHosts: [], connection: { token: 'tok-legacy-0001' } });
    await sets.inner.delete({ workspaceId: WS, id: 'legacy-1', expectedRevision: 1 });
    expect(await resolve(sets, 'Legacy')).toBeNull();
  });

  it('a sealed payload without a token is a storage failure, not an empty credential', async () => {
    const sets = makeSets();
    await seedLegacyCustomRow(sets, { id: 'legacy-1', label: 'Broken', token: 'unused', payload: { secret: 'tok-x' } });
    const error = await failure(resolve(sets, 'Broken'));
    expect(error).toBeInstanceOf(CustomCredentialSecretStoreUnconfiguredError);
    expect((error as Error).message).toBe('second storage');
  });

  it('an update of an unknown id is not found', async () => {
    const error = await failure(update(makeSets(), { id: 'nope' }));
    expect(error).toBeInstanceOf(CustomCredentialNotFoundError);
    expect((error as Error).message).toBe('second missing nope');
  });
});
