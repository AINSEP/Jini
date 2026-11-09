import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { VaultRepoPort } from '@jini-ai/core/contracts/vault';
import { AesGcmSecretSealer } from '@jini-ai/platform/secrets';
import { createVaultMetaParsers, InMemoryVaultRepo, SecretsVaultService, VaultError } from '@jini-ai/platform/secrets/credential-sets';
import { InMemoryKeyring } from '@jini-ai/platform/secrets/testing';
import * as entry from '../index.js';
import * as storeModule from '../store.js';
import * as vaultRepoModule from '../vault-repo.js';
import type { CredentialSetStoreHost, CredentialSetVaultPolicy, CredentialSetWriteDeps } from '../index.js';

/**
 * @file EXTRACT-S8 C1 move pins for `@jini-ai/integrations/credentialed-http/sets`: the declared
 * public entry, a second host (its own owner, categories and messages) wired only through the
 * entry, one canonical error class per kind, the emitted declaration closure (core + same
 * directory only) and the @agent-notes a second host must read surviving into `.d.ts`.
 */

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

it('declares ./credentialed-http/sets like the other node entries, with a source entry and legacy types', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'));
  expect(manifest.exports['./credentialed-http/sets']).toEqual({
    types: './dist/credentialed-http/sets/index.d.ts', import: './dist/credentialed-http/sets/index.js', default: './dist/credentialed-http/sets/index.js',
  });
  expect(manifest.typesVersions['*']['credentialed-http/sets']).toEqual(['./dist/credentialed-http/sets/index.d.ts']);
  expect(manifest.jini.entries['./credentialed-http/sets']).toBe('node');
  expect(manifest.exports['./credentialed-http'].import).toBe('./dist/credentialed-http/index.js');
  expect(manifest.dependencies).toEqual({ '@jini-ai/core': 'workspace:^' });
});

it('the entry re-exports the one canonical object per runtime export', () => {
  for (const [name, value] of Object.entries({ ...storeModule, ...vaultRepoModule })) expect(entry[name as keyof typeof entry], name).toBe(value);
});

it('a second host wires its own owner, categories and messages; metadata never decrypts, resolve opens one row', async () => {
  const s = makeHost();
  const made = await entry.createCredentialSet({ host: s.host, deps: s.deps, input });
  expect(made.category).toBe('red');
  const [row] = await s.inner.list({ workspaceId: WS, kind: 'vendor', ownerKey: OWNER, principalId: null });
  expect({ ownerKey: row!.ownerKey, kind: row!.kind, principalId: row!.principalId, binding: row!.binding }).toEqual({ ownerKey: OWNER, kind: 'vendor', principalId: null, binding: null });
  expect((await entry.listCredentialSets({ host: s.host, deps: s.deps, input: { workspaceId: WS } })).map(item => item.label)).toEqual(['Main']);
  expect(s.counts.open).toBe(0);
  const resolved = await entry.resolveCredentialSetByLabel({ host: s.host, deps: s.deps, input: { workspaceId: WS, label: 'Main' } });
  expect(resolved?.connection.token).toBe('tok-abcdefghijklmnop');
  expect(s.counts).toEqual({ open: 1, seal: 1 });
  expect(s.repo.vault).toBe(s.vault);
  await expect(entry.createCredentialSet({ host: s.host, deps: s.deps, input: { ...input, category: 'green' } })).rejects.toThrow('category must be one of: red, blue');
  await expect(entry.createCredentialSet({ host: s.host, deps: s.deps, input: { ...input, connection: { token: ' ' } } })).rejects.toThrow('second: token needed');
});

it('errors are the canonical classes; foreign-owner rows get the host canonical context error', async () => {
  const s = makeHost();
  await entry.createCredentialSet({ host: s.host, deps: s.deps, input });
  const duplicate = await entry.createCredentialSet({ host: s.host, deps: s.deps, input }).catch((error: unknown) => error);
  expect(duplicate).toBeInstanceOf(storeModule.CustomCredentialDuplicateLabelError);
  expect((duplicate as Error).message).toBe('second dup Main');
  const invalid = await entry.createCredentialSet({ host: s.host, deps: s.deps, input: { ...input, label: '' } }).catch((error: unknown) => error);
  expect(invalid).toBeInstanceOf(entry.CustomCredentialValidationError);
  const missing = await entry.updateCredentialSet({ host: s.host, deps: s.deps, input: { workspaceId: WS, id: 'nope' } }).catch((error: unknown) => error);
  expect((missing as Error).message).toBe('second missing nope');
  const [row] = await s.inner.list({ workspaceId: WS, kind: 'vendor', ownerKey: OWNER, principalId: null });
  const foreign = new entry.CredentialSetVaultRepo<Cat>({ vault: s.vault, policy: { ...s.policy, ownerKey: 'someone-else' } });
  const refused = await foreign.findById({ workspaceId: WS, id: row!.id }).catch((error: unknown) => error);
  expect(s.policy.vaultErrors.codeOf(refused)).toBe('context');
});

it('emitted declarations reference only @jini-ai/core subpaths and same-directory files, and keep the @agent-notes', () => {
  const dir = new URL('dist/credentialed-http/sets/', packageRoot);
  const files = readdirSync(dir).filter(name => name.endsWith('.d.ts')).sort();
  expect(files).toEqual(['host.d.ts', 'index.d.ts', 'store.d.ts', 'vault-repo.d.ts']);
  for (const name of files) {
    const text = readFileSync(new URL(name, dir), 'utf8');
    const specifiers = [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(match => match[1]!);
    for (const specifier of specifiers) expect(/^@jini-ai\/core\/[a-z/-]+$/.test(specifier) || /^\.\/[a-z-]+\.js$/.test(specifier), `${name}: ${specifier}`).toBe(true);
    expect(text, name).toContain('@agent-note');
  }
  const index = readFileSync(new URL('index.d.ts', dir), 'utf8');
  for (const obligation of ['canonical vault', 'never decrypt', 'compare-and-swap', 'allowSharedKeyReplacement', 'same objects']) expect(index).toContain(obligation);
});
