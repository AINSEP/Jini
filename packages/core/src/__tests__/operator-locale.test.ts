import { expect, it, vi } from 'vitest';
import type { GetEffectiveSetting } from '../contracts/headless/operator-locale.js';
import { resolveOperatorLocale } from '../operator-locale.js';
import { InMemorySettingsRepo } from '../settings/repo.memory.js';
import type { SettingDefinitionRecord, SettingValueRecord } from '../settings/types.js';

const actor = { workspaceId: 'workspace-2', principalId: 'ana' };
const time = '2026-11-26T12:00:00.000Z';

it('reads the current operator’s actual per-user language setting, not another operator’s or the default', async () => {
  const definition: SettingDefinitionRecord = {
    settingId: 'setting-language', version: 1, workspaceId: null, namespace: 'core.language', key: 'locale',
    ownerKind: 'core', ownerId: null, schema: { type: 'string' }, defaultValue: 'en', scopes: 7, secret: false,
    status: 'active', aliasOfNamespace: null, aliasOfKey: null, coercionTag: null, createdAt: time, updatedAt: time,
  };
  const value = (principalId: string, workspaceId: string, valueJson: string): SettingValueRecord => ({
    settingId: 'setting-language', scope: 'user', workspaceId, principalId, valueJson, state: 'set', defVersion: 1,
    seq: 1, updatedBy: principalId, updatedAt: time, originPluginId: null,
  });
  const settingsRepo = new InMemorySettingsRepo({
    definitions: [definition],
    userValues: [value('ana', 'workspace-1', 'fr'), value('bea', 'workspace-2', 'es'), value('ana', 'workspace-2', 'pt-BR')],
  });
  expect(await resolveOperatorLocale({ ...actor, deps: { settingsRepo } })).toBe('pt-BR');
});

it('keeps the confirmation available in English when the settings repo or a usable locale is missing', async () => {
  const getEffective = vi.fn<GetEffectiveSetting>()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ value: 123 })
    .mockResolvedValueOnce({ value: '' })
    .mockRejectedValueOnce(new Error('settings read failed'));
  expect(await resolveOperatorLocale({ ...actor, deps: {} }, { getEffective })).toBe('en');
  expect(getEffective).not.toHaveBeenCalled();
  const settingsRepo = new InMemorySettingsRepo();
  for (const failure of ['unset', 'non-string', 'empty', 'read failure']) {
    expect(await resolveOperatorLocale({ ...actor, deps: { settingsRepo } }, { getEffective }), failure).toBe('en');
  }
  const required = { deps: { repo: settingsRepo }, namespace: 'core.language', key: 'locale', scopeContext: actor };
  expect(getEffective.mock.calls).toEqual([[required], [required], [required], [required]]);
});
