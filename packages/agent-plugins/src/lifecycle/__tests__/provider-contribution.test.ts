import { expect, test } from 'vitest';
import { createProviderRegistry } from '@jini-ai/core/provider-registry';
import { createPluginContributionLoader, type PluginContributionPorts } from '../contribution-loader.js';
import {
  contributeProviders, defineProviderContribution,
  type LoadedProviderContribution, type ProviderContributionDescriptor,
} from '../provider-contribution.js';

interface Mailer { readonly send: () => string }
const plugin = { pluginId: 'acme_mail', packageRoot: '/plugins/acme_mail' };
const validate = ({ exported }: { exported: unknown }): Mailer | string => {
  const candidate = exported as Partial<Mailer> | null;
  return candidate && typeof candidate.send === 'function' ? candidate as Mailer : "its module's default export has no send()";
};

function setup(descriptors: readonly ProviderContributionDescriptor[], overrides: Partial<PluginContributionPorts> = {}, optional: Parameters<typeof defineProviderContribution>[1] = {}) {
  const imports: string[] = [];
  const definition = defineProviderContribution<ProviderContributionDescriptor, Mailer>({
    contract: 'mail', filename: 'host-mail-providers.json',
    parse: ({ raw }) => raw === 'invalid' ? { ok: false, reason: 'not valid JSON' } : { ok: true, descriptors },
    validate,
  }, optional);
  const loader = createPluginContributionLoader({
    findPackages: async () => [{ trusted: plugin }],
    readFile: async () => 'valid',
    importModule: async ({ modulePath }) => {
      imports.push(modulePath);
      return modulePath === 'broken.mjs' ? { exported: {} } : { exported: { send: () => modulePath } };
    },
    ...overrides,
  });
  return { definition, imports, load: () => loader.loadPluginContributions({ workspaceId: 'w1', definition }) };
}

test('definition is executable, named for the contract, and keeps the host filename', () => {
  const { definition } = setup([]);
  expect([definition.kind, definition.contribution, definition.filename]).toEqual(['executable', 'mail providers', 'host-mail-providers.json']);
  expect(definition.onReadError).toBeTypeOf('function');
});

test('loads valid providers as definitions with contract, pluginId and optional label', async () => {
  const { load, imports } = setup([{ id: 'acme', module: 'acme.mjs', label: 'Acme Mail' }, { id: 'acme_eu', module: 'eu.mjs' }]);
  const result = await load();
  expect(result.refusals).toEqual([]);
  expect(imports).toEqual(['acme.mjs', 'eu.mjs']);
  expect(result.items.map(item => ({ ...item, definition: { ...item.definition, provider: item.definition.provider.send() } }))).toEqual([
    { contract: 'mail', pluginId: 'acme_mail', definition: { id: 'acme', provider: 'acme.mjs', label: 'Acme Mail' } },
    { contract: 'mail', pluginId: 'acme_mail', definition: { id: 'acme_eu', provider: 'eu.mjs' } },
  ]);
  expect('label' in result.items[1]!.definition).toBe(false);
});

test('a bad id is refused before its module is imported; invalid exports and manifests are refused', async () => {
  const { load, imports } = setup([
    { id: 'Acme-Mail', module: 'acme.mjs' },
    { id: 7 as unknown as string, module: 'seven.mjs' },
    { id: 'broken', module: 'broken.mjs' },
  ]);
  const result = await load();
  expect(imports).toEqual(['broken.mjs']);
  expect(result.items).toEqual([]);
  expect(result.refusals).toEqual([
    "mail provider 'Acme-Mail' from 'acme_mail' was not loaded: its id must match ^[a-z][a-z0-9_]{0,63}$",
    "mail provider '7' from 'acme_mail' was not loaded: its id must match ^[a-z][a-z0-9_]{0,63}$",
    "mail provider 'broken' from 'acme_mail' was not loaded: its module's default export has no send()",
  ]);
  const invalid = setup([], { readFile: async () => 'invalid' });
  expect((await invalid.load()).refusals).toEqual(["mail providers from 'acme_mail' were not loaded: host-mail-providers.json is invalid: not valid JSON"]);
});

test('optional recovery policies pass through to the executable loader', async () => {
  const onReadError = () => ['manifest missing'];
  const missing = setup([], { readFile: async () => { throw new Error('ENOENT'); } }, { onReadError });
  expect(missing.definition.onReadError).toBe(onReadError);
  expect((await missing.load()).refusals).toEqual(['manifest missing']);
  const throwing = setup([{ id: 'acme', module: 'acme.mjs' }], { importModule: async () => { throw new Error('boom'); } }, { importErrorReason: 'its module failed to load' });
  expect((await throwing.load()).refusals).toEqual(["mail provider 'acme' from 'acme_mail' was not loaded: its module failed to load"]);
  const refused = setup([{ id: 'acme', module: '../escape.mjs' }], { importModule: async () => 'path escapes the plugin root' }, { importRefusalReason: 'its module is outside the plugin' });
  expect((await refused.load()).refusals).toEqual(["mail provider 'acme' from 'acme_mail' was not loaded: its module is outside the plugin"]);
});

test('without recovery policies every failure is a refusal and later contributions still load', async () => {
  const unreadable = { pluginId: 'unreadable', packageRoot: '/plugins/unreadable' };
  const later = { pluginId: 'later', packageRoot: '/plugins/later' };
  const { load } = setup([{ id: 'boom', module: 'boom.mjs' }, { id: 'acme', module: 'acme.mjs' }], {
    findPackages: async () => [{ trusted: unreadable }, { trusted: plugin }, { trusted: later }],
    readFile: async ({ plugin: p }) => { if (p.pluginId === 'unreadable') throw new Error('EIO'); return 'valid'; },
    importModule: async ({ modulePath }) => { if (modulePath === 'boom.mjs') throw new Error('boom'); return { exported: { send: () => modulePath } }; },
  });
  const result = await load();
  expect(result.items.map(item => `${item.pluginId}:${item.definition.id}`)).toEqual(['acme_mail:acme', 'later:acme']);
  expect(result.refusals).toEqual([
    "mail providers from 'unreadable' were not loaded: host-mail-providers.json could not be read",
    "mail provider 'boom' from 'acme_mail' was not loaded: its module failed to load",
    "mail provider 'boom' from 'later' was not loaded: its module failed to load",
  ]);
});

test('a throwing parser, validator or descriptor is refused, never thrown', async () => {
  const throwingParse = defineProviderContribution<ProviderContributionDescriptor, Mailer>({
    contract: 'mail', filename: 'f.json', parse: () => { throw new Error('parser bug'); }, validate,
  });
  expect(throwingParse.parse({ raw: '{}' })).toEqual({ ok: false, reason: 'its parser failed' });
  const throwingValidate = defineProviderContribution<ProviderContributionDescriptor, Mailer>({
    contract: 'mail', filename: 'f.json', parse: ({ raw }) => ({ ok: true, descriptors: JSON.parse(raw) }), validate: () => { throw new Error('validator bug'); },
  });
  const importModule = async () => ({ exported: {} });
  await expect(throwingValidate.load({ plugin, descriptor: { id: 'acme', module: 'a.mjs' }, importModule }))
    .resolves.toBe("mail provider 'acme' from 'acme_mail' was not loaded: its module failed to load");
  const hostile = Object.defineProperty({ module: 'a.mjs' }, 'id', { get: () => { throw new Error('getter'); } }) as ProviderContributionDescriptor;
  await expect(throwingValidate.load({ plugin, descriptor: hostile, importModule }))
    .resolves.toBe("mail provider from 'acme_mail' was not loaded: its declaration could not be read");
});

test('contributeProviders registers accepted providers and merges loader + registry refusals without throwing', () => {
  const registry = createProviderRegistry<Mailer>({ contract: 'mail' }, { seed: [{ id: 'smtp', provider: { send: () => 'smtp' } }] });
  registry.contribute({ definition: { id: 'old', provider: { send: () => 'old' } }, pluginId: 'earlier', contract: 'dns' });
  const item = (id: string, pluginId: string, contract = 'mail'): LoadedProviderContribution<Mailer> => ({ contract, pluginId, definition: { id, provider: { send: () => id } } });
  const result = contributeProviders({
    registry,
    loaded: { items: [item('acme', 'acme_mail'), item('smtp', 'acme_mail'), item('dnsy', 'acme_mail', 'dns'), item('acme', 'other')], refusals: ['loader refusal'] },
  });
  expect(result).toEqual({
    accepted: ['acme'],
    refusals: [
      'loader refusal',
      "mail provider 'smtp' from plugin 'acme_mail' was not loaded: already registered by the built-in provider",
      "plugin 'acme_mail' contributed provider 'dnsy' for contract 'dns', not 'mail'",
      "mail provider 'acme' from plugin 'other' was not loaded: already registered by plugin 'acme_mail'",
    ],
  });
  expect(registry.get({ id: 'acme' })?.pluginId).toBe('acme_mail');
  expect(registry.get({ id: 'smtp' })?.provider.send()).toBe('smtp');
});
