import { expect, it } from 'vitest';
import type { HttpClientPort, HttpRequest } from '@jini-ai/core/primitives';
import type { MailProviderSetting, MailTestModeSetting, MailSendLedgerPort, OutboundEmail, MailCredentialFact } from '@jini-ai/core/contracts/mail';
import {
  createMailCatalog, createMailConfiguration, createMailContributions, createHostMailer,
  type MailAdapterRegistry,
} from '@jini-ai/agent-plugins/lifecycle/mail';
import {
  createMailProviderRegistry, createConsoleMailProvider, createSmtpMailProvider, defaultMailProviderSetup,
  parseMailProviderSetupProperty, toPluginHttpClient, fromPositionalMailer, createProviderMailer,
  createResolvedMailer, createMailPolicyWrapper,
} from '@jini-ai/platform/mail';

it('a neutral host sends real plugin and SMTP mail, applies policy, rotates keys and clears plugin lanes', async () => {
  const modulePath = '@jini-ai/agent-plugins/resend/adapters/resend.mjs';
  const module = (await import(modulePath)).default;
  let active = true, token = 'first-key', revision = 1;
  let setting: MailProviderSetting = { transactional: 'resend', bulk: 'resend' };
  let mode: MailTestModeSetting = { mode: 'off' };
  const requests: HttpRequest[] = [], smtp: unknown[] = [], captures: unknown[] = [], ledgerCalls: string[] = [];
  const httpClient: HttpClientPort = { send: async ({ request }) => { requests.push(request); return { status: 200, headers: {}, bodyText: '{"id":"neutral-send"}' }; } };
  const adapters: MailAdapterRegistry = { refusals: [], list: () => active ? [{ pluginId: 'resend', module, descriptor: {
    schemaVersion: 2, id: 'resend', label: 'Resend', module: 'adapters/resend.mjs', credentialLabel: 'Studio key', credentialKeys: ['token'], feedback: true,
  } }] : [] };
  const contributions = createMailContributions({ filename: 'studio-mail.json', parseSetup: parseMailProviderSetupProperty,
    defaultCredentialLabel: ({ label }) => `Studio ${label}`, abi: { fromPositionalMailer, toPluginHttpClient },
    loadFromSource: async () => ({ items: [], refusals: [] }),
  });
  const catalog = createMailCatalog({ mailEngine: { createRegistry: createMailProviderRegistry, builtins: { console: createConsoleMailProvider, smtp: createSmtpMailProvider } },
    mailHostText: { smtpCredentialLabel: 'Studio SMTP', smtpSetup: { fields: [] }, credentialCategory: 'ops' }, defaultSetup: defaultMailProviderSetup,
    contributeMailProviders: contributions.contributeMailProviders,
  });
  const loadCatalog = () => catalog.loadMailProviderCatalog({ loadMailAdapters: async () => adapters,
    createSmtpTransport: config => ({ sendMail: async mail => { smtp.push({ config, mail }); return { messageId: 'smtp-send' }; } }), log: () => {},
  });
  const configuration = createMailConfiguration({ mailHostText: { localOnly: 'Local only', missingCredential: ({ label }) => `Missing ${label}` } });
  const ledger: MailSendLedgerPort = { reserve: async () => { ledgerCalls.push('reserve'); return { status: 'reserved' }; }, mark: async () => { ledgerCalls.push('mark'); } };
  const facts = (): MailCredentialFact[] => [{ id: 'key', label: 'Studio key', updatedAt: String(revision) }, { id: 'smtp', label: 'Studio SMTP', updatedAt: '1' }];
  const resolved = createResolvedMailer({ workspaceId: 'studio', mode: 'production', httpClient,
    providerSetting: { read: async () => setting, write: async ({ setting: value }) => { setting = value; } },
    credentials: { readFact: async ({ label }) => facts().find(row => row.label === label), resolve: async ({ id }) => id === 'smtp' ? { token: 'smtp-pass', username: 'smtp-user', baseUrl: 'https://smtp.example.test:465' } : { token } },
    listCredentialFacts: async () => facts(), loadCatalog,
    createProviderMailer: ({ provider, credential }) => createProviderMailer({ provider, credential, httpClient }),
    describeProviders: configuration.describeMailProviders,
    unconfiguredMessage: () => 'Choose a provider', missingCredentialReason: ({ label }) => `Missing ${label}`, credentialFailureReason: () => 'Cannot read key',
  }, { warn: () => {}, wrapProviderMailer: createMailPolicyWrapper({ ledger,
    suppression: { isSuppressed: async ({ normalizedAddress }) => normalizedAddress === 'blocked@example.test', suppress: async () => {} },
    readTestMode: async () => mode, resendPolicy: () => 'never',
  }, { capture: { capture: async value => { captures.push(value); return { id: 'captured' }; } } }) });
  const host = createHostMailer({ resolved, operations: {}, selection: {
    ready: async () => {}, loadCatalog, readSelection: async () => ({ setting, revisionSeq: revision }),
    writeSelection: async ({ value }) => { setting = value; revision++; }, installedProviderIds: async () => ['resend'],
    toggle: async (input: { pluginId: string; enabled: boolean; actor: string }) => { active = input.enabled; return { enabled: active }; }, isRevisionConflict: () => false,
  } });
  const message: OutboundEmail = { workspaceId: 'studio', from: { email: 'sender@example.test' }, to: { email: 'reader@example.test' }, subject: 'Hello', text: 'Body' };
  const send = (idempotencyKey: string, value = message) => host.mailer.send({ message: value, workspaceId: 'studio', idempotencyKey, sourceContext: { module: 'studio' } });
  await host.ready;
  expect((await send('plugin')).ok).toBe(true);
  expect(ledgerCalls).toEqual(['reserve', 'mark']);
  expect((await host.status()).state).toBe('ready');
  expect(await send('blocked', { ...message, to: { email: 'blocked@example.test' } })).toMatchObject({ ok: false, errorCode: 'MAIL_RECIPIENT_SUPPRESSED' });
  expect(ledgerCalls).toEqual(['reserve', 'mark']);
  mode = { mode: 'capture' };
  expect((await send('capture')).ok).toBe(true);
  expect(captures).toHaveLength(1); expect(requests).toHaveLength(1);
  mode = { mode: 'off' }; token = 'rotated-key'; revision++;
  expect((await send('rotated')).ok).toBe(true);
  expect(requests.at(-1)?.headers.Authorization).toBe('Bearer rotated-key');
  await host.selectProvider({ id: 'smtp', principalId: 'owner' });
  expect((await send('smtp')).ok).toBe(true); expect(smtp).toHaveLength(1);
  expect((await host.status()).state).toBe('ready');
  await host.selectProvider({ id: 'resend', principalId: 'owner' });
  await host.setAgentPluginEnabled({ pluginId: 'resend', enabled: false, actor: 'owner' });
  expect(setting).toEqual({ transactional: null, bulk: null });
  expect((await send('off')).ok).toBe(false);
});
