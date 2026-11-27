import { ToolInputError } from '@jini-ai/core';
import { expect, test, vi } from 'vitest';
import { readPluginIdentity } from '@jini-ai/core/plugin-directory';
import type { InstalledAgentPlugin } from '@jini-ai/core/contracts/site/agent-plugins-lifecycle';
import { createAgentPluginLayout } from '../../lifecycle/layout.js';
import type { resolveAgentPluginMcpServers } from '../federate-mcp.js';
import { createPluginHost, type PluginHostDeps } from '../plugin-host/index.js';

// Each message is a distinct, recognisable sentence so a test can tell WHICH one reached the owner.
const MESSAGES = {
  provisioningFailed: ({ pluginId, failed }: { pluginId: string; failed: readonly { serverKey: string; reason: string }[] }) =>
    `Plugin '${pluginId}' could not connect: ${failed.map(f => `${f.serverKey} (${f.reason})`).join('; ')}. Retry with plugins_set_enabled.`,
  approvedSnapshotMissing: () => 'The approved access snapshot is missing.',
  approvedLoadFailed: ({ detail }: { detail: string }) => `The approved enable could not load. Details: ${detail}`,
  combinedGrantRejected: () => 'grant', sourceConfiguredSeparately: () => 'differs', sseTransportUnsupported: () => 'sse', headersUnsupported: () => 'headers',
};
const NO_FAILURES = { provisioned: [], alreadyProvisioned: [], adopted: [], skipped: [], failed: [] };

interface HostRig { provision?: () => Promise<unknown>; grant?: () => Promise<unknown>; warnings?: string[]; report?: { warn: (...args: unknown[]) => void } }

function lifecycleWith({ provision = async () => NO_FAILURES, grant = async () => [], warnings = [], report }: HostRig) {
  const deps = {
    workspaceId: 'ws', agentPluginLayout: {}, clock: { now: () => new Date(0) }, namespace: 'other-host',
    discoverPlugins: async () => [], getActivation: async () => null,
    lifecycle: { listInstalled: async () => [], preferInstalled: async ({ installed }: { installed: unknown }) => installed },
    installedMcp: {}, classifyTrust: () => 'auto-admit', declinedAccessActor: 'other-host:declined',
    withLock: ({ run }: { run: () => Promise<unknown> }) => run(),
    mcp: { repo: {}, applyAccess: async () => {}, notifyRosterChanged: async () => {} },
    mcpPorts: { projections: {}, classifyError: () => 'other' },
    grantSignedInDefaults: grant, warn: (m: string) => { warnings.push(m); }, messages: MESSAGES,
    ...(report ? { report } : {}),
  } as unknown as PluginHostDeps<never>;
  const host = createPluginHost({ deps }, { resolveMcpServers: async () => ({}) as never, provisionMcpServers: provision as never });
  const capability = host.getHostCapability({ capability: 'agent-plugin-lifecycle' });
  if (capability === undefined) throw new Error('lifecycle capability missing');
  return capability;
}

const APPROVED = { approvedEnable: true, approvedEnableKey: 'snapshot-key' };

test('an approved enable tells the owner which server failed and why, with the secret redacted', async () => {
  const token = ['ghp_', 'x'.repeat(36)].join('');
  const failed = [{ serverKey: 'repository', reason: `provider refused credential ${token}` }];
  const lifecycle = lifecycleWith({ provision: async () => ({ ...NO_FAILURES, failed }) });
  const refusal = await lifecycle.provisionMcp({ pluginId: 'github', principalId: 'owner' }, APPROVED).then(() => undefined, (error: unknown) => error);
  expect(refusal).toBeInstanceOf(ToolInputError);
  const { message } = refusal as ToolInputError;
  expect(message).toContain("Plugin 'github' could not connect: repository (provider refused credential");
  expect(message).toContain('plugins_set_enabled');
  expect(message).not.toContain(token);
  expect(message).not.toContain('could not load');
});

test('an approved enable without its snapshot says so, and provisions nothing', async () => {
  let provisions = 0;
  const lifecycle = lifecycleWith({ provision: async () => { provisions++; return NO_FAILURES; } });
  await expect(lifecycle.provisionMcp({ pluginId: 'github', principalId: 'owner' }, { approvedEnable: true })).rejects.toThrow('The approved access snapshot is missing.');
  expect(provisions).toBe(0);
});

test('an approved enable shows the sign-in grant owner its own refusal', async () => {
  const lifecycle = lifecycleWith({ grant: async () => { throw new ToolInputError({ message: 'The plugin declaration or access changed after approval. Nothing was granted.' }); } });
  await expect(lifecycle.provisionMcp({ pluginId: 'github', principalId: 'owner' }, APPROVED)).rejects.toThrow('changed after approval. Nothing was granted.');
});

test('an approved enable still maps a genuine unexpected fault to the generic load failure, class name only', async () => {
  const lifecycle = lifecycleWith({ provision: async () => { throw new Error('boom api_key=SECRETSECRETSECRETSECRET'); } });
  const refusal = await lifecycle.provisionMcp({ pluginId: 'github', principalId: 'owner' }, APPROVED).then(() => undefined, (error: unknown) => error);
  expect(refusal).toBeInstanceOf(ToolInputError);
  expect((refusal as ToolInputError).message).toBe('The approved enable could not load. Details: Error');
});

test('an enable nobody approved stays best-effort: a refusal from the grant owner is warned, never thrown', async () => {
  const warnings: string[] = [];
  const lifecycle = lifecycleWith({ warnings, grant: async () => { throw new ToolInputError({ message: 'The plugin declaration or access changed after approval.' }); } });
  await expect(lifecycle.provisionMcp({ pluginId: 'github', principalId: 'owner' })).resolves.toBeUndefined();
  expect(warnings).toEqual(["Plugin 'github': MCP provisioning could not run — ToolInputError"]);
});

test('an enable nobody approved hands an unexpected fault to the injected reporter, not the warn channel', async () => {
  const warnings: string[] = [];
  const reported: unknown[][] = [];
  const fault = new Error('boom');
  const lifecycle = lifecycleWith({ warnings, report: { warn: (...args: unknown[]) => { reported.push(args); } }, provision: async () => { throw fault; } });
  await expect(lifecycle.provisionMcp({ pluginId: 'github', principalId: 'owner' })).resolves.toBeUndefined();
  expect(warnings).toEqual([]);
  expect(reported).toEqual([[{ message: "Plugin 'github': MCP provisioning could not run." }, { error: fault }]]);
});

test('preview plans declared MCP grants against this workspace without writing an activation', async () => {
  const unexpected = () => { throw new Error('preview attempted a write or unrelated read'); };
  const layout = createAgentPluginLayout({ root: '/plugin-host' });
  const server = {
    type: 'streamable-http', url: 'https://preview.example/mcp', authMode: 'oauth',
    defaultTools: { allow: ['inspect', 'change'], write: ['change'] },
  } as const;
  const resolveMcpServers = vi.fn<typeof resolveAgentPluginMcpServers>(async input => {
    if (input.workspaceId !== 'ws' || input.pluginId !== 'preview-plugin') throw new Error('wrong preview target');
    return { relay: server };
  });
  const findByServerId = vi.fn<PluginHostDeps<never>['mcp']['repo']['findByServerId']>(async () => null);
  const projections: PluginHostDeps<never>['mcpPorts']['projections'] = {
    accessSnapshot: unexpected, admissionRevision: unexpected, readToolGrants: unexpected, oauthStatus: unexpected,
    hasStaticAccessToken: unexpected, validateToolNames: ({ names }) => [...names],
  };
  const mcpPorts = { projections, classifyError: () => 'other' as const };
  const installedMcp = { listInstalledPlugins: unexpected, readBundledAgentPluginDigests: unexpected, preferBundledAgentPluginDigests: unexpected, readInstalledMcpServers: unexpected };
  const deps: PluginHostDeps<never> = {
    workspaceId: 'ws', namespace: 'jini', agentPluginLayout: layout, clock: { nowMs: () => 0 },
    discoverPlugins: unexpected, getActivation: unexpected, installedMcp,
    lifecycle: { listInstalled: unexpected, preferInstalled: unexpected, readIdentity: unexpected, isEnabled: unexpected,
      inactivePluginIds: unexpected, assertWritable: unexpected, setEnabled: unexpected, uninstall: unexpected },
    mcp: { ...mcpPorts, repo: { findByServerId, updateIfVersion: unexpected, deleteByServerId: unexpected, updateAccessIfCurrent: unexpected },
      applyAccess: unexpected, saveServer: unexpected, notifyRosterChanged: unexpected },
    mcpPorts, classifyTrust: () => 'auto-admit', declinedAccessActor: 'default:decline', withLock: unexpected,
    grantSignedInDefaults: unexpected, messages: MESSAGES, warn: unexpected,
  };
  const lifecycle = createPluginHost({ deps }, { resolveMcpServers }).getHostCapability({ capability: 'agent-plugin-lifecycle' })!;
  const preview = await lifecycle.previewEnableAccess({ pluginId: 'preview-plugin' });
  expect(preview.resources).toEqual([{
    id: 'relay', label: 'External MCP source: https://preview.example/mcp',
    previous: { enabled: false, allow: [], write: [] },
    proposed: { enabled: true, allow: ['inspect', 'change'], write: ['change'] }, revision: null,
  }]);
  expect(findByServerId.mock.calls).toEqual([[{ workspaceId: 'ws', serverId: 'relay' }]]);
  expect(resolveMcpServers.mock.calls).toEqual([[{ agentPluginLayout: layout, lifecycle: installedMcp, workspaceId: 'ws', pluginId: 'preview-plugin' }]]);
});

test('discovery honors fresh activation and revision selection, but identity admission checks every revision under the lock', async () => {
  const unexpected = () => { throw new Error('unexpected port call'); };
  const makeRevision = (pluginId: string, archiveDigest: string, version?: string): InstalledAgentPlugin => ({
    pluginId, packageRoot: '/installed/' + archiveDigest, archiveDigest, files: [], skills: [], ...(version ? { version } : {}),
  });
  const old = makeRevision('agent-mail', 'old', '1.0.0');
  const chosen = makeRevision('agent-mail', 'chosen', '2.0.0');
  const ambiguousA = makeRevision('ambiguous', 'amb-a');
  const ambiguousB = makeRevision('ambiguous', 'amb-b');
  const sameA = makeRevision('same', 'same-a');
  const sameB = makeRevision('same', 'same-b');
  const broken = makeRevision('broken', 'broken');
  const installed = [old, chosen, ambiguousA, ambiguousB, sameA, sameB, broken];
  const identities: Record<string, string> = {
    old: 'retired/mail', chosen: 'publisher/mail', 'amb-a': 'one/ambiguous', 'amb-b': 'two/ambiguous', 'same-a': 'same/plugin', 'same-b': 'same/plugin',
  };
  const manifest = (id: string) => ({ extensions: { jini: { id, provides: ['cap:mail'] } } });
  let siteEnabled = true;
  let locked = false;
  const warnings: string[] = [];
  const mcpPorts = {
    classifyError: () => 'other' as const,
    projections: { accessSnapshot: unexpected, admissionRevision: unexpected, readToolGrants: unexpected,
      validateToolNames: unexpected, oauthStatus: unexpected, hasStaticAccessToken: unexpected },
  };
  const getActivation = vi.fn<PluginHostDeps<never>['getActivation']>(async ({ workspaceId, pluginId }) => {
    if (workspaceId !== 'ws' || !['site-mail', 'legacy'].includes(pluginId)) throw new Error('wrong activation lookup');
    return pluginId === 'legacy' ? null : { enabled: siteEnabled };
  });
  const preferInstalled = vi.fn<PluginHostDeps<never>['lifecycle']['preferInstalled']>(async input => {
    if (input.installed !== installed) throw new Error('not the fresh installed list');
    return [chosen, ambiguousA, ambiguousB, sameA, sameB, broken];
  });
  const isEnabled = vi.fn<PluginHostDeps<never>['lifecycle']['isEnabled']>(async ({ pluginId }) => {
    if (pluginId !== 'agent-mail') throw new Error('only the selected revision is eligible for activation read');
    return true;
  });
  const deps: PluginHostDeps<never> = {
    namespace: 'jini', workspaceId: 'ws', agentPluginLayout: createAgentPluginLayout({ root: '/plugin-host' }), clock: { nowMs: () => 0 },
    discoverPlugins: async () => [
      { id: 'site-mail', status: 'valid', version: '3.0.0', manifest: manifest('site/mail') },
      { id: 'legacy', status: 'valid', version: null, manifest: { name: 'legacy' } },
      { id: 'missing', status: 'valid', version: null },
      { id: 'malformed', status: 'valid', version: null, manifest: manifest('bad-id') },
      { id: 'untrusted', status: 'invalid', version: null, manifest: manifest('site/untrusted') },
    ], getActivation,
    lifecycle: {
      listInstalled: async () => installed, preferInstalled, isEnabled,
      readIdentity: async ({ plugin }) => {
        if (plugin === broken) throw new Error('/private/disabled/path');
        return readPluginIdentity({ manifest: manifest(identities[plugin.archiveDigest]!), namespace: 'jini', name: plugin.pluginId });
      },
      inactivePluginIds: unexpected, assertWritable: unexpected, setEnabled: unexpected, uninstall: unexpected,
    },
    installedMcp: { listInstalledPlugins: unexpected, readBundledAgentPluginDigests: unexpected, preferBundledAgentPluginDigests: unexpected, readInstalledMcpServers: unexpected },
    classifyTrust: unexpected, declinedAccessActor: 'host:declined',
    withLock: async ({ run }) => { locked = true; try { return await run(); } finally { locked = false; } },
    mcp: { ...mcpPorts, repo: { findByServerId: unexpected, updateIfVersion: unexpected, deleteByServerId: unexpected, updateAccessIfCurrent: unexpected },
      applyAccess: unexpected, saveServer: unexpected, notifyRosterChanged: unexpected },
    mcpPorts, grantSignedInDefaults: unexpected, warn: message => warnings.push(message), messages: MESSAGES,
  };
  const host = createPluginHost({ deps });
  expect(await host.findProviders({ capability: 'cap:mail' }, { enabledOnly: true })).toEqual([
    { id: 'publisher/mail', version: '2.0.0', enabled: true, family: 'agent-plugin', localId: 'agent-mail', keywords: [], provides: ['cap:mail'] },
    { id: 'site/mail', version: '3.0.0', enabled: true, family: 'site-runtime', localId: 'site-mail', keywords: [], provides: ['cap:mail'] },
  ]);
  expect(warnings).toEqual([
    "Plugin 'legacy' has no publisher-qualified id; using 'unknown/legacy'.",
    "Plugin 'missing': invalid installed manifest omitted from metadata lookup.",
    "Plugin 'malformed': installed identity manifest is unreadable or invalid; omitted from metadata lookup.",
    "Plugin 'untrusted': invalid installed manifest omitted from metadata lookup.",
    "Plugin 'broken': installed identity manifest is unreadable or invalid; omitted from metadata lookup.",
    "Plugin 'ambiguous': conflicting publisher identities; omitted from metadata lookup.",
    "Plugin 'same': ambiguous installed revisions; omitted from metadata lookup.",
  ]);
  siteEnabled = false;
  expect((await host.findProviders({ capability: 'cap:mail' }, { enabledOnly: true })).map(item => item.id)).toEqual(['publisher/mail']);
  expect(getActivation.mock.calls).toEqual(Array.from({ length: 2 }, () => [
    [{ workspaceId: 'ws', pluginId: 'site-mail' }], [{ workspaceId: 'ws', pluginId: 'legacy' }],
  ]).flat());
  expect(isEnabled.mock.calls).toEqual([[{ pluginId: 'agent-mail' }], [{ pluginId: 'agent-mail' }]]);
  expect(preferInstalled.mock.calls).toEqual([[{ installed }], [{ installed }]]);

  const run = vi.fn(async () => { if (!locked) throw new Error('install should run under the identity lock'); return 'installed'; });
  await expect(host.withInstallIdentity({ candidate: { id: 'retired/mail', family: 'site-runtime', localId: 'new-site' }, run }))
    .rejects.toThrow("Duplicate plugin id 'retired/mail'.");
  expect(run.mock.calls).toEqual([]);
  await expect(host.withInstallIdentity({ candidate: { id: 'new/mail', family: 'site-runtime', localId: 'new-site' }, run }))
    .resolves.toBe('installed');
  expect(run.mock.calls).toEqual([[]]);
  expect(preferInstalled).toHaveBeenCalledTimes(2);
  expect(getActivation).toHaveBeenCalledTimes(4);
  expect(isEnabled).toHaveBeenCalledTimes(2);
});
