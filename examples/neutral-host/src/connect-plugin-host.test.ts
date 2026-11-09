/** A9: a second host wires the moved plugin host (`@jini-ai/agent-plugins/connect/plugin-host`) with
 * in-memory ports only — its own namespace, actor ids, paths and copy, no Tovu env — and the real
 * moved provisioning/federation bodies. Pins the grant-port order: resolve → provision → failure
 * warning → grant (failed servers skipped), and that every product string comes from host input. */
import { expect, it } from 'vitest';
import { createPluginHost, type PluginHostDeps } from '@jini-ai/agent-plugins/connect/plugin-host';
import { planAgentPluginMcpFederation } from '@jini-ai/agent-plugins/connect';

type Step = { step: string; detail?: unknown };

function acmeHost(steps: Step[]) {
  const servers = { alpha: { type: 'http', url: 'https://alpha.acme.test/mcp' }, beta: { type: 'http', url: 'https://beta.acme.test/mcp' } } as const;
  let saves = 0;
  const projections = {
    accessSnapshot: () => ({}) as never, admissionRevision: () => 'rev', readToolGrants: () => ({ allowedToolNames: [], writeAllowedToolNames: [] }),
    validateToolNames: ({ names }: { names: readonly string[] }) => [...names], oauthStatus: () => 'disconnected' as const, hasStaticAccessToken: () => false,
  };
  const applied: unknown[] = [];
  const mcp = {
    repo: { findByServerId: async () => null, upsert: async () => { throw new Error('unused'); }, deleteByServerId: async () => {}, updateAccessIfCurrent: async () => true },
    applyAccess: async (input: unknown) => { applied.push(input); },
    saveServer: async (input: unknown) => { saves += 1; steps.push({ step: 'save', detail: input }); if (saves === 2) throw new Error('acme store full'); return {} as never; },
    classifyError: () => 'other' as const,
    notifyRosterChanged: async () => { steps.push({ step: 'notify' }); },
    projections,
  } as unknown as PluginHostDeps<never>['mcp'];
  const deps: PluginHostDeps<never> = {
    workspaceId: 'acme-ws', agentPluginLayout: { forWorkspace: (id: string) => ({ root: `/srv/acme/${id}` }) }, clock: { now: () => new Date(0) } as never,
    namespace: 'acme',
    discoverPlugins: async () => [], getActivation: async () => null,
    lifecycle: {
      listInstalled: async () => [], preferInstalled: async ({ installed }) => installed, readIdentity: async () => { throw new Error('unused'); },
      isEnabled: async () => true, inactivePluginIds: async () => new Set(), assertWritable: async () => {}, setEnabled: async () => { throw new Error('unused'); }, uninstall: async () => undefined,
    },
    installedMcp: {
      listInstalledPlugins: async ({ workspaceRoot }) => { steps.push({ step: 'resolve', detail: workspaceRoot }); return [{ pluginId: 'weather', packageRoot: '/srv/acme/pkgs/weather', archiveDigest: 'd1' }] as never; },
      readBundledAgentPluginDigests: async () => new Map() as never,
      preferBundledAgentPluginDigests: ({ installed }) => installed as never,
      readInstalledMcpServers: async () => servers as never,
    },
    classifyTrust: () => 'auto-admit', declinedAccessActor: 'acme:declined',
    withLock: ({ run }) => run(), mcp, mcpPorts: { projections, classifyError: () => 'other' },
    grantSignedInDefaults: async (required, optional) => { steps.push({ step: 'grant', detail: { required, optional } }); return []; },
    warn: message => steps.push({ step: 'warn', detail: message }),
    messages: {
      provisioningFailed: ({ pluginId }) => `acme: ${pluginId} failed`, approvedSnapshotMissing: () => 'acme: no key', approvedLoadFailed: ({ detail }) => `acme: ${detail}`,
      sourceConfiguredSeparately: ({ connectionId }) => `acme: ${connectionId} differs`,
      sseTransportUnsupported: () => 'acme: sse unsupported', headersUnsupported: () => 'acme: headers unsupported',
    },
  };
  return { host: createPluginHost({ deps }), applied };
}

it('moved plugin host provisions with the real bodies, warns, then grants with the failed server skipped', async () => {
  const steps: Step[] = [];
  const { host } = acmeHost(steps);
  const capability = host.getHostCapability({ capability: 'agent-plugin-lifecycle' })!;
  await capability.provisionMcp({ pluginId: 'weather', principalId: 'acme-user' });
  expect(steps.map(entry => entry.step)).toEqual(['resolve', 'save', 'save', 'notify', 'warn', 'grant']);
  expect(steps[0]!.detail).toBe('/srv/acme/acme-ws');
  const grant = steps.at(-1)!.detail as { required: { pluginId: string; deps: { workspaceId: string } }; optional: Record<string, unknown> };
  expect(grant.required.pluginId).toBe('weather');
  expect(grant.required.deps.workspaceId).toBe('acme-ws');
  expect(grant.optional).toEqual({ skipServerKeys: ['beta'] });
  expect(String(steps[4]!.detail)).toContain('acme store full');
  expect(JSON.stringify(steps)).not.toMatch(/tovu|Tovu|plugins_set_enabled|system:/);
});

it('declined access is attributed to the host actor, and skip reasons are the host copy', async () => {
  const steps: Step[] = [];
  const { host, applied } = acmeHost(steps);
  const capability = host.getHostCapability({ capability: 'agent-plugin-lifecycle' })!;
  const accessKey = JSON.stringify([{ connectionId: 'c1', grant: { enabled: true, allow: [], write: [] }, expected: { writeGrantsUpdatedByPrincipalId: null }, current: { enabled: false, allow: [], write: [] } }]);
  await capability.recordDeclinedAccess({ accessKey });
  expect(applied).toMatchObject([{ workspaceId: 'acme-ws', serverId: 'c1', principalId: 'acme:declined' }]);
  const plan = planAgentPluginMcpFederation({ servers: { old: { type: 'sse', url: 'https://old.acme.test' } as never } }, {
    classifyTrust: () => 'auto-admit', messages: { sseTransportUnsupported: () => 'acme: sse unsupported', headersUnsupported: () => 'acme: headers unsupported' },
  });
  expect(plan.skipped).toEqual([{ serverKey: 'old', reason: 'acme: sse unsupported' }]);
});
