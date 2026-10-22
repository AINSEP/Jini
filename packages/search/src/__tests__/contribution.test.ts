import { expect, test } from 'vitest';
import { createPluginContributionLoader, type PluginContributionPorts } from '@jini-ai/agent-plugins/lifecycle';
import { BUILTIN_SEARCH_PROVIDER_ID, SEARCH_CONTRACT, type SearchProvider } from '../contract.js';
import {
  contributeProviders, defineSearchProviderContribution, parseSearchProviderManifest, validateContributedSearchProvider,
} from '../contribution.js';
import { createSearchProviderRegistry } from '../registry.js';
import { createInMemorySearchProvider } from '../testkit/memory-provider.js';

const plugin = { pluginId: 'acme_search', packageRoot: '/plugins/acme_search' };
const vendor = (id: string) => createInMemorySearchProvider({}, { id, acceptsRestricted: false });
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
  const definition = defineSearchProviderContribution({ filename: 'host-search-providers.json' });
  expect([definition.kind, definition.contribution, definition.filename]).toEqual(['executable', 'search providers', 'host-search-providers.json']);
});

test('a valid vendor loads, keeps its manifest label, ignores unknown keys, and registers', async () => {
  const raw = manifest([{ id: 'acme', label: 'Acme Search', module: 'dist/acme.mjs', extra: true }], { comment: 'ignored' });
  const provider = vendor('acme');
  const { loader, imports } = loaderFor(raw, { 'dist/acme.mjs': provider });
  const definition = defineSearchProviderContribution({ filename: 'host-search-providers.json' });
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
  const loaded = await loader.loadPluginContributionsFromSource({ plugin, definition: defineSearchProviderContribution({ filename: 'f.json' }) });
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
  const loaded = await loader.loadPluginContributionsFromSource({ plugin, definition: defineSearchProviderContribution({ filename: 'f.json' }) });
  expect(contributeProviders({ registry, loaded }).refusals).toEqual([
    "search provider 'builtin' from plugin 'acme_search' was not loaded: already registered by the built-in provider",
  ]);
  expect(registry.getDefault()?.provider).toBe(builtin);
});

test('a malformed manifest refuses the whole plugin with the reason', async () => {
  const { loader } = loaderFor('{nope', {});
  const loaded = await loader.loadPluginContributionsFromSource({ plugin, definition: defineSearchProviderContribution({ filename: 'f.json' }) });
  expect(loaded).toEqual({ items: [], refusals: ["search providers from 'acme_search' were not loaded: f.json is invalid: it must be a JSON object"] });
});

test('loader recovery policies pass through', async () => {
  const onReadError = () => ['no search manifest'];
  const definition = defineSearchProviderContribution({ filename: 'f.json' }, { onReadError, importErrorReason: 'its module failed to load' });
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
