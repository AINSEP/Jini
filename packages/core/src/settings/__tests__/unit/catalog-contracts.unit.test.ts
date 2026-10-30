import { expect, it } from 'vitest';
import { definition, fixture } from '../write-tool-fixture.js';
import { registerDefinitions } from '../../write-service.js';

it('a dangling alias advertises its own schema and scopes while remaining unwritable', async () => {
  const alias = definition({ status: 'alias', aliasOfNamespace: 'core.missing', aliasOfKey: 'gone', scopes: 1 });
  const f = fixture([alias]);
  expect(await f.call('settings_list_definitions', {})).toEqual({ data: [{
    namespace: alias.namespace, key: alias.key, ownerKind: alias.ownerKind, scopes: 1, status: 'alias', version: 1,
    schema: { type: 'string' }, agentWritable: false, confirmationRequired: false,
  }] });
});

it('an alias advertises the target schema and scopes and applies protection at both coordinates', async () => {
  const target = definition({ settingId: 'target', namespace: 'core.target', key: 'enabled', scopes: 4, schema: { type: 'boolean' }, defaultValue: false });
  const alias = definition({ status: 'alias', aliasOfNamespace: target.namespace, aliasOfKey: target.key, scopes: 1 });
  const f = fixture([alias, target], { extraDeniedSettings: [{ namespace: target.namespace, key: target.key, reason: 'Host policy' }] });
  expect(await f.call('settings_list_definitions', { namespace: alias.namespace })).toEqual({ data: [{
    namespace: alias.namespace, key: alias.key, ownerKind: alias.ownerKind, scopes: 4, status: 'alias', version: 1,
    schema: { type: 'boolean' }, agentWritable: false, confirmationRequired: false,
  }] });
});

it('definition creation uses the deterministic fixture ID and clock through the write chokepoint', async () => {
  const f = fixture([]);
  const result = await registerDefinitions({ deps: {
    repo: f.settingsRepo, clock: f.deps.clock, ids: f.deps.idGen, authorize: f.deps.authorize, principals: f.deps.principalRepo,
  }, input: { definitions: [{ namespace: 'core.example', key: 'enabled', ownerKind: 'core', workspaceId: null,
    schema: { type: 'boolean' }, defaultValue: false, scopes: 7, secret: false }], callerPrincipalId: 'caller', authWorkspaceId: 'ws-1' } });
  expect(result).toEqual({ registered: ['unused'] });
  expect(await f.settingsRepo.findActiveDefinition({ namespace: 'core.example', key: 'enabled', workspaceId: null })).toMatchObject({
    settingId: 'unused', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', defaultValue: false,
  });
  expect(f.authorizeCalls).toEqual([{ principalId: 'caller', permission: 'settings.definitions.manage', workspaceId: 'ws-1', entityType: 'setting-definition' }]);
});
