import { expect, test } from 'vitest';
import { applyAgentPluginToolRenames } from '../apply-tool-renames.js';
import { grantDeclaredToolsAtBoot, grantDeclaredToolsToSignedInRows } from '../grant-signed-in-defaults.js';
import { importAgentPluginAccessTokensFromEnv } from '../import-access-token.js';
import { provisionAgentPluginMcpServers } from '../federate-mcp.js';
import { createPluginHost, type PluginHostDeps } from '../plugin-host/index.js';

const BANNED = ['boom', 'SECRETSECRET', 'boot-log-safety'];
const secretError = (): Error => new Error('boom api_key=SECRETSECRETSECRETSECRET');
function recordingLog() {
  const lines: string[] = [];
  return { lines, log: { info: (m: string) => { lines.push(m); }, warn: (m: string) => { lines.push(m); } } };
}
function expectClean(lines: readonly string[]): void {
  const text = lines.join('\n');
  for (const banned of BANNED) expect(text).not.toContain(banned);
}

test('tool renames log the error class only', async () => {
  const listFails = recordingLog();
  await applyAgentPluginToolRenames({ deps: { listPlugins: async () => { throw secretError(); } } as never, log: listFails.log });
  expect(listFails.lines).toEqual(['[agent-plugins] could not list plugins to apply tool renames: Error']);
  const rowFails = recordingLog();
  await applyAgentPluginToolRenames({ deps: {
    workspaceId: 'ws', actor: 'host:renames', notifyRosterChanged: async () => {},
    listPlugins: async () => [{ pluginId: 'p', servers: { alpha: { type: 'streamable-http', url: 'https://alpha.example/mcp', renamedTools: { a: 'b' } } } }],
    externalMcpServerRepo: { findByServerId: async () => { throw secretError(); } },
  } as never, log: rowFails.log });
  expect(rowFails.lines).toEqual(["[agent-plugins] could not apply the 'p' plugin's tool renames to 'alpha': Error"]);
  expectClean([...listFails.lines, ...rowFails.lines]);
});

test('signed-in grant warnings log the error class only', async () => {
  const boot = recordingLog();
  await grantDeclaredToolsAtBoot({ deps: { listPlugins: async () => { throw secretError(); } } as never, log: boot.log });
  expect(boot.lines).toEqual(['[agent-plugins] could not check signed-in plugin connections for their declared tools: Error']);
  const warnings: string[] = [];
  await grantDeclaredToolsToSignedInRows({
    deps: { workspaceId: 'ws', onConnected: async () => {}, warn: (m: string) => { warnings.push(m); },
      repo: { findByServerId: async () => { throw secretError(); } } } as never,
    pluginId: 'p', servers: { alpha: { type: 'streamable-http', url: 'https://alpha.example/mcp' } } as never,
  });
  expect(warnings).toEqual(["[agent-plugins] 'p': could not turn on the 'alpha' connection with the tools the plugin declares — Error"]);
  expectClean([...boot.lines, ...warnings]);
});

test('env token import logs the error class only', async () => {
  const { lines, log } = recordingLog();
  await importAgentPluginAccessTokensFromEnv({ deps: { listPlugins: async () => { throw secretError(); } } as never, env: {}, log });
  expect(lines).toEqual(['[agent-plugins] could not list plugins to import env tokens: Error']);
  expectClean(lines);
});

test('a failed provisioning write keeps its answer text; the original error goes to the reporter', async () => {
  const secret = secretError();
  const result = await provisionAgentPluginMcpServers(
    { deps: { repo: { findByServerId: async () => { throw secret; } }, saveServer: async () => {}, projections: {}, classifyError: () => 'other' } as never,
      workspaceId: 'ws', pluginId: 'p', principalId: 'u', classifyTrust: () => 'auto-admit',
      servers: { alpha: { type: 'streamable-http', url: 'https://alpha.example/mcp' } },
      messages: { sseTransportUnsupported: () => 'sse', headersUnsupported: () => 'headers' } } as never,
  );
  expect(result.failed).toHaveLength(1);
  expect(result.failed[0]).not.toHaveProperty('error');
  expect(result.failed[0]?.reason).toBe('the MCP server row could not be saved (Error)');
});

function hostWith({ warnings, provision }: { warnings: string[]; provision: () => Promise<unknown> }) {
  const deps = {
    workspaceId: 'ws', agentPluginLayout: {}, clock: { now: () => new Date(0) }, namespace: 'other-host',
    discoverPlugins: async () => [], getActivation: async () => null,
    lifecycle: { listInstalled: async () => [], preferInstalled: async ({ installed }: { installed: unknown }) => installed },
    installedMcp: {}, classifyTrust: () => 'auto-admit', declinedAccessActor: 'other-host:declined',
    withLock: ({ run }: { run: () => Promise<unknown> }) => run(),
    mcp: { repo: {}, applyAccess: async () => {}, notifyRosterChanged: async () => {} },
    mcpPorts: { projections: {}, classifyError: () => 'other' },
    grantSignedInDefaults: async () => [],
    warn: (m: string) => { warnings.push(m); },
    messages: { provisioningFailed: () => 'failed', approvedSnapshotMissing: () => 'no key', approvedLoadFailed: () => 'load failed',
      combinedGrantRejected: () => 'grant', sourceConfiguredSeparately: () => 'differs', sseTransportUnsupported: () => 'sse', headersUnsupported: () => 'headers' },
  } as unknown as PluginHostDeps<never>;
  const host = createPluginHost({ deps }, { resolveMcpServers: async () => ({}) as never, provisionMcpServers: provision as never });
  const capability = host.getHostCapability({ capability: 'agent-plugin-lifecycle' });
  if (capability === undefined) throw new Error('lifecycle capability missing');
  return capability;
}

test('plugin host provisioning warnings log the error class only', async () => {
  const warnings: string[] = [];
  const failedOnce = hostWith({ warnings, provision: async () => ({ provisioned: [], alreadyProvisioned: [], adopted: [], skipped: [],
    failed: [{ serverKey: 'alpha', reason: 'the MCP server row could not be saved (Error)' }, { serverKey: 'beta', reason: "connection id 'beta' is owned by plugin 'q'" }] }) });
  await failedOnce.provisionMcp({ pluginId: 'p', principalId: 'u' });
  const throwing = hostWith({ warnings, provision: async () => { throw secretError(); } });
  await throwing.provisionMcp({ pluginId: 'p', principalId: 'u' });
  expect(warnings).toEqual([
    "Plugin 'p': MCP provisioning for server 'alpha' failed — the MCP server row could not be saved (Error)",
    "Plugin 'p': MCP provisioning for server 'beta' failed — connection id 'beta' is owned by plugin 'q'",
    "Plugin 'p': MCP provisioning could not run — Error",
  ]);
  expectClean(warnings);
});
