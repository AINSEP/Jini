import { ToolInputError } from '@jini-ai/core';
import { expect, test, vi } from 'vitest';
import { buildModelSaveInput, buildSaveExternalMcpServerInputFromFormParams } from '../save-input.js';

test('normalizes the lookup id and screens every accepted model string before prefilling', () => {
  const assertCredentialFreeField = vi.fn();
  expect(buildModelSaveInput({ id: '  Team-Docs ', transport: 'stdio', enabled: false,
    label: 'Team docs', args: '["docs.mjs"]', allowedToolNames: 4 }, { assertCredentialFreeField })).toStrictEqual({
    id: 'team-docs', transport: 'stdio', enabled: false, label: 'Team docs', args: '["docs.mjs"]',
  });
  expect(assertCredentialFreeField.mock.calls).toStrictEqual([
    [{ field: 'label', value: 'Team docs' }], [{ field: 'args', value: '["docs.mjs"]' }],
  ]);
});

test.each([
  { extra: { accessToken: 'fixture' }, message: 'external_mcp_save: credentials belong in the human form, never in this tool input. Nothing was saved.' },
  { extra: { enabled: 'false' }, message: "'enabled' must be true or false. Nothing was saved." },
])('rejects invalid model fields before screening the prefill: $message', ({ extra, message }) => {
  const assertCredentialFreeField = vi.fn();
  expect(() => buildModelSaveInput({ id: 'docs', transport: 'stdio', label: 'Docs', ...extra },
    { assertCredentialFreeField })).toThrow(new ToolInputError({ message }));
  expect(assertCredentialFreeField.mock.calls).toEqual([]);
});

test('leaves enabled unset when the model did not propose access', () => {
  expect(buildModelSaveInput({ id: 'Docs', transport: 'streamable_http' }, {
    assertCredentialFreeField: () => { throw new Error('no optional text to screen'); },
  })).toStrictEqual({ id: 'docs', transport: 'streamable_http' });
});

const destination = { workspaceId: 'workspace-a', principalId: 'reviewer' };
const bound = { id: 'docs', transport: 'streamable_http', enabled: false };

test('maps human-entered credentials and preserves explicit write grants and disabled state', () => {
  expect(buildSaveExternalMcpServerInputFromFormParams({ ...destination, params: { ...bound,
    url: 'https://docs.example/mcp', label: 'Team Docs', command: 'node', args: '["docs.mjs"]',
    allowedToolNames: 'read,edit', writeAllowedToolNames: 'edit', authMode: 'oauth',
    accessTokenEnvName: 'DOCS_BEARER', env: 'DOCS_MODE=prod', accessToken: 'token-fixture',
    oauthProviderId: 'docs-auth', oauthGrant: 'authorization_code', oauthClientId: 'client',
    oauthClientSecret: 'form-secret', oauthScopes: 'docs.read', oauthTokenEnvName: 'OAUTH_BEARER',
    oauthAuthorizationEndpoint: 'https://docs.example/auth', oauthTokenEndpoint: 'https://docs.example/token',
    oauthDeviceAuthorizationEndpoint: 'https://docs.example/device',
  } })).toStrictEqual({
    ...destination, serverId: 'docs', transport: 'streamable_http', enabled: false,
    url: 'https://docs.example/mcp', label: 'Team Docs', command: 'node', args: '["docs.mjs"]',
    allowedToolNames: 'read,edit', writeAllowedToolNames: 'edit', authMode: 'oauth',
    accessTokenEnvName: 'DOCS_BEARER', env: 'DOCS_MODE=prod', accessToken: 'token-fixture',
    oauth: { providerId: 'docs-auth', grant: 'authorization_code', clientId: 'client',
      clientSecret: 'form-secret', scopes: 'docs.read', tokenEnvName: 'OAUTH_BEARER',
      authorizationEndpoint: 'https://docs.example/auth', tokenEndpoint: 'https://docs.example/token',
      deviceAuthorizationEndpoint: 'https://docs.example/device' },
  });
});

test('an empty secret field retains stored credentials while an empty scope field requests a clear', () => {
  const expected = { ...destination, serverId: 'docs', transport: 'streamable_http', enabled: false,
    command: '', args: '', allowedToolNames: '', writeAllowedToolNames: '' };
  expect(buildSaveExternalMcpServerInputFromFormParams({ ...destination, params: { ...bound,
    env: '', accessToken: '', oauthClientSecret: '', args: false,
  } })).toStrictEqual(expected);
  expect(buildSaveExternalMcpServerInputFromFormParams({ ...destination, params: { ...bound,
    oauthClientSecret: '', oauthScopes: '',
  } })).toStrictEqual({ ...expected, oauth: { scopes: '' } });
});

test.each([{ id: undefined }, { transport: 17 }])('rejects a form without a bound destination: %j', invalid => {
  expect(() => buildSaveExternalMcpServerInputFromFormParams({ ...destination, params: { ...bound, ...invalid } }))
    .toThrow(new Error("external_mcp_save: the submitted form is missing 'id' or 'transport'."));
});
