import { ToolInputError } from '@jini-ai/core';
import { expect, test } from 'vitest';
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

interface HostRig { provision?: () => Promise<unknown>; grant?: () => Promise<unknown>; warnings?: string[] }

function lifecycleWith({ provision = async () => NO_FAILURES, grant = async () => [], warnings = [] }: HostRig) {
  const deps = {
    workspaceId: 'ws', agentPluginLayout: {}, clock: { now: () => new Date(0) }, namespace: 'other-host',
    discoverPlugins: async () => [], getActivation: async () => null,
    lifecycle: { listInstalled: async () => [], preferInstalled: async ({ installed }: { installed: unknown }) => installed },
    installedMcp: {}, classifyTrust: () => 'auto-admit', declinedAccessActor: 'other-host:declined',
    withLock: ({ run }: { run: () => Promise<unknown> }) => run(),
    mcp: { repo: {}, applyAccess: async () => {}, notifyRosterChanged: async () => {} },
    mcpPorts: { projections: {}, classifyError: () => 'other' },
    grantSignedInDefaults: grant, warn: (m: string) => { warnings.push(m); }, messages: MESSAGES,
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
