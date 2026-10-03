import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildSourceControlProvider, buildSourceControlProviders, buildSourceControlProviderForApi, findReservedPath, isUnderWorkflowPath, loadSourceControlProviderRegistry, parseSourceControlProvidersFile, pickSourceControlProviderForApi } from '../registry.js';
import { createSourceControlProviderKit } from '../kit.js';
import type { CatalogPackage, DescriptorExtensionReader, SourceControlProviderOperations } from '../contracts.js';

const readExtensions: DescriptorExtensionReader = ({ entry }) => ({ ok: true, extensions: { ...(entry.credential !== undefined ? { credential: entry.credential } : {}), ...(entry.i18n !== undefined ? { i18n: entry.i18n } : {}) } });
const descriptor = { id: 'example', label: 'Example', apiOrigin: 'https://example.test', module: 'source/provider.mjs', reservedPaths: ['.ci'], workflowPaths: ['.ci/jobs'] };
const text = (providers: unknown[] = [descriptor]) => JSON.stringify({ schemaVersion: 1, providers });
const operations: SourceControlProviderOperations = {
  commitSite: async () => ({ ok: false, code: 'no-changes', message: 'unchanged' }), readAccountLabel: async () => 'account',
  planFileWrite: async () => ({ ok: false, code: 'branch-not-found', message: 'missing' }), commitFiles: async () => ({ ok: false, code: 'diverged', message: 'moved' }),
  inspectBackupRepository: async () => ({ ok: false, code: 'repo-not-found', message: 'missing' }), uploadBackupBlob: async () => ({ ok: false, code: 'provider-error', message: 'refused' }),
  commitBackupTree: async () => ({ ok: false, code: 'diverged', message: 'moved' }),
};

// Generalized from provider-registry.unit.test.ts; trust/digest policy lives in the catalog adapter.
test('descriptor parsing preserves metadata and refuses malformed files, duplicates and module escapes', () => {
  assert.deepEqual(parseSourceControlProvidersFile({ raw: text(), readExtensions }), { ok: true, descriptors: [descriptor] });
  for (const raw of ['not JSON', '{}', JSON.stringify({ schemaVersion: 1 }), text([descriptor, descriptor]), ...[
    { label: '' }, { id: 'Upper' }, { id: 'example\n' }, { apiOrigin: 'http://example.test' }, { apiOrigin: 'https://example.test/path' }, { maxFileBytes: 0 },
    { module: '../evil.mjs' }, { module: '/evil.mjs' }, { module: 'bad\\evil.mjs' }, { module: 'p.js' }, { reservedPaths: ['../evil'] }, { workflowPaths: Array(21).fill('ci') },
  ].map(change => text([{ ...descriptor, ...change }]))]) assert.equal(parseSourceControlProvidersFile({ raw, readExtensions }).ok, false, raw);
});

test('catalog is loaded fresh, inactive modules never import and each provider fault is isolated', async () => {
  const imports: string[] = [];
  const packages: CatalogPackage[] = [
    { pluginId: 'z', state: 'trusted', descriptorText: text(), importModule: async () => { imports.push('z'); return { create: () => operations }; } },
    { pluginId: 'off', state: 'inactive', descriptorText: text([{ ...descriptor, id: 'disabled' }]) },
    { pluginId: 'untrusted', state: 'refused', reason: 'digest mismatch' },
    { pluginId: 'a', state: 'trusted', descriptorText: text([{ ...descriptor, id: 'broken' }, { ...descriptor, id: 'other' }]), importModule: async ({ relativePath }) => { imports.push('a:' + relativePath); return { create: 1 }; } },
  ];
  let reads = 0;
  const registry = await loadSourceControlProviderRegistry({ workspaceId: 'workspace', descriptorFileName: 'source-providers.json', readExtensions, catalog: { list: async input => { reads++; assert.deepEqual(input, { workspaceId: 'workspace', descriptorFileName: 'source-providers.json' }); return packages; } }, describeError: () => 'safe module failure' });
  assert.equal(reads, 1);
  assert.deepEqual(registry.list({}).map(p => p.pluginId), ['z']);
  assert.equal(registry.get({ providerId: 'disabled' }), undefined);
  assert.equal(registry.switchedOff.get('disabled'), 'off');
  assert.deepEqual(imports, ['a:source/provider.mjs', 'a:source/provider.mjs', 'z']);
  assert.equal(registry.refusals.length, 3);
  assert.match(registry.refusals.join(' '), /digest mismatch/);
  const kit = createSourceControlProviderKit({ httpClient: { send: async () => { throw new Error('unused'); } }, fetch: async () => { throw new Error('unused'); }, describeTransportError: () => ({ refusal: undefined, logDetail: 'safe' }) });
  const built = await buildSourceControlProvider({ workspaceId: 'workspace', providerId: 'example', load: async () => registry, kit, noProviderMessage: () => 'no enabled provider' });
  if (!built.ok) assert.fail(built.message);
  assert.equal(built.provider.id, 'example');
  assert.deepEqual(built.provider.workflowPaths, ['.ci/jobs']);
});

test('reserved paths ignore case; workflow paths match exact case from the repository root', () => {
  assert.equal(findReservedPath({ folder: '.CI/jobs' }, { reservedPaths: ['.ci'] }), '.ci');
  assert.equal(findReservedPath({ folder: '.ci-other' }, { reservedPaths: ['.ci'] }), undefined);
  assert.equal(isUnderWorkflowPath({ filePath: '.ci/jobs/check.yml' }, { workflowPaths: ['.ci/jobs'] }), true);
  for (const filePath of ['.CI/jobs/check.yml', 'dir/.ci/jobs/check.yml', '.ci/jobs-other/check.yml', '.ci/jobs']) assert.equal(isUnderWorkflowPath({ filePath }, { workflowPaths: ['.ci/jobs'] }), false);
});

test('API selection prefers exact origin, permits a sole self-hosted provider and rejects ambiguous origins', async () => {
  const kit = createSourceControlProviderKit({ httpClient: { send: async () => { throw new Error('unused'); } }, fetch: async () => { throw new Error('unused'); }, describeTransportError: () => ({ refusal: undefined, logDetail: 'safe' }) });
  const registry = await loadSourceControlProviderRegistry({ workspaceId: 'w', descriptorFileName: 'providers.json', readExtensions, describeError: () => 'safe', catalog: { list: async () => [{ pluginId: 'p', state: 'trusted', descriptorText: text(), importModule: async () => ({ create: () => operations }) }] } });
  const built = await buildSourceControlProvider({ workspaceId: 'w', providerId: 'example', kit, load: async () => registry, noProviderMessage: () => 'none' });
  if (!built.ok) assert.fail(built.message);
  const p = built.provider;
  assert.deepEqual(pickSourceControlProviderForApi({ providers: [p], baseUrl: 'https://self-hosted.test/api', noProviderMessage: 'none' }), { ok: true, provider: p });
  assert.deepEqual(pickSourceControlProviderForApi({ providers: [], baseUrl: 'https://unknown.test', noProviderMessage: 'none' }), { ok: false, message: 'none' });
  const second = { ...p, id: 'second', apiOrigin: 'https://second.test' };
  assert.deepEqual(pickSourceControlProviderForApi({ providers: [p, second], baseUrl: 'https://second.test/api', noProviderMessage: 'none' }), { ok: true, provider: second });
  assert.equal(pickSourceControlProviderForApi({ providers: [p, second], baseUrl: 'https://unknown.test', noProviderMessage: 'none' }).ok, false);
  const all = await buildSourceControlProviders({ workspaceId: 'w', kit, load: async () => registry, noProviderMessage: () => 'none' });
  assert.deepEqual(all.providers.map(provider => provider.id), ['example']);
  const forApi = await buildSourceControlProviderForApi({ workspaceId: 'w', kit, load: async () => registry, noProviderMessage: () => 'none', baseUrl: 'https://self-hosted.test/api' });
  if (!forApi.ok) assert.fail(forApi.message);
  assert.equal(forApi.provider.id, 'example');
});

test('kit injects transport/error policy and never follows fetch redirects', async () => {
  let seen: RequestInit | undefined;
  const kit = createSourceControlProviderKit({ httpClient: { send: async () => ({ status: 200, headers: {}, bodyText: 'ok' }) }, fetch: async (_required, optional) => { seen = optional?.init; return new Response('ok'); }, describeTransportError: ({ error }) => ({ refusal: 'policy refused', logDetail: String(error) }) });
  await kit.fetch({ url: 'https://example.test', init: { redirect: 'follow' } });
  assert.equal(seen?.redirect, 'manual');
  assert.deepEqual(kit.describeTransportError({ error: 'test' }), { refusal: 'policy refused', logDetail: 'test' });
});
