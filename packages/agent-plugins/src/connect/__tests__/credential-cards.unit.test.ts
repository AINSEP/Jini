import type { PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
import { expect, it, vi } from 'vitest';
import { createPluginContributionLoader } from '../../lifecycle/contribution-loader.js';
import { createCredentialCardsContribution, credentialCardsContribution, mergePluginCredentialCards } from '../credential-cards.js';

const source = { pluginId: 'team-sync', packageRoot: '/trusted/team-sync' };
const copy = { label: 'Shared connection', title: 'Connect to Sync', intro: 'Use a read-only key.', keyHint: 'Read access' };
const rawCard = { ...copy, target: 'sync', category: 'general', baseUrl: 'https://sync.example.test', usedFor: [' Export ledger ', ' Sync records '] };
const expectedCard: PluginCredentialCard = { ...copy, providerId: 'sync', category: 'general', baseUrl: 'https://sync.example.test', usedFor: ['Export ledger', 'Sync records'] };

it.each(['jini', 'portable-legacy'])('loads the %s manifest as data and assigns provenance from the trusted package', async namespace => {
  const manifest = JSON.stringify({ extensions: { [namespace]: { credentialCards: [rawCard] } } });
  const findPackages = vi.fn(async () => [{ trusted: source }]);
  const readFile = vi.fn(async () => manifest);
  const importModule = vi.fn(async () => { throw new Error('data contribution must not import a module'); });
  const loader = createPluginContributionLoader({ findPackages, readFile, importModule });
  const definition = namespace === 'jini' ? credentialCardsContribution
    : createCredentialCardsContribution({ legacyIdentity: { namespace, warning: 'Fixture legacy manifest' } });
  expect(await loader.loadPluginContributions({ workspaceId: 'studio', definition })).toEqual({
    items: [{ ...expectedCard, pluginId: 'team-sync' }], refusals: [],
  });
  expect(findPackages.mock.calls).toEqual([[{ workspaceId: 'studio', filename: 'plugin.json', contribution: 'credential cards', requireActive: true }]]);
  expect(readFile.mock.calls).toEqual([[{ plugin: source, filename: 'plugin.json' }]]);
  expect(importModule.mock.calls).toEqual([]);
});

it('retains mail ordering and rejects conflicting API labels without suppressing same-owner cards or OAuth', () => {
  const mail = { ...expectedCard, providerId: 'mailer', pluginId: 'email', label: 'Mailer' };
  const duplicated = { ...mail, pluginId: 'imposter', label: 'Different label' };
  const main = { ...expectedCard, providerId: 'primary', pluginId: 'sync', label: 'Shared API' };
  const alias = { ...main, providerId: 'alias', saveKind: 'api' as const };
  const conflict = { ...main, providerId: 'conflict', pluginId: 'other' };
  const viaOAuth = { ...main, providerId: 'signin', pluginId: 'other', saveKind: 'oauth' as const };
  const onRefusal = vi.fn();
  expect(mergePluginCredentialCards({ mailCards: [mail], manifestCards: [duplicated, main, alias, viaOAuth] }, { onRefusal })).toEqual([mail, main, alias, viaOAuth]);
  expect(onRefusal.mock.calls).toEqual([["duplicate plugin credential card target 'mailer' was refused"]]);
  onRefusal.mockClear();
  expect(mergePluginCredentialCards({ mailCards: [mail], manifestCards: [main, viaOAuth, conflict] }, { onRefusal })).toEqual([mail, viaOAuth]);
  expect(onRefusal.mock.calls).toEqual([
    ["duplicate API credential label 'Shared API' from 'sync' was refused"],
    ["duplicate API credential label 'Shared API' from 'other' was refused"],
  ]);
});
