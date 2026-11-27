import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import {
  describeNewSiteAgentPluginTokenRefusal,
  firstNewSiteAgentPluginTokenRefusal,
  listBundledAgentPluginServers,
  listNewSiteAgentPluginTokenSignInPlugins,
  parseNewSiteAgentPluginTokens,
  resolveBundledAgentPlugin,
} from '../new-site-agent-plugin-tokens.js';
import type { TokenCheckOutcome } from '../token-sign-in.js';

const pluginIdPattern = /^[a-z]+(?:-[a-z]+)*$/;
const copy = {
  refused: ({ name }: { name: string }) => name + ' refused access',
  invalid: ({ name }: { name: string }) => name + ' requires a valid token',
  unsupported: ({ name }: { name: string }) => name + ' does not accept a token',
};

test('returns trimmed nonblank tokens and substitutes host copy for an invalid map', () => {
  const parse = (raw: unknown) => parseNewSiteAgentPluginTokens({
    raw, limits: { pluginIdPattern, maxTokens: 2, maxTokenLength: 32 }, shapeError: 'Use a map of enabled services',
  });
  expect(parse({ github: ' demo ', vercel: '  ' })).toStrictEqual({ ok: true, tokens: { github: 'demo' } });
  expect(parse({ github: ['demo'] })).toStrictEqual({ ok: false, error: 'Use a map of enabled services' });
});

test.each([
  ['refused', { code: 'AGENT_PLUGIN_TOKEN_REFUSED', error: 'Acme Media refused access' }],
  ['invalid', { code: 'AGENT_PLUGIN_TOKEN_INVALID', error: 'Acme Media requires a valid token' }],
  ['unsupported', { code: 'AGENT_PLUGIN_TOKEN_UNSUPPORTED', error: 'Acme Media does not accept a token' }],
  ['ok', null],
  ['unavailable', null],
] as const)('projects a %s check to the correct create-time refusal', (outcome, expected) => {
  expect(describeNewSiteAgentPluginTokenRefusal({ pluginId: 'acme-media', outcome, copy })).toEqual(expected);
});

test('continues after a vendor outage but stops at the first definite refusal', async () => {
  const check = vi.fn(async ({ pluginId, token }: { pluginId: string; token: string }): Promise<TokenCheckOutcome> => {
    if (pluginId === 'alpha' && token === 'a') return 'unavailable';
    if (pluginId === 'bravo' && token === 'b') return 'refused';
    throw new Error('unexpected check');
  });
  await expect(firstNewSiteAgentPluginTokenRefusal({ check, copy, tokens: { alpha: 'a', bravo: 'b', charlie: 'c' } }))
    .resolves.toEqual({ pluginId: 'bravo', code: 'AGENT_PLUGIN_TOKEN_REFUSED', error: 'Bravo refused access' });
  expect(check.mock.calls).toEqual([[{ pluginId: 'alpha', token: 'a' }], [{ pluginId: 'bravo', token: 'b' }]]);
  check.mockClear();
  await expect(firstNewSiteAgentPluginTokenRefusal({ check, copy, tokens: { alpha: 'a' } })).resolves.toBeNull();
  expect(check.mock.calls).toEqual([[{ pluginId: 'alpha', token: 'a' }]]);
});

test('uses valid bundled manifest ids, omitting files, retired bundles and unreadable manifests', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jini-token-catalog-'));
  const eligible = path.join(root, 'plugin-folder');
  const servers = {
    api: { type: 'streamable-http', url: 'https://catalog.example/mcp',
      tokenAuth: { helpUrl: 'https://catalog.example/keys', probeUrl: 'https://catalog.example/session' } },
  } as const;
  const readInstalledMcpServers = vi.fn(async ({ packageRoot }: { packageRoot: string }) => {
    if (packageRoot !== eligible) throw new Error('ineligible bundle read: ' + packageRoot);
    return servers;
  });
  const inputs = { bundledSourceRoot: root, retired: new Set(['retired']), readdir, readFile, pluginIdPattern, readInstalledMcpServers };
  try {
    for (const [folder, manifest] of [
      ['plugin-folder', '{"name":"acme-media"}'], ['retired', '{"name":"retired"}'],
      ['bad-id', '{"name":"not a plugin id"}'], ['no-id', '{"name":42}'], ['bad-json', '{'],
    ] as const) {
      await mkdir(path.join(root, folder));
      await writeFile(path.join(root, folder, 'plugin.json'), manifest);
    }
    await mkdir(path.join(root, 'missing-manifest'));
    await writeFile(path.join(root, 'plain-file'), '{"name":"not-a-package"}');

    await expect(listBundledAgentPluginServers(inputs)).resolves.toEqual([{ pluginId: 'acme-media', servers }]);
    expect(readInstalledMcpServers.mock.calls).toEqual([[{ packageRoot: eligible }]]);
    const resolve = resolveBundledAgentPlugin(inputs);
    await expect(resolve('acme-media')).resolves.toEqual({ servers });
    await expect(resolve('plugin-folder')).resolves.toBeNull();
    await expect(listNewSiteAgentPluginTokenSignInPlugins(inputs)).resolves.toEqual([
      { pluginId: 'acme-media', displayName: 'Acme Media', helpUrl: 'https://catalog.example/keys' },
    ]);
    await expect(listBundledAgentPluginServers({ ...inputs, bundledSourceRoot: path.join(root, 'missing') })).resolves.toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
