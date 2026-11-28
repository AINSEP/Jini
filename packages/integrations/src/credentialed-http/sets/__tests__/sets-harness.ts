import type { CredentialSetProjectScope } from '@jini-ai/core/contracts/credentials';
import { VaultError, type VaultMeta, type VaultPutRecord } from '@jini-ai/core/contracts/vault';
import { AesGcmSecretSealer } from '@jini-ai/platform/secrets';
import { buildVaultAad, createVaultMetaParsers, InMemoryVaultRepo, SecretsVaultService } from '@jini-ai/platform/secrets/credential-sets';
import { InMemoryKeyring } from '@jini-ai/platform/secrets/testing';
import type { CredentialSetRowByLabel, CredentialSetStoreHost, CredentialSetVaultPolicy } from '../host.js';
import type { CredentialSetWriteDeps } from '../store.js';
import { CredentialSetVaultRepo } from '../vault-repo.js';

/**
 * @file Real in-memory vault + real sealer harness for the credential-set store and repo. The site
 * and an optional project store share one vault and differ only by workspace id, exactly like two
 * workspaces of one host. Host policy values are this second host's own (owner, categories, wording).
 */

export type Cat = 'red' | 'blue';
export const OWNER = 'second-host';
export const WS = 'ws-1';
export const PROJECT_WS = 'proj-1';
const NOW = '2026-11-09T00:00:00.000Z';

export const policy: CredentialSetVaultPolicy = {
  ownerKey: OWNER,
  parseMeta: ({ kind, meta, provider }) => createVaultMetaParsers({})[kind]({ meta, provider }),
  compareLabels: (a, b) => a.label.localeCompare(b.label),
  vaultErrors: { create: ({ code }) => new VaultError({ code }), codeOf: error => (error instanceof VaultError ? error.code : undefined) },
  labelConflict: () => new Error('SECOND-UNIQUE label'),
};

/** Free-text fields refuse a pasted secret; worksFor must be an array of string ids. */
export const host: CredentialSetStoreHost<Cat> = {
  vault: policy,
  openVault: ({ deps, kind }) => new SecretsVaultService({
    repo: deps.repo.vault!, keyring: deps.keyring!, sealer: deps.sealer, metaParsers: createVaultMetaParsers({}),
    authorize: async ({ context }) => { if (context.ownerKey !== OWNER || context.kind !== kind) throw new VaultError({ code: 'context' }); },
    now: () => NOW, newId: () => { throw new Error('ids come from the store'); },
  }),
  scopes: (deps, workspaceId) => [{ deps, workspaceId, scope: 'site' as const },
    ...(deps.repo.project ? [{ deps, workspaceId: deps.repo.project.workspaceId, scope: 'project' as const }] : [])],
  createTarget: (deps, input, invalid) => {
    if (input.scope !== undefined && input.scope !== 'site' && input.scope !== 'project') throw invalid('scope must be site or project');
    const project = deps.repo.project;
    return input.scope !== 'site' && project ? { deps, workspaceId: project.workspaceId, scope: 'project' } : { deps, workspaceId: input.workspaceId, scope: 'site' };
  },
  isUniqueViolation: error => error instanceof Error && error.message.startsWith('SECOND-UNIQUE'),
  isCreateConflict: (error): error is Error => error instanceof TypeError && error.message === 'second create conflict',
  token: {
    normalize: ({ value }) => { if (typeof value !== 'string' || !value.trim()) throw new RangeError('second: token needed'); return value.trim(); },
    assertFreeField: ({ value, field }) => { if (value.includes('PASTED-SECRET')) throw new RangeError(`second: ${field} looks like a secret`); },
    isInputError: (error): error is Error => error instanceof RangeError,
  },
  normalizeWorksFor: ({ value }) => {
    if (!Array.isArray(value)) throw new VaultError({ code: 'invalid-meta' });
    return value.map(item => { if (typeof item !== 'string') throw new TypeError('second: worksFor ids are strings'); return item; });
  },
  categories: ['red', 'blue'],
  messages: {
    storage: 'second storage', worksForInvalid: 'second worksFor', sharedReplacementReadOnly: 'second replace read-only',
    sharedDeleteReadOnly: 'second delete read-only', duplicateLabel: ({ label }) => `second dup ${label}`,
    projectDuplicateLabel: ({ label }) => `second project dup ${label}`, notFound: ({ id }) => `second missing ${id}`,
  },
};

type ProjectExtras = Partial<Pick<CredentialSetProjectScope<Cat>, 'replaceRepo' | 'inventoryRepo' | 'createRepo'>>;

/** Build deps over one shared in-memory vault. `project` attaches a project store (with optional extras). */
export function makeSets(optional: { project?: ProjectExtras | true; findRowByLabel?: CredentialSetRowByLabel; allowSharedKeyReplacement?: boolean } = {}) {
  const inner = new InMemoryVaultRepo({});
  const platformKeyring = new InMemoryKeyring({ hkdfSalt: 'second-host' }, { keyId: 'k1' });
  const sealer = new AesGcmSecretSealer({ keyring: platformKeyring });
  const keyring = { activeKey: () => platformKeyring.activeKey({}), derive: platformKeyring.derive.bind(platformKeyring),
    deriveSigningSecret: platformKeyring.deriveSigningSecret.bind(platformKeyring) };
  const base = new CredentialSetVaultRepo<Cat>({ vault: inner, policy });
  const extras = optional.project === true ? {} : optional.project;
  const project = extras ? { workspaceId: PROJECT_WS, repo: base, sealer, keyring, ...extras } : undefined;
  const repo = new CredentialSetVaultRepo<Cat>({ vault: inner, policy }, {
    ...(project ? { project } : {}), ...(optional.findRowByLabel ? { findRowByLabel: optional.findRowByLabel } : {}) });
  let n = 0;
  const deps: CredentialSetWriteDeps<Cat> = { repo, sealer, keyring, clock: { nowMs: () => 0 }, idGen: { newId: () => `id-${++n}` },
    ...(optional.allowSharedKeyReplacement === undefined ? {} : { allowSharedKeyReplacement: optional.allowSharedKeyReplacement }) };
  return { inner, sealer, keyring, platformKeyring, base, repo, deps };
}

export const input = { workspaceId: WS, label: 'Main', category: 'red', baseUrl: 'https://api.second.test', connection: { token: 'tok-abcdefghijklmnop' } };

/** A pre-unification `custom`-kind row, sealed under its own kind's AAD (what an old host wrote). */
export async function seedLegacyCustomRow(sets: ReturnType<typeof makeSets>, row: { id: string; label: string; token: string; meta?: VaultMeta; payload?: VaultMeta; last4?: string; tokenLength?: number }): Promise<VaultPutRecord> {
  const identity = { workspaceId: WS, kind: 'custom' as const, ownerKey: OWNER, principalId: null, binding: null, id: row.id };
  const sealed = await sets.sealer.seal({ plaintext: JSON.stringify(row.payload ?? { token: row.token }), key: await sets.platformKeyring.activeKey({}), aad: buildVaultAad(identity) });
  const record: VaultPutRecord = { ...identity, provider: null, label: row.label, sealed, revision: 1, last4: row.last4 ?? null, tokenLength: row.tokenLength ?? null, createdAt: NOW, updatedAt: NOW,
    meta: row.meta ?? { credentialType: 'custom', category: 'blue', baseUrl: 'https://legacy.second.test', additionalHosts: [], worksFor: [], username: null } };
  await sets.inner.put({ record, expectedRevision: null });
  return record;
}
