import { expect, test, vi } from 'vitest';
import type { HttpClientPort } from "@jini-ai/core/primitives";
import {
  createConsoleMailProvider, createMailProviderRegistry, createSmtpMailProvider, defaultMailProviderSetup,
  fromPositionalMailer, parseMailProviderSetupProperty, toPluginHttpClient, toPositionalMailer,
} from '@jini-ai/platform/mail';
import { createPluginContributionLoader } from '../../contribution-loader.js';
import { createMailCatalog, type MailCatalogDeps } from '../catalog.js';
import { createMailContributions, type MailAdapterModule } from '../contribution.js';
import { createMailConfiguration } from '../configuration.js';

const plugin = { pluginId: 'postal', packageRoot: '/trusted/postal' };
const credentialCard = {
  title: 'Connect Relay', intro: 'Create a key in Relay.', baseUrl: 'https://relay.example',
  helpUrl: 'https://relay.example/keys', usedFor: ['Delivery reports'],
};
const relay = { id: 'relay', label: 'Hosted Relay', module: 'relay.mjs', credentialKeys: ['token', 'username'], feedback: false, credentialCard };

function fixture() {
  const relayModule = {
    id: 'relay',
    capabilities: { hosted: true, feedback: false, domainVerification: false, rateLimit: { perSecond: 4, burst: 9 } },
    domainReadConnection: { serverId: 'relay-account', baseUrl: 'https://account.relay.example/api' },
    create: vi.fn<MailAdapterModule['create']>(() => toPositionalMailer({
      mailer: createConsoleMailProvider({ clock: { nowMs: () => 0 }, preview: () => {} }).create({
        credential: { token: '' }, kit: { httpClient: { send: async () => { throw new Error('no HTTP expected'); } } },
      }),
    })),
  };

  const descriptors = { schemaVersion: 2, adapters: [
    relay,
    { ...relay, id: 'inconsistent', module: 'mismatch.mjs' },
    { ...relay, id: 'bad_feedback', module: 'feedback.mjs', feedback: true },
    { ...relay, id: 'anonymous', module: 'anonymous.mjs', credentialKeys: [], credentialCard: { title: 'x', baseUrl: 'http://non-https.example' } },
  ] };
  const readFile = vi.fn(async ({ plugin: item, filename }: { plugin: typeof plugin; filename: string }) => {
    if (item !== plugin || filename !== 'mail-adapters.json') throw new Error('unexpected read');
    return JSON.stringify(descriptors);
  });
  const loader = createPluginContributionLoader({
    readFile,
    findPackages: async ({ workspaceId, requireActive, orderByPluginId }) => {
      if (workspaceId !== 'site-relay' || requireActive !== true || orderByPluginId !== true) throw new Error('expected trusted active workspace read');
      return [{ trusted: plugin }, { refusal: 'catalog omitted an untrusted plugin' }];
    },
    importModule: async ({ plugin: item, modulePath }) => {
      if (item !== plugin) throw new Error('wrong adapter owner');
      switch (modulePath) {
        case 'relay.mjs': return { exported: relayModule };
        case 'mismatch.mjs': return { exported: { ...relayModule, id: 'another' } };
        case 'feedback.mjs': return { exported: { ...relayModule, id: 'bad_feedback' } };
        case 'anonymous.mjs': return { exported: { ...relayModule, id: 'anonymous', domainReadConnection: undefined } };
        default: throw new Error('unexpected module');
      }
    },
  });
  const contributions = createMailContributions({
    filename: 'mail-adapters.json', parseSetup: parseMailProviderSetupProperty,
    defaultCredentialLabel: ({ label }) => label + ' credential',
    abi: { fromPositionalMailer, toPluginHttpClient }, loadFromSource: loader.loadPluginContributionsFromSource,
  });
  const catalog = createMailCatalog({
    mailEngine: { createRegistry: createMailProviderRegistry, builtins: { console: createConsoleMailProvider, smtp: createSmtpMailProvider } },
    mailHostText: { smtpCredentialLabel: 'SMTP transport', smtpSetup: { fields: [] }, credentialCategory: 'mail' },
    defaultSetup: defaultMailProviderSetup, contributeMailProviders: contributions.contributeMailProviders,
  });
  const resolvePluginAccountToken = vi.fn<NonNullable<MailCatalogDeps['resolvePluginAccountToken']>>(async ({ pluginId, serverId }) => {
    if (pluginId !== 'postal' || serverId !== 'relay-account') throw new Error('wrong account');
    return 'domain-read-demo-key';
  });
  const deps: MailCatalogDeps = {
    loadMailAdapters: () => contributions.loadMailAdapterRegistry({ workspaceId: 'site-relay' }, { loadContributions: loader.loadPluginContributions }),
    createSmtpTransport: () => { throw new Error('unexpected SMTP delivery'); },
    log: () => { throw new Error('unexpected local preview'); },
    resolvePluginAccountToken,
  };
  return { catalog, deps, contributions, readFile, resolvePluginAccountToken, relayModule };
}

test('retains valid descriptor owners and exposes loader, key-card and v2-module refusals in order', async () => {
  const { catalog, deps } = fixture();
  const loaded = await catalog.loadMailProviderCatalog(deps);
  expect(loaded.pluginIds).toEqual(['relay', 'anonymous']);
  expect(loaded.registry.list().map(({ id, pluginId }) => [id, pluginId])).toEqual([
    ['smtp', undefined], ['console', undefined], ['relay', 'postal'], ['anonymous', 'postal'],
  ]);
  expect(loaded.refusals).toEqual([
    'catalog omitted an untrusted plugin',
    "mail adapter 'anonymous' from 'postal' key card was ignored: adapters[3].credentialCard.baseUrl must be an https URL",
    "mail adapter 'inconsistent' from 'postal' was not loaded: its module id 'another' does not match the descriptor id 'inconsistent'",
    "mail adapter 'bad_feedback' from 'postal' was not loaded: its descriptor feedback flag does not match the module's feedback parser",
  ]);
  expect(loaded.credentialLabelFor({ id: 'relay' })).toBe('Hosted Relay credential');
  expect(loaded.setupFor({ id: 'relay' }).fields.map(({ key, type }) => [key, type])).toEqual([['token', 'secret'], ['username', 'text'], ['baseUrl', 'url']]);
  expect(loaded.credentialLabelFor({ id: 'anonymous' })).toBeUndefined();
  expect(loaded.setupFor({ id: 'anonymous' })).toEqual({ fields: [] });
  expect(loaded.credentialLabelFor({ id: 'inconsistent' })).toBeUndefined();
});

test('filing credential cards uses the declaring plugin and exact saved label, independently of the source loader', async () => {
  const { catalog, deps, contributions, readFile } = fixture();
  const source = await contributions.loadMailAdapterRegistryFromSource(plugin);
  expect(source.list().map(({ descriptor }) => descriptor.id)).toEqual(['relay', 'inconsistent', 'bad_feedback', 'anonymous']);
  expect(source.refusals).toEqual([
    "mail adapter 'anonymous' from 'postal' key card was ignored: adapters[3].credentialCard.baseUrl must be an https URL",
  ]);
  expect(readFile.mock.calls).toEqual([[{ plugin, filename: 'mail-adapters.json' }]]);
  const cards = await catalog.loadMailCredentialCards(deps);
  expect(cards.find(card => card.providerId === 'relay')).toEqual({
    pluginId: 'postal', providerId: 'relay', label: 'Hosted Relay credential', category: 'mail', ...credentialCard,
  });
  expect(cards.find(card => card.providerId === 'anonymous')).toBeUndefined();
});

test.each([new Error('catalog unavailable'), 'catalog unavailable'])('falls back to builtins when plugin discovery fails (%s)', async fault => {
  const { catalog, deps } = fixture();
  const failing = { ...deps, loadMailAdapters: async () => { throw fault; } };
  const loaded = await catalog.loadMailProviderCatalog(failing);
  expect(loaded.registry.list().map(({ id }) => id)).toEqual(['smtp', 'console']);
  expect(loaded.refusals).toEqual(['the plugin mail adapters could not be listed (catalog unavailable)']);
  await expect(catalog.loadMailCredentialCards(failing)).resolves.toEqual([]);
});

test('uses a plugin account credential only for the admitted provider’s domain-read origin', async () => {
  const { catalog, deps, resolvePluginAccountToken } = fixture();
  await expect(catalog.resolveMailDomainReadCredential({ deps, id: 'relay' })).resolves.toEqual({
    token: 'domain-read-demo-key', baseUrl: 'https://account.relay.example/api',
  });
  await expect(catalog.resolveMailDomainReadCredential({ deps, id: 'console' })).resolves.toBeNull();
  await expect(catalog.resolveMailDomainReadCredential({ deps, id: 'anonymous' })).resolves.toBeNull();
  expect(resolvePluginAccountToken.mock.calls).toEqual([[{ pluginId: 'postal', serverId: 'relay-account' }]]);
  resolvePluginAccountToken.mockResolvedValueOnce(null);
  await expect(catalog.resolveMailDomainReadCredential({ deps, id: 'relay' })).resolves.toBeNull();
});

test('configuration checks required username presence without returning the username', async () => {
  const f = fixture();
  const catalog = await f.catalog.loadMailProviderCatalog(f.deps);
  const { describeMailProviders } = createMailConfiguration({
    mailHostText: { localOnly: 'Local development only', missingCredential: ({ label }) => 'Configure ' + label },
  });
  const facts = { id: 'stored-17', label: 'Hosted Relay credential', updatedAt: '2026-01-02T10:00:00Z' };
  const read = (username: string | null) => describeMailProviders({
    catalog, records: [{ ...facts, username }], setting: { transactional: 'relay', bulk: 'anonymous' },
  });
  const report = read(null);
  expect(report.setting).toEqual({ transactional: 'relay', bulk: 'anonymous' });
  expect(report.providers.find(provider => provider.id === 'relay')).toMatchObject({
    id: 'relay', label: 'Hosted Relay', origin: 'plugin', hosted: true, lanes: ['transactional'], pluginId: 'postal',
    capabilities: { feedback: false, domainVerification: false, rateLimit: { perSecond: 4, burst: 9 } },
    credential: { required: true, saved: false, label: 'Hosted Relay credential', credentialId: 'stored-17', updatedAt: '2026-01-02T10:00:00Z' },
    selectable: false, refusal: 'Configure Hosted Relay credential',
  });
  expect(report.providers.find(provider => provider.id === 'console')).toMatchObject({
    lanes: [], credential: { required: false, saved: false }, hosted: false, selectable: false, refusal: 'Local development only',
  });
  expect(report.providers.find(provider => provider.id === 'smtp')).toMatchObject({
    credential: { required: true, saved: false, label: 'SMTP transport' }, selectable: false,
  });
  expect(report.providers.find(provider => provider.id === 'anonymous')).toMatchObject({
    lanes: ['bulk'], credential: { required: false, saved: false }, selectable: true,
  });
  const ready = read('private-account-name').providers.find(provider => provider.id === 'relay');
  expect(ready).toMatchObject({ selectable: true, credential: { saved: true, credentialId: 'stored-17' } });
  expect(ready).not.toHaveProperty('refusal');
  expect(JSON.stringify(ready)).not.toContain('private-account-name');
});

test('the contributed provider adapts the guarded HTTP seam and delivers through the plugin mailer', async () => {
  const { catalog, deps, relayModule } = fixture();
  const registry = (await catalog.loadMailProviderCatalog(deps)).registry;
  const provider = registry.get({ id: 'relay' })!.provider;
  const credential = { token: 'sending-demo-token', username: 'mail-worker', baseUrl: 'https://relay.example' };
  const client = { send: vi.fn<HttpClientPort['send']>(async () => { throw new Error('fixture HTTP refusal'); }) };
  const mailer = provider.create({ credential, kit: { httpClient: client } });
  expect(relayModule.create).toHaveBeenCalledTimes(1);
  const [created] = relayModule.create.mock.calls[0]!;
  expect(created.credential).toEqual(credential);
  const request = { url: 'https://relay.example/ping', method: 'GET', headers: {}, timeoutMs: 5000 } as const;
  await expect(created.kit.httpClient.send(request, { redirect: 'error' })).rejects.toThrow('fixture HTTP refusal');
  expect(client.send.mock.calls).toEqual([[{ request }, { redirect: 'error' }]]);
  const message = { workspaceId: 'site-relay', to: { email: 'recipient@example.test' }, from: { email: 'sender@example.test' }, subject: 'Relay fixture', text: 'Your digest' };
  await expect(mailer.send({ message, workspaceId: 'site-relay', idempotencyKey: 'mail-17', sourceContext: { module: 'digest' } })).resolves.toEqual({ ok: true, providerMessageId: 'console-1', acceptedAt: '1970-01-01T00:00:00.000Z' });
});
