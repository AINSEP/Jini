/** buildPluginManagementRegistrations imported from its source module: list projection and failure
 * isolation, set-enabled for both families (pre-flights, consent card, stale approval, refusals as
 * results, rollback), and uninstall for both families. Every host port is an injected recorder. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApprovalHandler, ToolInputError, type AgentToolDefinition, type ToolExecutionContext } from '@jini-ai/core';
import { buildPluginManagementRegistrations, pluginManagementDerivedRiskFor } from '../management.js';
import { InMemoryPluginActivationRepo } from '../../repo.memory.js';
import type { PluginDiscoveryRecord } from '../../discovery-types.js';
import type { PluginManifest } from '../../manifest.js';
import type { ClassifiedPluginError, InstalledPluginRevision, PluginApprovalPort, PluginManagementToolsRequired } from '../contract.js';

const ids = { list: 'pm_list', setEnabled: 'pm_switch', uninstall: 'pm_remove' };
const WS = 'ws-1';
type Answer = { confirmed: true } | { confirmed: false; reason: 'declined' | 'expired' | 'abandoned' };
const ctx = (input: unknown, signal = new AbortController().signal): ToolExecutionContext => ({ executionId: 'call-1', principal: { id: 'human-1' }, run: { id: 'run-1' }, signal, input });
const catalog = (): AgentToolDefinition[] => [
  { name: ids.list, description: 'list', sideEffects: 'none', authorization: { permission: 'pm.read' }, inputSchema: { type: 'object' } },
  { name: ids.setEnabled, description: 'switch', sideEffects: 'mutates-durable-state', authorization: { permission: 'pm.write' }, inputSchema: { type: 'object' } },
  { name: ids.uninstall, description: 'remove', sideEffects: 'deletes-durable-state', authorization: { permission: 'pm.write' }, inputSchema: { type: 'object' } },
];
const manifest = (id: string): PluginManifest => ({ id, name: id, version: '1.0.0', sdkRange: '>=0.0.0', engine: 1, tier: 'tier-3', capabilities: ['content.read'], hooks: [], fields: [], integrity: {} });
const site = (id: string, patch: Partial<PluginDiscoveryRecord> = {}): PluginDiscoveryRecord => ({ id, name: `${id} name`, version: '1.0.0', source: 'site', status: 'valid', errors: [], manifest: manifest(id), ...patch });
const activation = (pluginId: string, enabled: boolean) => ({ pluginId, workspaceId: WS as never, version: '1.0.0', enabled, updatedAt: '2026-11-27T00:00:00.000Z' });

afterEach(() => { vi.restoreAllMocks(); });

function fixture(options: {
  discovery?: PluginDiscoveryRecord[] | (() => PluginDiscoveryRecord[]);
  rows?: ReturnType<typeof activation>[];
  installed?: InstalledPluginRevision[];
  answer?: Answer;
  fingerprints?: string[];
  agent?: Partial<PluginManagementToolsRequired<string>['agentPlugins']>;
  patch?: Partial<PluginManagementToolsRequired<string>>;
} = {}) {
  const log: unknown[] = [];
  const repo = new InMemoryPluginActivationRepo({ initialRows: options.rows ?? [] });
  const fingerprints = [...(options.fingerprints ?? [])];
  const given = options.discovery;
  const discover = (): PluginDiscoveryRecord[] => typeof given === 'function' ? given() : given ?? [];
  const approvals: PluginApprovalPort<string> = {
    handler: (steps, opts) => createApprovalHandler({
      prepare: steps.prepare,
      describe: async ({ ctx: c, prepared }) => ({ ask: opts?.ask?.({ prepared }) ?? true, description: await steps.describe({ ctx: c, prepared }) }),
      askHuman: async ({ description }) => { log.push(['ask', description]); return options.answer ?? { confirmed: true }; },
      run: ({ ctx: c, prepared, confirmer, choice }, execution) => steps.run({ ctx: c, prepared, confirmer, ...(choice === undefined ? {} : { choice }) }, execution),
      notConfirmed: ({ reason, prepared }) => opts?.declined ? opts.declined({ reason, ...(prepared === undefined ? {} : { prepared }) }) : { [opts?.flag ?? 'done']: false, reason },
    }),
    notConfirmed: ({ reason }) => ({ cancelled: reason === 'declined', note: `not confirmed: ${reason}` }),
  };
  const required: PluginManagementToolsRequired<string> = {
    registration: { domain: 'pm', catalogModule: 'pm/catalog', catalog: catalog(), metadata: {} },
    workspaceId: WS,
    authorize: async (input) => { log.push(['auth', input.permission, input.entityType ?? null, input.entityId ?? null]); return { allowed: true, reason: 'ok' }; },
    permissions: { read: 'pm.read', enable: 'pm.write' }, toolIds: ids,
    entityTypes: { plugin: 'site-pkg', agentPlugin: 'agent-pkg', activation: 'activation' }, actorPluginId: 'actor-plugin', clock: { nowMs: () => Date.parse('2026-11-27T00:00:00Z') },
    pluginActivationRepo: repo,
    discoverPlugins: async () => discover(),
    removePlugin: async (input) => { log.push(['remove', input.id, input.display]); return { ok: true, version: null }; },
    pluginSource: { readApproval: async ({ id }) => { log.push(['readApproval', id]); return []; }, recordApproval: async (input) => { log.push(['recordApproval', input]); } },
    onPluginEnabled: async (pluginId) => { log.push(['onEnabled', pluginId]); },
    onPluginDisabled: (pluginId) => { log.push(['onDisabled', pluginId]); },
    agentPlugins: {
      listInstalled: async () => options.installed ?? [],
      assertWritable: async () => {},
      setEnabled: async (input) => { log.push(['agentSet', input]); return { pluginId: input.pluginId, enabled: input.enabled, warnings: ['w1'] }; },
      provisionMcp: async (required, optional) => { log.push(['provision', required, optional]); },
      uninstall: async ({ pluginId }) => ({ removedBy: 'agent-owner', pluginId }),
      searchCandidate: ({ candidate }) => ({ pluginId: candidate.pluginId, enabled: false, description: `OFF ${candidate.pluginId}` }),
      compatibility: () => undefined,
      classifyError: () => undefined,
      ...options.agent,
    },
    providerFaces: {
      linkedProvider: async () => undefined,
      describeLinkedFace: ({ providerPluginId }) => ({ code: 'LINKED', message: `switch ${providerPluginId}`, providerPluginId }),
      describeLinkedError: () => undefined,
    },
    lowerToolAccess: async ({ pluginId }) => { log.push(['lower', pluginId]); },
    extraModelFacingErrors: [],
    executeCommand: async ({ command, mutation }) => {
      log.push(['command', command.summary, command.permission, mutation.entityType, mutation.entityId]);
      log.push(['inverse', await mutation.captureInverse()]);
      return { result: await mutation.execute() };
    },
    approvalFingerprint: ({ family, pluginId, revision }) => fingerprints.shift() ?? `fp:${family}:${pluginId}:${revision}`,
    approvals,
    descriptions: { enable: (input) => JSON.stringify(input), uninstall: ({ preview }) => `remove ${preview.pluginId}@${preview.version}` },
    messages: {
      familyRequired: 'family required', restartNote: (r) => `note ${r.family} ${r.enabled}`,
      changedSinceConfirmation: ({ pluginId, version }) => `changed ${pluginId} ${version}`,
      updatePendingNextStep: ({ code }) => `next ${code}`, hostIncompatibleNote: ({ pluginId }) => `incompatible ${pluginId}`,
      activationsUnreadableNote: ({ pluginId }) => `unreadable ${pluginId}`, activationsBusyNote: ({ pluginId }) => `busy ${pluginId}`,
    },
    telemetry: { toggled: (input) => { log.push(['toggled', input]); } },
    ...options.patch,
  };
  const registrations = buildPluginManagementRegistrations(required);
  const call = (tool: keyof typeof ids, input: unknown, signal?: AbortSignal) => registrations.find((r) => r.descriptor.id === ids[tool])!.handler(ctx(input, signal), {});
  return { log, repo, call, required };
}

describe('plugins list', () => {
  it('projects enabled site plugins as admin rows, disabled ones as OFF candidates, and both agent-plugin shapes', async () => {
    const { call, log } = fixture({
      discovery: [site('on-plugin'), site('off-plugin')], rows: [activation('on-plugin', true)],
      installed: [{ pluginId: 'g1', version: '2.0.0', archiveDigest: 'd1', skills: [{ name: 's1' }] }, { pluginId: 'g2', archiveDigest: 'd2', skills: [] }],
      agent: { inactivePluginIds: async ({ strict }) => { log.push(['inactive', strict]); return new Set(['g2']); } },
      patch: {
        listPluginConflicts: async () => new Map([['on-plugin', []]]),
        pluginExports: { catalog: async ({ workspaceId }) => { log.push(['exports', workspaceId]); return new Map([['g1', [{ plugin: 'g1', component: 'C', version: 1, minVersion: 1, props: {}, consent: 'none', availability: 'ok', snippet: null }]]]); } },
      },
    });
    const out = await call('list', {}) as { plugins: unknown[]; agentPlugins: unknown[] };
    expect(out.plugins[0]).toMatchObject({ id: 'on-plugin', name: 'on-plugin name', version: '1.0.0', source: 'site', status: 'valid', enabled: true });
    expect(out.plugins[1]).toEqual({ id: 'off-plugin', enabled: false, status: 'valid', description: 'OFF off-plugin' });
    expect(out.agentPlugins).toEqual([
      { pluginId: 'g1', version: '2.0.0', archiveDigest: 'd1', skills: ['s1'], exports: [{ plugin: 'g1', component: 'C', version: 1, minVersion: 1, props: {}, consent: 'none', availability: 'ok', snippet: null }] },
      { pluginId: 'g2', enabled: false, description: 'OFF g2' },
    ]);
    expect(log).toContainEqual(['auth', 'pm.read', null, null]);
    expect(log).toContainEqual(['inactive', false]);
    expect(log).toContainEqual(['exports', WS]);
  });

  it('keeps installed rows with empty exports when the export catalog fails, and a null version for unversioned copies', async () => {
    const { call } = fixture({
      installed: [{ pluginId: 'g1', archiveDigest: 'd1', skills: [] }],
      patch: { pluginExports: { catalog: async () => { throw new Error('catalog down'); } } },
    });
    expect(await call('list', {})).toEqual({ plugins: [], agentPlugins: [{ pluginId: 'g1', version: null, archiveDigest: 'd1', skills: [], exports: [] }] });
  });

  it('empties only the agent-plugin half when its index fails', async () => {
    const { call } = fixture({ discovery: [site('off-plugin')], agent: { listInstalled: async () => { throw new Error('index broken'); } } });
    expect(await call('list', {})).toEqual({ plugins: [{ id: 'off-plugin', enabled: false, status: 'valid', description: 'OFF off-plugin' }], agentPlugins: [] });
  });

  it('refuses list input', async () => {
    const { call } = fixture();
    await expect(call('list', { anything: true })).rejects.toBeInstanceOf(ToolInputError);
  });
});

describe('set-enabled input', () => {
  it('names the family choice and the boolean requirement as input errors', async () => {
    const { call, log } = fixture();
    await expect(call('setEnabled', { pluginId: 'p', enabled: true })).rejects.toThrow(new ToolInputError({ message: 'family required' }));
    await expect(call('setEnabled', { family: 'site', pluginId: 'p', enabled: true })).rejects.toThrow('family required');
    await expect(call('setEnabled', { family: 'site-runtime', pluginId: 'p', enabled: 'yes' })).rejects.toThrow("'enabled' (boolean) is required — true to turn the plugin on, false to turn it off");
    expect(log).toEqual([]);
  });
});

describe('site-runtime set-enabled', () => {
  it('asks with the consent card, records the approved capabilities, writes through the gateway and reports a toggle', async () => {
    const { call, log, repo } = fixture({ discovery: [site('tally')] });
    const out = await call('setEnabled', { family: 'site-runtime', pluginId: 'tally', enabled: true });
    expect(out).toMatchObject({ changed: true, cancelled: false, family: 'site-runtime', plugin: { id: 'tally', enabled: true }, restartRequired: true, note: 'note site-runtime true' });
    const ask = log.find((entry) => (entry as unknown[])[0] === 'ask') as [string, string];
    expect(JSON.parse(ask[1])).toEqual({
      subject: { family: 'site-runtime', pluginId: 'tally', version: '1.0.0', label: 'tally name', adds: ['capability:content.read', 'tier:tier-3'], previousEnabled: false, revision: 'fp:site-runtime:tally:1.0.0' },
      scope: { personId: 'human-1', siteId: WS },
    });
    expect(log).toContainEqual(['auth', 'pm.write', 'site-pkg', 'tally']);
    expect(log).toContainEqual(['recordApproval', { id: 'tally', capabilities: ['capability:content.read', 'tier:tier-3'] }]);
    expect(log).toContainEqual(['command', "Agent set plugin 'tally' enabled=true", 'pm.write', 'activation', 'tally']);
    expect(log).toContainEqual(['inverse', { enabled: false }]);
    expect(log).toContainEqual(['onEnabled', 'tally']);
    expect(log).toContainEqual(['toggled', { principalId: 'human-1', pluginId: 'tally', enabled: true }]);
    expect((await repo.getActivation({ workspaceId: WS, pluginId: 'tally' }))?.enabled).toBe(true);
  });

  it('writes nothing when the human declines and reports the family and plugin', async () => {
    const { call, log, repo } = fixture({ discovery: [site('tally')], answer: { confirmed: false, reason: 'declined' } });
    expect(await call('setEnabled', { family: 'site-runtime', pluginId: 'tally', enabled: true })).toEqual({
      changed: false, family: 'site-runtime', pluginId: 'tally', restartRequired: false, cancelled: true, note: 'not confirmed: declined',
    });
    expect(log.some((entry) => (entry as unknown[])[0] === 'command')).toBe(false);
    expect(await repo.getActivation({ workspaceId: WS, pluginId: 'tally' })).toBeNull();
  });

  it('refuses a stale approval when the fingerprint changed while the human was asked', async () => {
    const { call, log } = fixture({ discovery: [site('tally')], fingerprints: ['first', 'second'] });
    await expect(call('setEnabled', { family: 'site-runtime', pluginId: 'tally', enabled: true })).rejects.toThrow(
      'PLUGINS_STALE_APPROVAL: The plugin or its connection changed. Review and approve it again. Nothing was changed.',
    );
    expect(log.some((entry) => (entry as unknown[])[0] === 'command')).toBe(false);
  });

  it('refuses a plugin absent from discovery before asking', async () => {
    const { call, log } = fixture({ discovery: [site('other')] });
    await expect(call('setEnabled', { family: 'site-runtime', pluginId: 'ghost', enabled: true })).rejects.toThrow(
      new ToolInputError({ message: "plugin 'ghost' was not found in the current discovery snapshot" }),
    );
    expect(log.some((entry) => (entry as unknown[])[0] === 'ask')).toBe(false);
  });

  it('disables without asking, lowers tool access and needs no restart; an unchanged state emits no toggle', async () => {
    const { call, log } = fixture({ discovery: [site('tally')], rows: [activation('tally', true)] });
    expect(await call('setEnabled', { family: 'site-runtime', pluginId: 'tally', enabled: false })).toMatchObject({ changed: true, restartRequired: false, plugin: { enabled: false } });
    expect(log.some((entry) => (entry as unknown[])[0] === 'ask')).toBe(false);
    expect(log).toContainEqual(['lower', 'tally']);
    expect(log).toContainEqual(['toggled', { principalId: 'human-1', pluginId: 'tally', enabled: false }]);
    const again = fixture({ discovery: [site('tally')], rows: [activation('tally', false)] });
    await again.call('setEnabled', { family: 'site-runtime', pluginId: 'tally', enabled: false });
    expect(again.log.some((entry) => (entry as unknown[])[0] === 'toggled')).toBe(false);
  });

  it('a gateway rollback restores the exact prior row and its hooks, or removes a row that did not exist', async () => {
    const rollbackGateway = (log: unknown[]): PluginManagementToolsRequired<string>['executeCommand'] => async ({ mutation }) => {
      await mutation.captureInverse();
      await mutation.execute();
      // A gateway whose commit fails after the write runs the inverse and reports the failure.
      await mutation.rollback();
      log.push('rolled-back');
      throw new Error('commit failed');
    };
    const hooks = (log: unknown[]) => log.filter((entry) => entry === 'rolled-back' || ['onEnabled', 'onDisabled', 'lower', 'toggled'].includes((entry as unknown[])[0] as string));
    const prior = fixture({ discovery: [site('tally')], rows: [activation('tally', true)] });
    const withPrior = buildPluginManagementRegistrations({ ...prior.required, executeCommand: rollbackGateway(prior.log) }).find((r) => r.descriptor.id === ids.setEnabled)!;
    await expect(withPrior.handler(ctx({ family: 'site-runtime', pluginId: 'tally', enabled: false }), {})).rejects.toThrow();
    expect(await prior.repo.getActivation({ workspaceId: WS, pluginId: 'tally' })).toEqual(activation('tally', true));
    expect(hooks(prior.log)).toEqual([['onDisabled', 'tally'], ['onEnabled', 'tally'], 'rolled-back']);

    const fresh = fixture({ discovery: [site('tally')] });
    const withoutPrior = buildPluginManagementRegistrations({ ...fresh.required, executeCommand: rollbackGateway(fresh.log) }).find((r) => r.descriptor.id === ids.setEnabled)!;
    await expect(withoutPrior.handler(ctx({ family: 'site-runtime', pluginId: 'tally', enabled: true }), {})).rejects.toThrow();
    expect(await fresh.repo.getActivation({ workspaceId: WS, pluginId: 'tally' })).toBeNull();
    expect(hooks(fresh.log)).toEqual([['onEnabled', 'tally'], ['onDisabled', 'tally'], 'rolled-back']);
  });

  it('returns abandoned without writing when the call is cancelled after the human confirmed', async () => {
    const abort = new AbortController();
    const { call, log } = fixture({ discovery: [site('tally')], patch: { pluginSource: { readApproval: async () => [], recordApproval: async () => { throw new Error('must not record'); } } } });
    // The recorder answers, then the run is cancelled before the write.
    log.push = ((original) => function (this: unknown[], ...items: unknown[]) { if ((items[0] as unknown[])?.[0] === 'ask') abort.abort(); return original.apply(this, items); })(log.push);
    const out = await call('setEnabled', { family: 'site-runtime', pluginId: 'tally', enabled: true }, abort.signal);
    expect(out).toMatchObject({ changed: false });
    expect(log.some((entry) => (entry as unknown[])[0] === 'command')).toBe(false);
  });
});

describe('agent-plugin set-enabled', () => {
  const installed: InstalledPluginRevision[] = [{ pluginId: 'guide', version: '1.0.0', archiveDigest: 'dg', skills: [] }];

  it('enables after consent, provisions MCP with the approved access key, and names the selected copy', async () => {
    const { call, log } = fixture({
      installed,
      agent: {
        previewEnableAccess: async () => ({ key: 'access-1', resources: [{ kind: 'mcp', id: 'srv' }] as never }),
        inactivePluginIds: async ({ strict }) => { log.push(['inactive', strict]); return new Set(['guide']); },
      },
    });
    expect(await call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: true })).toEqual({
      changed: true, cancelled: false, family: 'agent-plugin', agentPlugin: { pluginId: 'guide', enabled: true }, warnings: ['w1'], restartRequired: false, note: 'note agent-plugin true',
    });
    const ask = log.find((entry) => (entry as unknown[])[0] === 'ask') as [string, string];
    expect(JSON.parse(ask[1]).subject).toEqual({
      family: 'agent-plugin', pluginId: 'guide', version: '1.0.0', label: 'guide', adds: [], previousEnabled: false,
      revision: `fp:agent-plugin:guide:${JSON.stringify([JSON.stringify([['1.0.0', 'dg']]), 'access-1'])}`, resources: [{ kind: 'mcp', id: 'srv' }],
    });
    expect(log).toContainEqual(['inactive', true]);
    expect(log).toContainEqual(['auth', 'pm.write', 'agent-pkg', 'guide']);
    expect(log).toContainEqual(['agentSet', { workspaceId: WS, pluginId: 'guide', enabled: true, actor: 'human-1' }]);
    expect(log).toContainEqual(['provision', { pluginId: 'guide', principalId: 'human-1' }, { approvedEnable: true, approvedEnableKey: 'access-1' }]);
  });

  it('records a declined access answer only for a real decline with an access key', async () => {
    const declined: string[] = [];
    const { call } = fixture({ installed, answer: { confirmed: false, reason: 'declined' }, agent: {
      previewEnableAccess: async () => ({ key: 'access-1' }), recordDeclinedAccess: async ({ accessKey }) => { declined.push(accessKey); },
    } });
    expect(await call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: true })).toMatchObject({ changed: false, family: 'agent-plugin', pluginId: 'guide' });
    expect(declined).toEqual(['access-1']);
    const expired = fixture({ installed, answer: { confirmed: false, reason: 'expired' }, agent: {
      previewEnableAccess: async () => ({ key: 'access-1' }), recordDeclinedAccess: async ({ accessKey }) => { declined.push(accessKey); },
    } });
    await expired.call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: true });
    expect(declined).toEqual(['access-1']);
  });

  it('refuses an uninstalled agent plugin as an input error', async () => {
    const { call } = fixture({ installed: [] });
    await expect(call('setEnabled', { family: 'agent-plugin', pluginId: 'nope', enabled: true })).rejects.toThrow("Agent Plugin 'nope' is not installed");
  });

  it.each([
    ['unreadable', { kind: 'unreadable', message: 'bad json at /private/path' }, { reason: 'activations-unreadable', note: 'unreadable guide' }],
    ['busy', { kind: 'busy', message: 'lock held at /private/lock' }, { reason: 'activations-busy', note: 'busy guide' }],
    ['update', { kind: 'update', code: 'PLUGIN_UPDATE_PENDING' }, { reason: 'update-pending', code: 'PLUGIN_UPDATE_PENDING', note: "Nothing changed: an interrupted update of 'guide' is still waiting to be recovered, so it was NOT enabled. next PLUGIN_UPDATE_PENDING" }],
    ['host-incompatible', { kind: 'host-incompatible', code: 'HOST' }, { reason: 'host-incompatible', code: 'HOST', note: 'incompatible guide' }],
  ] as const)('pre-flight: an unwritable activation record (%s) is a not-changed result before any dialog', async (_label, classified, expected) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { call, log } = fixture({ installed, agent: { assertWritable: async () => { throw new Error('x'); }, classifyError: () => classified as ClassifiedPluginError } });
    expect(await call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: true })).toEqual({
      changed: false, cancelled: false, family: 'agent-plugin', pluginId: 'guide', restartRequired: false, ...expected,
    });
    expect(log.some((entry) => (entry as unknown[])[0] === 'ask')).toBe(false);
    if (classified.kind === 'unreadable' || classified.kind === 'busy') {
      expect(warn).toHaveBeenCalledWith(`[agent-plugins] 'guide': pm_switch refused — ${classified.message}`);
    }
  });

  it('pre-flight: an unclassified write-check failure propagates unchanged', async () => {
    const crash = new Error('disk');
    const { call } = fixture({ installed, agent: { assertWritable: async () => { throw crash; } } });
    await expect(call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: true })).rejects.toThrow(/disk|INTERNAL/);
  });

  it('pre-flight: a linked assistant face and an incompatible host are refused before the dialog', async () => {
    const linked = fixture({ installed, patch: { providerFaces: { linkedProvider: async () => 'prov-a', describeLinkedFace: ({ providerPluginId }) => ({ code: 'LINKED', message: `switch ${providerPluginId}`, providerPluginId }), describeLinkedError: () => undefined } } });
    expect(await linked.call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: true })).toEqual({
      changed: false, cancelled: false, family: 'agent-plugin', pluginId: 'guide', restartRequired: false, reason: 'linked', code: 'LINKED', providerPluginId: 'prov-a', note: 'Nothing changed. switch prov-a',
    });
    const unreadableLink = fixture({ installed, patch: { providerFaces: { linkedProvider: async () => { throw new Error('manifest'); }, describeLinkedFace: () => { throw new Error('unused'); }, describeLinkedError: () => undefined } } });
    expect(await unreadableLink.call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: true })).toMatchObject({ changed: true });
    const incompatible = fixture({ installed, agent: { compatibility: ({ revisions }) => revisions.length === 1 ? { code: 'RANGE' } : undefined } });
    expect(await incompatible.call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: true })).toMatchObject({ reason: 'host-incompatible', code: 'RANGE', note: 'incompatible guide' });
  });

  it('maps write failures: not-installed to an input error, a linked face to a result, update to a result, others rethrown', async () => {
    const failing = (patch: Parameters<typeof fixture>[0]) => fixture({ installed, ...patch, agent: { setEnabled: async () => { throw new Error('write failed'); }, ...patch?.agent } });
    const notInstalled = failing({ agent: { classifyError: () => ({ kind: 'not-installed', message: "no 'guide' here" }) } });
    await expect(notInstalled.call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: false })).rejects.toThrow("no 'guide' here");
    const linked = failing({ patch: { providerFaces: { linkedProvider: async () => undefined, describeLinkedFace: () => { throw new Error('unused'); }, describeLinkedError: () => ({ code: 'LINKED', message: 'use prov-b', providerPluginId: 'prov-b' }) } } });
    expect(await linked.call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: false })).toMatchObject({ reason: 'linked', providerPluginId: 'prov-b', note: 'Nothing changed. use prov-b' });
    const update = failing({ agent: { classifyError: () => ({ kind: 'update', code: 'PLUGIN_UPDATE_JOURNAL' }) } });
    expect(await update.call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: false })).toMatchObject({
      reason: 'update-pending', note: "Nothing changed: an interrupted update of 'guide' is still waiting to be recovered, so it was NOT disabled. next PLUGIN_UPDATE_JOURNAL",
    });
    const unknown = failing({});
    await expect(unknown.call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: false })).rejects.toThrow();
  });

  it('disables without provisioning and reports a null previous state when the owner cannot say', async () => {
    const { call, log } = fixture({ installed });
    expect(await call('setEnabled', { family: 'agent-plugin', pluginId: 'guide', enabled: false })).toMatchObject({ changed: true, agentPlugin: { enabled: false } });
    expect(log.some((entry) => (entry as unknown[])[0] === 'provision')).toBe(false);
    expect(log.some((entry) => (entry as unknown[])[0] === 'ask')).toBe(false);
  });
});

describe('uninstall', () => {
  it('delegates an agent plugin uninstall to its lifecycle owner with the call context', async () => {
    const { call } = fixture();
    expect(await call('uninstall', { family: 'agent-plugin', pluginId: 'guide' })).toEqual({ removedBy: 'agent-owner', pluginId: 'guide' });
  });

  it('previews, asks, re-authorizes and moves a site plugin to the Trash', async () => {
    const { call, log } = fixture({ discovery: [site('tally')] });
    expect(await call('uninstall', { family: 'site-runtime', pluginId: 'tally' })).toEqual({ pluginId: 'tally', trashed: true });
    expect(log.filter((entry) => ['auth', 'ask', 'remove'].includes((entry as unknown[])[0] as string))).toEqual([
      ['auth', 'pm.write', 'site-pkg', 'tally'], ['ask', 'remove tally@1.0.0'], ['auth', 'pm.write', 'site-pkg', 'tally'],
      ['remove', 'tally', { title: 'tally name', subtitle: 'tally 1.0.0' }],
    ]);
  });

  it('removes nothing when declined', async () => {
    const { call, log } = fixture({ discovery: [site('tally')], answer: { confirmed: false, reason: 'declined' } });
    expect(await call('uninstall', { family: 'site-runtime', pluginId: 'tally' })).toEqual({ pluginId: 'tally', uninstalled: false, cancelled: true, note: 'not confirmed: declined' });
    expect(log.some((entry) => (entry as unknown[])[0] === 'remove')).toBe(false);
  });

  it('reports a version change between the dialog and the write as not removed', async () => {
    let reads = 0;
    const { call, log } = fixture({ discovery: () => [site('tally', { version: reads++ === 0 ? '1.0.0' : '2.0.0' })] });
    expect(await call('uninstall', { family: 'site-runtime', pluginId: 'tally' })).toEqual({
      pluginId: 'tally', uninstalled: false, cancelled: false, reason: 'changed-since-confirmation', note: 'changed tally 1.0.0',
    });
    expect(log.some((entry) => (entry as unknown[])[0] === 'remove')).toBe(false);
  });

  it('refuses a built-in before any dialog, and requires a family', async () => {
    const { call, log } = fixture({ discovery: [site('core-thing', { source: 'built-in' })] });
    await expect(call('uninstall', { family: 'site-runtime', pluginId: 'core-thing' })).rejects.toThrow();
    expect(log.some((entry) => (entry as unknown[])[0] === 'ask')).toBe(false);
    await expect(call('uninstall', { pluginId: 'core-thing' })).rejects.toThrow('family required');
  });
});

it('derives read-only, durable-write and deletion risk per tool id', () => {
  expect(Object.fromEntries(pluginManagementDerivedRiskFor({ toolIds: ids }))).toEqual({ pm_list: 'none', pm_switch: 'mutates-durable-state', pm_remove: 'deletes-durable-state' });
});
