import assert from 'node:assert/strict';
import { expect, test } from 'vitest';
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

// --- Characterization pins (written on the pre-refactor code) ---

const reasonFor = (change: Record<string, unknown>, policy = {}) => {
  const parsed = parseSourceControlProvidersFile({ raw: text([{ ...descriptor, ...change }]), readExtensions }, policy);
  return parsed.ok ? 'ok' : parsed.reason;
};

test.each<[string, Record<string, unknown>, string]>([
  ['non-string id', { id: 7 }, 'providers[0].id must be a lowercase hyphenated id'],
  ['id over 64 characters', { id: 'a'.repeat(65) }, 'providers[0].id must be a lowercase hyphenated id'],
  ['id with inner whitespace', { id: 'a b' }, 'providers[0].id must be a lowercase hyphenated id'],
  ['id with a double hyphen', { id: 'a--b' }, 'providers[0].id must be a lowercase hyphenated id'],
  ['id with a trailing newline', { id: 'example\n' }, 'providers[0].id must be a lowercase hyphenated id'],
  ['non-string label', { label: 3 }, 'providers[0].label must be a non-empty string'],
  ['blank label', { label: '   ' }, 'providers[0].label must be a non-empty string'],
  ['label over 100 characters', { label: 'x'.repeat(101) }, 'providers[0].label must be a non-empty string'],
  ['non-string apiOrigin', { apiOrigin: 1 }, 'providers[0].apiOrigin must be an https origin with no path'],
  ['unparseable apiOrigin', { apiOrigin: 'not a url' }, 'providers[0].apiOrigin must be an https origin with no path'],
  ['apiOrigin with trailing slash', { apiOrigin: 'https://example.test/' }, 'providers[0].apiOrigin must be an https origin with no path'],
  ['string maxFileBytes', { maxFileBytes: '5' }, 'providers[0].maxFileBytes must be a positive integer'],
  ['fractional maxFileBytes', { maxFileBytes: 1.5 }, 'providers[0].maxFileBytes must be a positive integer'],
  ['negative maxFileBytes', { maxFileBytes: -1 }, 'providers[0].maxFileBytes must be a positive integer'],
  ['non-array reservedPaths', { reservedPaths: 'ci' }, 'providers[0].reservedPaths must be a list of at most 20 relative folder paths'],
  ['non-string reservedPaths entry', { reservedPaths: [1] }, 'providers[0].reservedPaths must be a list of at most 20 relative folder paths'],
  ['over-long reservedPaths entry', { reservedPaths: ['a'.repeat(201)] }, 'providers[0].reservedPaths must be a list of at most 20 relative folder paths'],
  ['reservedPaths entry with a colon', { reservedPaths: ['c:ci'] }, 'providers[0].reservedPaths must be a list of at most 20 relative folder paths'],
  ['reservedPaths entry with an empty segment', { reservedPaths: ['a//b'] }, 'providers[0].reservedPaths must be a list of at most 20 relative folder paths'],
  ['reservedPaths entry with a dot segment', { reservedPaths: ['a/./b'] }, 'providers[0].reservedPaths must be a list of at most 20 relative folder paths'],
  ['workflowPaths entry with a backslash', { workflowPaths: ['a\\b'] }, 'providers[0].workflowPaths must be a list of at most 20 relative folder paths'],
  ['non-string module', { module: 5 }, 'providers[0].module must be a relative path ending in .mjs'],
  ['module with a control character', { module: 'a\u0001.mjs' }, 'providers[0].module must be a relative path ending in .mjs'],
  ['module with a dot segment', { module: './a.mjs' }, 'providers[0].module must be a relative path ending in .mjs'],
  ['module with a colon', { module: 'c:a.mjs' }, 'providers[0].module must be a relative path ending in .mjs'],
])('descriptor refuses %s with its field named', (_name, change, reason) => {
  expect(reasonFor(change)).toBe(reason);
});

test('descriptor boundaries are accepted: 64-char id, 100-char label, port origin, 20 paths of 200 chars', () => {
  expect(reasonFor({ id: 'a'.repeat(64), label: 'x'.repeat(100), apiOrigin: 'https://example.test:8443', maxFileBytes: 1, reservedPaths: Array(20).fill('b'.repeat(200)), workflowPaths: [] })).toBe('ok');
});

test('fields are checked in declaration order and the first failure wins', () => {
  expect(reasonFor({ id: 'BAD', label: '', module: '../x.mjs' })).toBe('providers[0].id must be a lowercase hyphenated id');
  expect(reasonFor({ label: '', module: '../x.mjs' })).toBe('providers[0].label must be a non-empty string');
  expect(reasonFor({ reservedPaths: ['..'], workflowPaths: ['..'] })).toBe('providers[0].reservedPaths must be a list of at most 20 relative folder paths');
});

test('a non-object provider entry is refused with its index', () => {
  const parsed = parseSourceControlProvidersFile({ raw: JSON.stringify({ schemaVersion: 1, providers: [descriptor, ['x']] }), readExtensions });
  expect(parsed).toEqual({ ok: false, reason: 'providers[1] must be an object' });
});

test('file-level refusals name the reason exactly', () => {
  expect(parseSourceControlProvidersFile({ raw: '{', readExtensions })).toEqual({ ok: false, reason: 'not valid JSON' });
  expect(parseSourceControlProvidersFile({ raw: 'null', readExtensions })).toEqual({ ok: false, reason: 'schemaVersion must be 1' });
  expect(parseSourceControlProvidersFile({ raw: JSON.stringify({ schemaVersion: 2, providers: [] }), readExtensions })).toEqual({ ok: false, reason: 'schemaVersion must be 1' });
  expect(parseSourceControlProvidersFile({ raw: JSON.stringify({ schemaVersion: 1, providers: {} }), readExtensions })).toEqual({ ok: false, reason: 'providers must be an array' });
  expect(parseSourceControlProvidersFile({ raw: text([descriptor, descriptor]), readExtensions })).toEqual({ ok: false, reason: "providers[1].id 'example' is declared twice" });
});

test('extension reader refusals are returned verbatim and only run after the generic fields pass', () => {
  const calls: string[] = [];
  const refusing: DescriptorExtensionReader = ({ at }) => { calls.push(at); return { ok: false, reason: `${at}.credential is wrong` }; };
  expect(parseSourceControlProvidersFile({ raw: text([{ ...descriptor, id: 'BAD' }]), readExtensions: refusing })).toEqual({ ok: false, reason: 'providers[0].id must be a lowercase hyphenated id' });
  expect(calls).toEqual([]);
  expect(parseSourceControlProvidersFile({ raw: text(), readExtensions: refusing })).toEqual({ ok: false, reason: 'providers[0].credential is wrong' });
  expect(calls).toEqual(['providers[0]']);
});

test('extensions are merged but cannot overwrite the generic facts; unknown keys and absent optionals are dropped', () => {
  const overriding: DescriptorExtensionReader = () => ({ ok: true, extensions: { credential: 'c', id: 'hijack', module: 'x.mjs' } as never });
  const parsed = parseSourceControlProvidersFile({ raw: text([{ id: 'p', label: 'P', apiOrigin: 'https://p.test', module: 'p.mjs', extra: 1 }]), readExtensions: overriding });
  expect(parsed).toEqual({ ok: true, descriptors: [{ credential: 'c', id: 'p', label: 'P', apiOrigin: 'https://p.test', module: 'p.mjs' }] });
});

test('maxFileBytes is kept when valid', () => {
  const parsed = parseSourceControlProvidersFile({ raw: text([{ ...descriptor, maxFileBytes: 10 }]), readExtensions });
  expect(parsed.ok && parsed.descriptors[0]!.maxFileBytes).toBe(10);
});

test('a module policy replaces the relative-path rule but never the .mjs suffix rule', () => {
  const seen: string[] = [];
  const policy = { modulePath: ({ path }: { path: string }) => { seen.push(path); return path.startsWith('/trusted/'); } };
  expect(reasonFor({ module: '/trusted/p.mjs' }, policy)).toBe('ok');
  expect(reasonFor({ module: '/other/p.mjs' }, policy)).toBe('providers[0].module must be a relative path ending in .mjs');
  expect(reasonFor({ module: '/trusted/p.js' }, policy)).toBe('providers[0].module must be a relative path ending in .mjs');
  expect(seen).toEqual(['/trusted/p.mjs', '/other/p.mjs']);
});

test('a folder policy replaces the relative-path rule but not the count and length limits', () => {
  const policy = { folderPath: ({ path }: { path: string }) => path !== 'deny' };
  expect(reasonFor({ reservedPaths: ['../allowed'] }, policy)).toBe('ok');
  expect(reasonFor({ workflowPaths: ['deny'] }, policy)).toBe('providers[0].workflowPaths must be a list of at most 20 relative folder paths');
  expect(reasonFor({ reservedPaths: Array(21).fill('ok') }, policy)).toBe('providers[0].reservedPaths must be a list of at most 20 relative folder paths');
  expect(reasonFor({ reservedPaths: ['a'.repeat(201)] }, policy)).toBe('providers[0].reservedPaths must be a list of at most 20 relative folder paths');
});

test('a folder policy that answers differently on its second call drops the path list (reported, not fixed)', () => {
  let calls = 0;
  const flaky = { folderPath: () => ++calls === 1 };
  const parsed = parseSourceControlProvidersFile({ raw: text([{ ...descriptor, workflowPaths: undefined, reservedPaths: ['ci'] }]), readExtensions }, flaky);
  // The list is validated once, then re-validated to decide whether to copy it: a stateful
  // policy that refuses the second time silently removes the reserved-path protection.
  expect(parsed.ok && parsed.descriptors[0]!.reservedPaths).toBe(undefined);
  expect(calls).toBe(2);
});

const trusted = (pluginId: string, providers: unknown[], importModule: (r: { relativePath: string }) => Promise<unknown>): CatalogPackage => ({ pluginId, state: 'trusted', descriptorText: text(providers), importModule });
const load = (packages: CatalogPackage[], extensions: DescriptorExtensionReader = readExtensions) => loadSourceControlProviderRegistry({ workspaceId: 'w', descriptorFileName: 'p.json', readExtensions: extensions, describeError: ({ error }) => `described: ${(error as Error).message}`, catalog: { list: async () => packages } });

test('refusals carry the plugin id and, for module faults, the provider id', async () => {
  const registry = await load([
    { pluginId: 'r', state: 'refused', reason: 'digest mismatch' },
    { pluginId: 'bad-json', state: 'trusted', descriptorText: '{', importModule: async () => ({}) },
    trusted('throws', [{ ...descriptor, id: 'boom' }], async () => { throw new Error('import failed'); }),
    trusted('val', [{ ...descriptor, id: 'v' }], async () => ({ create: () => operations, validateTarget: 'no' })),
    trusted('nocreate', [{ ...descriptor, id: 'n' }], async () => null),
  ]);
  expect(registry.refusals).toEqual([
    'bad-json: not valid JSON',
    'nocreate/n: its module has no create() function',
    'r: digest mismatch',
    'throws/boom: described: import failed',
    "val/v: its module's validateTarget is not a function",
  ]);
  expect(registry.list({})).toEqual([]);
});

test('a throwing extension reader is refused for that plugin only', async () => {
  const throwing: DescriptorExtensionReader = ({ entry }) => { if (entry.id === 'x') throw new Error('reader crashed'); return { ok: true, extensions: {} }; };
  const registry = await load([trusted('a', [{ ...descriptor, id: 'x' }], async () => ({ create: () => operations })), trusted('b', [descriptor], async () => ({ create: () => operations }))], throwing);
  expect(registry.refusals).toEqual(['a: described: reader crashed']);
  expect(registry.list({}).map(p => p.descriptor.id)).toEqual(['example']);
});

test('an invalid inactive descriptor is refused rather than switched off', async () => {
  const registry = await load([{ pluginId: 'off', state: 'inactive', descriptorText: '[]' }]);
  expect(registry.refusals).toEqual(['off: schemaVersion must be 1']);
  expect(registry.switchedOff.size).toBe(0);
});

test('the first inactive plugin in id order owns a switched-off provider id', async () => {
  const registry = await load([
    { pluginId: 'z-off', state: 'inactive', descriptorText: text() },
    { pluginId: 'a-off', state: 'inactive', descriptorText: text() },
  ]);
  expect([...registry.switchedOff]).toEqual([['example', 'a-off']]);
});

test('plugins load in id order regardless of catalog order, and equal ids keep catalog order', async () => {
  const order: string[] = [];
  const make = (pluginId: string, id: string) => trusted(pluginId, [{ ...descriptor, id }], async () => { order.push(pluginId + ':' + id); return { create: () => operations }; });
  const registry = await load([make('b', 'b1'), make('a', 'a1'), make('b', 'b2')]);
  expect(order).toEqual(['a:a1', 'b:b1', 'b:b2']);
  expect(registry.get({ providerId: 'b2' })?.pluginId).toBe('b');
});

test('the same provider id from two trusted plugins is not refused; the first in id order wins get() (reported, not fixed)', async () => {
  const registry = await load([trusted('b', [descriptor], async () => ({ create: () => operations })), trusted('a', [descriptor], async () => ({ create: () => operations }))]);
  expect(registry.list({}).map(p => p.pluginId)).toEqual(['a', 'b']);
  expect(registry.get({ providerId: 'example' })?.pluginId).toBe('a');
  expect(registry.refusals).toEqual([]);
});

test('the provider list and refusals are frozen snapshots', async () => {
  const registry = await load([trusted('a', [descriptor], async () => ({ create: () => operations }))]);
  expect(Object.isFrozen(registry.list({}))).toBe(true);
  expect(Object.isFrozen(registry.refusals)).toBe(true);
  expect(registry.list({})[0]).toMatchObject({ pluginId: 'a', descriptor: { id: 'example' } });
});

test('a catalog item with an unknown state is imported like a trusted one (reported, not fixed)', async () => {
  const imported: string[] = [];
  // Malformed-input fixture: the catalog port's type only allows refused/inactive/trusted.
  const odd = { pluginId: 'odd', state: 'active', descriptorText: text(), importModule: async ({ relativePath }: { relativePath: string }) => { imported.push(relativePath); return { create: () => operations }; } } as unknown as CatalogPackage;
  const registry = await load([odd]);
  expect(imported).toEqual(['source/provider.mjs']);
  expect(registry.list({}).map(p => p.pluginId)).toEqual(['odd']);
});

const unusedKit = () => createSourceControlProviderKit({ httpClient: { send: async () => { throw new Error('unused'); } }, fetch: async () => { throw new Error('unused'); }, describeTransportError: () => ({ refusal: undefined, logDetail: 'safe' }) });

test('a built provider carries declared facts and the module validateTarget, and omits absent optionals', async () => {
  const validateTarget = () => 'nope';
  const registry = await load([
    trusted('a', [{ id: 'bare', label: 'Bare', apiOrigin: 'https://bare.test', module: 'b.mjs' }], async () => ({ create: () => ({ ...operations, id: 'hijack' }) })),
    trusted('b', [{ ...descriptor, maxFileBytes: 9 }], async () => ({ create: () => operations, validateTarget })),
  ]);
  const built = await buildSourceControlProviders({ workspaceId: 'w', kit: unusedKit(), load: async () => registry, noProviderMessage: () => 'none' });
  const [bare, full] = built.providers;
  expect(bare!.id).toBe('bare');
  expect('maxFileBytes' in bare! || 'reservedPaths' in bare! || 'workflowPaths' in bare! || 'validateTarget' in bare!).toBe(false);
  expect(full).toMatchObject({ id: 'example', maxFileBytes: 9, reservedPaths: ['.ci'], workflowPaths: ['.ci/jobs'] });
  expect(full!.validateTarget).toBe(validateTarget);
});

test('building a provider that is not loaded returns the host message and the registry refusals', async () => {
  const registry = await load([{ pluginId: 'r', state: 'refused', reason: 'digest mismatch' }]);
  const seen: unknown[] = [];
  const built = await buildSourceControlProvider({ workspaceId: 'w', providerId: 'missing', kit: unusedKit(), load: async () => registry, noProviderMessage: ({ providerId }) => { seen.push(providerId); return 'no provider ' + providerId; } });
  expect(built).toEqual({ ok: false, message: 'no provider missing', refusals: ['r: digest mismatch'] });
  expect(seen).toEqual(['missing']);
});

test('API selection failure carries the registry refusals', async () => {
  const registry = await load([{ pluginId: 'r', state: 'refused', reason: 'digest mismatch' }]);
  const built = await buildSourceControlProviderForApi({ workspaceId: 'w', kit: unusedKit(), load: async () => registry, noProviderMessage: () => 'none enabled', baseUrl: 'https://x.test' });
  expect(built).toEqual({ ok: false, message: 'none enabled', refusals: ['r: digest mismatch'] });
});

test('ambiguous API selection uses the default message, falling back to the raw URL when it is malformed', () => {
  const providers = [{ apiOrigin: 'https://a.test' }, { apiOrigin: 'https://b.test' }];
  expect(pickSourceControlProviderForApi({ providers, baseUrl: 'https://c.test/api', noProviderMessage: 'none' })).toEqual({ ok: false, message: 'No enabled provider supplies source control for https://c.test.' });
  expect(pickSourceControlProviderForApi({ providers, baseUrl: 'not a url', noProviderMessage: 'none' })).toEqual({ ok: false, message: 'No enabled provider supplies source control for not a url.' });
  expect(pickSourceControlProviderForApi({ providers, baseUrl: 'not a url', noProviderMessage: 'none' }, { missingProviderMessage: ({ origin, baseUrl }) => `custom ${String(origin)} ${baseUrl}` })).toEqual({ ok: false, message: 'custom undefined not a url' });
});

test('without declared paths nothing is reserved and nothing is a workflow', () => {
  expect(findReservedPath({ folder: '.ci' })).toBe(undefined);
  expect(isUnderWorkflowPath({ filePath: '.ci/jobs/a.yml' })).toBe(false);
});
