import { expect, test } from 'vitest';
import { contributeProviders, createPluginContributionLoader, defineProviderContribution, type PluginContributionPorts } from '@jini-ai/agent-plugins/lifecycle';
import { BUILTIN_SEARCH_PROVIDER_ID, SEARCH_CONTRACT, type SearchProvider } from '../contract.js';
import {
  defineSearchProviderContribution, parseSearchProviderManifest, validateContributedSearchProvider,
  type SearchContributionSpec,
} from '../contribution.js';
import { createSearchProviderRegistry } from '../registry.js';
import { createInMemorySearchProvider } from '../testkit/memory-provider.js';

const plugin = { pluginId: 'acme_search', packageRoot: '/plugins/acme_search' };
const vendor = (id: string) => createInMemorySearchProvider({}, { id, acceptsRestricted: false });
/** The host's side of the seam: agent-plugins' loader, with the host's recovery policy bound inside `define`. */
const define = (filename: string, recovery: Parameters<typeof defineProviderContribution>[1] = {}) =>
  defineSearchProviderContribution({ filename, define: spec => defineProviderContribution(spec, recovery) });
const manifest = (providers: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 1, providers, ...extra });

function loaderFor(raw: string, modules: Record<string, unknown>, overrides: Partial<PluginContributionPorts> = {}) {
  const imports: string[] = [];
  const loader = createPluginContributionLoader({
    findPackages: async () => [{ trusted: plugin }],
    readFile: async () => raw,
    importModule: async ({ modulePath }) => { imports.push(modulePath); return { exported: modules[modulePath] }; },
    ...overrides,
  });
  return { loader, imports };
}

test('the definition is executable, named for the search contract, with the host filename', () => {
  const definition = define('host-search-providers.json');
  expect([definition.kind, definition.contribution, definition.filename]).toEqual(['executable', 'search providers', 'host-search-providers.json']);
});

test('a valid vendor loads, keeps its manifest label, ignores unknown keys, and registers', async () => {
  const raw = manifest([{ id: 'acme', label: 'Acme Search', module: 'dist/acme.mjs', extra: true }], { comment: 'ignored' });
  const provider = vendor('acme');
  const { loader, imports } = loaderFor(raw, { 'dist/acme.mjs': provider });
  const definition = define('host-search-providers.json');
  const loaded = await loader.loadPluginContributions({ workspaceId: 'w1', definition });
  expect(imports).toEqual(['dist/acme.mjs']);
  expect(loaded).toEqual({ items: [{ contract: SEARCH_CONTRACT, pluginId: 'acme_search', definition: { id: 'acme', provider, label: 'Acme Search' } }], refusals: [] });
  const registry = createSearchProviderRegistry();
  expect(contributeProviders({ registry, loaded })).toEqual({ accepted: ['acme'], refusals: [] });
  expect(registry.get({ id: 'acme' })).toMatchObject({ origin: 'plugin', pluginId: 'acme_search', label: 'Acme Search' });
});

test('every faulty provider is a refusal line, never a throw', async () => {
  const restricted = createInMemorySearchProvider({}, { id: 'members' });
  const raw = manifest([
    { id: 'Bad-Id', label: 'Bad', module: 'bad.mjs' },
    { id: 'shapeless', label: 'Shapeless', module: 'shapeless.mjs' },
    { id: 'members', label: 'Members', module: 'members.mjs' },
    { id: 'renamed', label: 'Renamed', module: 'renamed.mjs' },
    { id: 'good', label: 'Good', module: 'good.mjs' },
  ]);
  const { loader, imports } = loaderFor(raw, { 'shapeless.mjs': { id: 'shapeless' }, 'members.mjs': restricted, 'renamed.mjs': vendor('other'), 'good.mjs': vendor('good') });
  const loaded = await loader.loadPluginContributionsFromSource({ plugin, definition: define('f.json') });
  expect(imports).toEqual(['shapeless.mjs', 'members.mjs', 'renamed.mjs', 'good.mjs']);
  expect(loaded.items.map(item => item.definition.id)).toEqual(['good']);
  expect(loaded.refusals).toEqual([
    "search provider 'Bad-Id' from 'acme_search' was not loaded: its id must match ^[a-z][a-z0-9_]{0,63}$",
    "search provider 'shapeless' from 'acme_search' was not loaded: its module's default export is not a search provider: label must be a non-empty string",
    "search provider 'members' from 'acme_search' was not loaded: a plugin provider must not accept restricted content (only the built-in provider may)",
    "search provider 'renamed' from 'acme_search' was not loaded: its module's provider id 'other' differs from the manifest id",
  ]);
});

test('a plugin cannot displace the built-in provider', async () => {
  const builtin = createInMemorySearchProvider({}, { id: BUILTIN_SEARCH_PROVIDER_ID });
  const registry = createSearchProviderRegistry({}, { seed: [{ id: BUILTIN_SEARCH_PROVIDER_ID, provider: builtin }] });
  const { loader } = loaderFor(manifest([{ id: 'builtin', label: 'Fake built-in', module: 'b.mjs' }]), { 'b.mjs': vendor('builtin') });
  const loaded = await loader.loadPluginContributionsFromSource({ plugin, definition: define('f.json') });
  expect(contributeProviders({ registry, loaded }).refusals).toEqual([
    "search provider 'builtin' from plugin 'acme_search' was not loaded: already registered by the built-in provider",
  ]);
  expect(registry.getDefault()?.provider).toBe(builtin);
});

test('a malformed manifest refuses the whole plugin with the reason', async () => {
  const { loader } = loaderFor('{nope', {});
  const loaded = await loader.loadPluginContributionsFromSource({ plugin, definition: define('f.json') });
  expect(loaded).toEqual({ items: [], refusals: ["search providers from 'acme_search' were not loaded: f.json is invalid: it must be a JSON object"] });
});

test('loader recovery policies pass through', async () => {
  const onReadError = () => ['no search manifest'];
  const definition = define('f.json', { onReadError, importErrorReason: 'its module failed to load' });
  expect(definition.onReadError).toBe(onReadError);
  const missing = loaderFor('', {}, { readFile: async () => { throw new Error('ENOENT'); } });
  expect((await missing.loader.loadPluginContributionsFromSource({ plugin, definition })).refusals).toEqual(['no search manifest']);
  const crashing = loaderFor(manifest([{ id: 'acme', label: 'Acme', module: 'a.mjs' }]), {}, { importModule: async () => { throw new Error('boom'); } });
  expect((await crashing.loader.loadPluginContributionsFromSource({ plugin, definition })).refusals).toEqual(["search provider 'acme' from 'acme_search' was not loaded: its module failed to load"]);
});

test.each([
  ['[]', 'it must be a JSON object'],
  ['null', 'it must be a JSON object'],
  ['"text"', 'it must be a JSON object'],
  [JSON.stringify({ providers: [] }), 'schemaVersion must be 1'],
  [JSON.stringify({ schemaVersion: 2, providers: [] }), 'schemaVersion must be 1'],
  [JSON.stringify({ schemaVersion: 1 }), 'providers must be an array'],
  [manifest(['acme']), 'providers[0] must be an object'],
  [manifest([[]]), 'providers[0] must be an object'],
  [manifest([{ label: 'A', module: 'a.mjs' }]), 'providers[0].id must be a string'],
  [manifest([{ id: 'a', module: 'a.mjs' }]), 'providers[0].label must be a non-empty string'],
  [manifest([{ id: 'a', label: ' ', module: 'a.mjs' }]), 'providers[0].label must be a non-empty string'],
  [manifest([{ id: 'a', label: 'A' }]), 'providers[0].module must be a relative .mjs path'],
  [manifest([{ id: 'a', label: 'A', module: 'a.js' }]), 'providers[0].module must be a relative .mjs path'],
  [manifest([{ id: 'a', label: 'A', module: '/abs/a.mjs' }]), 'providers[0].module must be a relative .mjs path'],
  [manifest([{ id: 'a', label: 'A', module: '\\\\server\\a.mjs' }]), 'providers[0].module must be a relative .mjs path'],
  [manifest([{ id: 'a', label: 'A', module: 'C:/a.mjs' }]), 'providers[0].module must be a relative .mjs path'],
  [manifest([{ id: 'a', label: 'A', module: 'a.mjs' }, { id: 'a', label: 'B', module: 'b.mjs' }]), "provider id 'a' is declared twice"],
])('manifest fault %#', (raw, reason) => {
  expect(parseSearchProviderManifest({ raw })).toEqual({ ok: false, reason });
});

test('an empty provider list is a valid manifest', () => {
  expect(parseSearchProviderManifest({ raw: manifest([]) })).toEqual({ ok: true, descriptors: [] });
});

test('validateContributedSearchProvider returns the provider itself', () => {
  const provider: SearchProvider = vendor('acme');
  expect(validateContributedSearchProvider({ exported: provider })).toBe(provider);
  expect(validateContributedSearchProvider({ exported: undefined })).toBe("its module's default export is not a search provider: a search provider must be an object");
});

/** A fake of what the host's `define` builds: a base whose `load` answers with a fixed provider id or refusal. */
function fakeBase(answer: { definition: { provider: { id: string } } } | string) {
  const loads: unknown[] = [];
  return { loads, base: { kind: 'fake-base' as const, load: async (input: unknown) => { loads.push(input); return answer; } } };
}
const loadInput = { descriptor: { id: 'acme' }, plugin: { pluginId: 'acme_search' } };

test('define receives the search contract, the filename and the parser and validator by identity', () => {
  const received: SearchContributionSpec[] = [];
  const { base } = fakeBase('unused');
  const definition = defineSearchProviderContribution({ filename: 'host.json', define: spec => { received.push(spec); return base; } });
  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({ contract: SEARCH_CONTRACT, filename: 'host.json', parse: parseSearchProviderManifest, validate: validateContributedSearchProvider });
  expect(received[0]?.parse).toBe(parseSearchProviderManifest);
  expect(received[0]?.validate).toBe(validateContributedSearchProvider);
  expect(definition.kind).toBe('fake-base');
});

test('a loaded provider whose id differs from the manifest id is refused with the mismatch message', async () => {
  const { base, loads } = fakeBase({ definition: { provider: { id: 'other' } } });
  const definition = defineSearchProviderContribution({ filename: 'f.json', define: () => base });
  await expect(definition.load(loadInput)).resolves
    .toBe(`${SEARCH_CONTRACT} provider 'acme' from 'acme_search' was not loaded: its module's provider id 'other' differs from the manifest id`);
  expect(loads).toEqual([loadInput]);
});

test('a matching id returns the loaded result itself; the host loader\'s own refusal passes through', async () => {
  const loaded = { definition: { provider: { id: 'acme' } } };
  const matching = defineSearchProviderContribution({ filename: 'f.json', define: () => fakeBase(loaded).base });
  expect(await matching.load(loadInput)).toBe(loaded);
  const refusing = defineSearchProviderContribution({ filename: 'f.json', define: () => fakeBase('the host loader said no').base });
  expect(await refusing.load(loadInput)).toBe('the host loader said no');
});
