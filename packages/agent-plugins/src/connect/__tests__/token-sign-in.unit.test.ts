import { expect, test, vi } from 'vitest';
import { checkAgentPluginAccessToken } from '../token-sign-in.js';
import { soleTokenAuth, listTokenSignInPlugins } from '../../core/token-sign-in-list.js';
import { titleCaseFromPluginId } from '../../core/plugin-display-name.js';
import type { RemoteMcpServerConfig } from '../../lifecycle/manifest.js';

const remote = {
  type: 'streamable-http',
  url: 'https://vendor.example/mcp',
  tokenAuth: { helpUrl: 'https://vendor.example/account/keys', probeUrl: 'https://vendor.example/account/me' },
} as const satisfies RemoteMcpServerConfig;
const stdio = { type: 'stdio', command: 'local-helper' } as const;

test('formats mixed separators without empty words and preserves the rest of each word', () => {
  expect(titleCaseFromPluginId({ pluginId: '__acme--GraphQL_client-' })).toBe('Acme GraphQL Client');
});

test('offers only unambiguous token sign-in plugins in plugin-id order with their human help links', async () => {
  const listPlugins = vi.fn(async (workspaceId: string): ReturnType<Parameters<typeof listTokenSignInPlugins>[0]["listPlugins"]> => {
    if (workspaceId !== 'draft-site') throw new Error('wrong workspace');
    return [
      { pluginId: 'zeta-media', servers: { remote } },
      { pluginId: 'split', servers: { remote, secondary: { ...remote, type: 'sse' as const } } },
      { pluginId: 'local', servers: { stdio } },
      { pluginId: 'acme-api', servers: { remote: { ...remote, tokenAuth: { ...remote.tokenAuth, helpUrl: 'https://acme.example/keys' } }, stdio } },
    ];
  });
  await expect(listTokenSignInPlugins({ workspaceId: 'draft-site', listPlugins })).resolves.toEqual([
    { pluginId: 'acme-api', displayName: 'Acme Api', helpUrl: 'https://acme.example/keys' },
    { pluginId: 'zeta-media', displayName: 'Zeta Media', helpUrl: 'https://vendor.example/account/keys' },
  ]);
  expect(soleTokenAuth({ ordinary: { type: 'sse', url: 'https://ordinary.example/events' } })).toBeNull();
});

function rig() {
  const probe = vi.fn(async ({ probeUrl, token }: { probeUrl: string; token: string }) => {
    if (probeUrl !== 'https://vendor.example/account/me') throw new Error('not the declared probe endpoint');
    if (token === 'demo-accepted') return 'ok' as const;
    if (token === 'demo-denied') return 'refused' as const;
    if (token === 'demo-offline') return 'unavailable' as const;
    throw new Error('unexpected token');
  });
  const assertToken = vi.fn(({ value }: { value: unknown; field: 'token' }) => {
    if (typeof value !== 'string' || !value.startsWith('demo-')) throw new Error('malformed token');
  });
  const resolveInstalledPlugin = vi.fn(async (pluginId: string) => {
    if (pluginId === 'unreadable') throw new Error('/private/catalog unavailable');
    if (pluginId === 'missing') return null;
    if (pluginId === 'local-only') return { servers: { stdio } };
    if (pluginId === 'vendor') return { servers: { remote } };
    throw new Error('unknown fixture request');
  });
  const check = (pluginId: string, token: string) => checkAgentPluginAccessToken({
    deps: { workspaceId: 'draft-site', resolveInstalledPlugin, credentials: { probe }, tokenValidator: { assertToken } },
    input: { pluginId, token },
  });
  return { check, probe, assertToken, resolveInstalledPlugin };
}

test.each([
  ['demo-accepted', 'ok'], ['demo-denied', 'refused'], ['demo-offline', 'unavailable'],
])('returns only the probe outcome for %s', async (token, outcome) => {
  const { check, probe, assertToken, resolveInstalledPlugin } = rig();
  await expect(check('vendor', token)).resolves.toBe(outcome);
  expect(resolveInstalledPlugin.mock.calls).toEqual([['vendor']]);
  expect(assertToken.mock.calls).toEqual([[{ value: token, field: 'token' }]]);
  expect(probe.mock.calls).toEqual([[{ probeUrl: 'https://vendor.example/account/me', token }]]);
});

test.each(['missing', 'unreadable', 'local-only'])('does not validate or probe a token for %s', async pluginId => {
  const { check, probe, assertToken, resolveInstalledPlugin } = rig();
  await expect(check(pluginId, 'demo-accepted')).resolves.toBe('unsupported');
  expect(resolveInstalledPlugin.mock.calls).toEqual([[pluginId]]);
  expect(assertToken.mock.calls).toEqual([]);
  expect(probe.mock.calls).toEqual([]);
});

test('refuses malformed token input before calling the probe', async () => {
  const { check, probe, assertToken } = rig();
  await expect(check('vendor', 'broken')).resolves.toBe('invalid');
  expect(assertToken.mock.calls).toEqual([[{ value: 'broken', field: 'token' }]]);
  expect(probe.mock.calls).toEqual([]);
});

test('maps a thrown probe transport error to an unavailable check without exposing its text', async () => {
  const { check, probe } = rig();
  probe.mockRejectedValueOnce(new Error('transport failed with private response data'));
  await expect(check('vendor', 'demo-accepted')).resolves.toBe('unavailable');
});
