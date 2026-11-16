/**
 * @file Public-behaviour tests for `buildPluginManagementRegistrations`: list projection and
 * failure isolation, the set-enabled preflight/approval/write pipeline for both families, and
 * the uninstall flows. Ports are plain fakes passed as arguments.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolInputError, type AgentToolDefinition, type ToolExecutionContext, type ToolRegistration } from '@jini-ai/core';
import { buildPluginManagementRegistrations, pluginApprovalIdentity, pluginManagementDerivedRiskFor } from '../management.js';
import { PluginConflictError } from '../../plugin-claims.js';
import type { PluginActivationRecord } from '../../activation.js';
import type { PluginDiscoveryRecord } from '../../discovery-types.js';
import type { PluginApprovalPort, PluginManagementToolsRequired, InstalledPluginRevision } from '../contract.js';

const toolIds = { list: 'pl_list', setEnabled: 'pl_set', uninstall: 'pl_uninstall' };
const risk = pluginManagementDerivedRiskFor({ toolIds });
const catalog: AgentToolDefinition[] = Object.values(toolIds).map(name => ({
  name, description: name, sideEffects: risk.get(name)!, authorization: { permission: `perm.${name}` }, inputSchema: { type: 'object' },
}));
const WS = 'ws1';

const manifest = (over: Record<string, unknown> = {}) => ({ id: 'site-a', name: 'Site A', version: '1.0.0', sdkRange: '*', engine: 1, tier: 'tier-3',
  capabilities: ['tools.register'], hooks: [], fields: [], integrity: {}, ...over });
const record = (over: Partial<PluginDiscoveryRecord> = {}): PluginDiscoveryRecord => ({
  id: 'site-a', name: 'Site A', version: '1.0.0', source: 'site', tier: 'tier-3', status: 'valid', errors: [], manifest: manifest() as never, ...over,
});
const rev = (over: Partial<InstalledPluginRevision> = {}): InstalledPluginRevision => ({ pluginId: 'ap1', version: '2.0.0', archiveDigest: 'dg-a', skills: [{ name: 'skill-1' }], ...over });

function ctx(input: unknown, over: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return { executionId: 'e1', principal: { id: 'p1' }, run: { id: 'r1' }, input, signal: new AbortController().signal, ...over } as ToolExecutionContext;
}

type Answer = 'yes' | 'declined' | 'expired' | 'abandoned';
interface Opts { answer: Answer; ask: boolean[]; alwaysDescribe?: boolean }

function setup(over: Partial<PluginManagementToolsRequired<string>> = {}, state: { discovery?: PluginDiscoveryRecord[] } = {}) {
  const rows = new Map<string, PluginActivationRecord>();
  const repo = {
    getActivation: vi.fn(async ({ pluginId }: { pluginId: string }) => rows.get(pluginId) ?? null),
    save: vi.fn(async (r: PluginActivationRecord) => { rows.set(r.pluginId, r); }),
    deleteActivation: vi.fn(async ({ pluginId }: { pluginId: string }) => { rows.delete(pluginId); }),
    listAll: vi.fn(async () => [...rows.values()]),
  };
  let discovery = state.discovery ?? [record()];
  const opts: Opts = { answer: 'yes', ask: [] };
  const approvals: PluginApprovalPort<string> = {
    handler: ((steps: any, options: any = {}) => async (c: ToolExecutionContext, o: never) => {
      const prepared = await steps.prepare({ ctx: c }, o);
      const wantsAsk = options.ask ? options.ask({ prepared }) : true;
      opts.ask.push(wantsAsk);
      let desc: unknown;
      if (!wantsAsk && opts.alwaysDescribe) desc = await steps.describe({ ctx: c, prepared });
      if (wantsAsk) {
        desc = await steps.describe({ ctx: c, prepared });
        if (opts.answer !== 'yes') {
          const declined = options.declined?.({ reason: opts.answer, prepared });
          return { desc, declined: await declined };
        }
      }
      return { desc, out: await steps.run({ ctx: c, prepared, confirmer: {} }, o) };
    }) as never,
    notConfirmed: (outcome: { reason: string }) => ({ cancelled: true, note: `not-confirmed:${outcome.reason}`, reason: outcome.reason }) as never,
  };
  const agentPlugins = {
    inactivePluginIds: vi.fn(async () => new Set<string>()),
    previewEnableAccess: vi.fn(async () => undefined),
    recordDeclinedAccess: vi.fn(async () => {}),
    listInstalled: vi.fn(async () => [rev()]),
    preferInstalled: undefined as undefined | ((r: { installed: readonly InstalledPluginRevision[] }) => Promise<readonly InstalledPluginRevision[]>),
    assertWritable: vi.fn(async () => {}),
    setEnabled: vi.fn(async ({ pluginId, enabled }: { pluginId: string; enabled: boolean }) => ({ pluginId, enabled })),
    provisionMcp: vi.fn(async () => {}),
    uninstall: vi.fn(async () => ({ agent: 'uninstalled' })),
    searchCandidate: vi.fn(({ candidate }: { candidate: { pluginId: string; enabled: boolean; description?: string } }) => ({ pluginId: candidate.pluginId, enabled: candidate.enabled, description: `visible:${candidate.pluginId}` })),
    compatibility: vi.fn((): { code: string } | undefined => undefined),
    classifyError: vi.fn((): any => undefined),
  };
  const providerFaces = {
    linkedProvider: vi.fn(async (): Promise<string | undefined> => undefined),
    describeLinkedFace: vi.fn(({ providerPluginId }: { providerPluginId: string }) => ({ code: 'LINKED', message: 'switch the provider', providerPluginId })),
    describeLinkedError: vi.fn((): any => undefined),
  };
  const authorize = vi.fn(async () => ({ allowed: true as const }));
  const removePlugin = vi.fn(async () => ({ ok: true as const }));
  const deps: PluginManagementToolsRequired<string> = {
    registration: { domain: 'plugins', catalogModule: 'catalog.ts', catalog, metadata: {} },
    workspaceId: WS, authorize: authorize as never, permissions: { read: 'perm.read', enable: 'perm.enable' }, toolIds,
    entityTypes: { plugin: 'plugin', agentPlugin: 'agent_plugin', activation: 'activation' }, actorPluginId: 'actor-plugin',
    clock: { nowMs: () => Date.parse('2030-01-01T00:00:00.000Z') } as never,
    pluginActivationRepo: repo as never, discoverPlugins: vi.fn(async () => discovery) as never,
    removePlugin: removePlugin as never, onPluginEnabled: vi.fn(async () => {}), onPluginDisabled: vi.fn(),
    agentPlugins: agentPlugins as never, providerFaces: providerFaces as never,
    lowerToolAccess: vi.fn(async () => {}), extraModelFacingErrors: [],
    executeCommand: vi.fn(async ({ mutation }: any) => { await mutation.captureInverse(); return { result: await mutation.execute() }; }) as never,
    approvalFingerprint: vi.fn(({ family, pluginId, revision, schema }: any) => `fp:${family}:${pluginId}:${revision}:${Object.keys(schema).length}`),
    approvals,
    descriptions: { enable: ({ subject, scope }: any) => `enable ${JSON.stringify({ subject, scope })}`, uninstall: ({ preview }: any) => `uninstall ${preview.pluginId}` } as never,
    messages: {
      familyRequired: 'family is required', restartNote: ({ pluginId, enabled }: any) => `restart:${pluginId}:${enabled}`,
      changedSinceConfirmation: ({ pluginId, name, version }: any) => `changed:${pluginId}:${name}:${version}`,
      updatePendingNextStep: ({ code }: any) => `next:${code}`, hostIncompatibleNote: ({ pluginId }: any) => `incompatible:${pluginId}`,
      activationsUnreadableNote: ({ pluginId }: any) => `unreadable:${pluginId}`, activationsBusyNote: ({ pluginId }: any) => `busy:${pluginId}`,
    },
    ...over,
  };
  const regs = buildPluginManagementRegistrations(deps);
  const by = (id: string): ToolRegistration => regs.find(r => r.descriptor.id === id)!;
  return { deps, rows, repo, opts, agentPlugins, providerFaces, authorize, removePlugin, by, setDiscovery: (d: PluginDiscoveryRecord[]) => { discovery = d; } };
}

afterEach(() => vi.restoreAllMocks());

describe('registration and risk', () => {
  it('registers the three tools with derived risk classes', () => {
    const { by } = setup();
    expect(by('pl_list').descriptor.sideEffects).toBe(risk.get('pl_list'));
    expect(risk.get('pl_list')).toBe('none');
    expect(risk.get('pl_set')).toBe('mutates-durable-state');
    expect(risk.get('pl_uninstall')).toBe('deletes-durable-state');
  });

  it('reclassifies a PluginConflictError into the model-facing PLUGINS_CONFLICT code', async () => {
    const conflict = { kind: 'tool', key: 'echo', heldBy: 'other', heldByName: 'Other', heldKey: 'echo' };
    const { by, rows } = setup({ onPluginEnabled: async () => { throw new PluginConflictError({ pluginId: 'site-a', conflicts: [conflict] }); } } as never);
    const error = await by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolInputError);
    expect((error as Error).message).toMatch(/^PLUGINS_CONFLICT: Plugin 'site-a' was not turned on because it claims things already in use/);
    expect((error as Error).message).toContain('Tell the user which plugin holds the name');
    expect(rows.has('site-a')).toBe(false);
  });
});

describe('list tool', () => {
  it('projects enabled records fully and disabled ones through the visibility filter, plus agent rows', async () => {
    const t = setup({}, { discovery: [record(), record({ id: 'site-b', name: 'Site B' })] });
    t.rows.set('site-a', { pluginId: 'site-a', workspaceId: WS, version: '1.0.0', enabled: true, updatedAt: 'x' });
    const out = await t.by('pl_list').handler(ctx({})) as any;
    expect(out.plugins[0]).toMatchObject({ id: 'site-a', enabled: true, status: 'valid', source: 'site', conflicts: [] });
    expect(out.plugins[1]).toEqual({ id: 'site-b', enabled: false, status: 'valid', description: 'visible:site-b' });
    expect(out.agentPlugins).toEqual([{ pluginId: 'ap1', version: '2.0.0', archiveDigest: 'dg-a', skills: ['skill-1'], exports: [] }]);
  });

  it('attaches host-reported conflicts to an enabled plugin', async () => {
    const conflict = { kind: 'tool', name: 'x', heldBy: 'other' } as never;
    const t = setup({ listPluginConflicts: async () => new Map([['site-a', [conflict]]]) });
    t.rows.set('site-a', { pluginId: 'site-a', workspaceId: WS, version: '1.0.0', enabled: true, updatedAt: 'x' });
    const out = await t.by('pl_list').handler(ctx({})) as any;
    expect(out.plugins[0].conflicts).toEqual([conflict]);
  });

  it('rejects any input and denied principals', async () => {
    const t = setup();
    await expect(t.by('pl_list').handler(ctx({ unexpected: 1 }))).rejects.toBeInstanceOf(ToolInputError);
    const denied = setup({ authorize: (async () => ({ allowed: false, reason: 'nope' })) as never });
    await expect(denied.by('pl_list').handler(ctx({}))).rejects.toThrow("not authorized for 'perm.read'");
  });

  it('shows inactive agent plugins through the visibility filter and attaches public exports', async () => {
    const t = setup({ pluginExports: { catalog: async () => new Map([['ap1', [{ plugin: 'ap1', component: 'c' } as never]]]) } });
    t.agentPlugins.listInstalled.mockResolvedValue([rev(), rev({ pluginId: 'ap2' })]);
    t.agentPlugins.inactivePluginIds.mockResolvedValue(new Set(['ap2']));
    const out = await t.by('pl_list').handler(ctx({})) as any;
    expect(out.agentPlugins[0].exports).toEqual([{ plugin: 'ap1', component: 'c' }]);
    expect(out.agentPlugins[1]).toEqual({ pluginId: 'ap2', enabled: false, description: 'visible:ap2' });
  });

  it('keeps installed rows with empty exports when the export lookup fails, and tolerates a missing inactive-id capability', async () => {
    const t = setup({ pluginExports: { catalog: async () => { throw new Error('exports down'); } } });
    t.agentPlugins.inactivePluginIds = undefined as never;
    const out = await t.by('pl_list').handler(ctx({})) as any;
    expect(out.agentPlugins).toEqual([{ pluginId: 'ap1', version: '2.0.0', archiveDigest: 'dg-a', skills: ['skill-1'], exports: [] }]);
  });

  it('reports a null version for an unversioned agent plugin and empties the half when listing fails', async () => {
    const t = setup();
    t.agentPlugins.listInstalled.mockResolvedValueOnce([rev({ version: undefined })]);
    expect(((await t.by('pl_list').handler(ctx({}))) as any).agentPlugins[0].version).toBeNull();
    t.agentPlugins.listInstalled.mockRejectedValueOnce(new Error('index broken'));
    const out = await t.by('pl_list').handler(ctx({})) as any;
    expect(out.agentPlugins).toEqual([]);
    expect(out.plugins).toHaveLength(1);
  });
});

describe('set-enabled input validation and authorization', () => {
  it('requires an explicit family, string pluginId and boolean enabled', async () => {
    const t = setup();
    const call = (input: unknown) => t.by('pl_set').handler(ctx(input));
    await expect(call({ pluginId: 'x', enabled: true })).rejects.toThrow('family is required');
    await expect(call({ family: 'nope', pluginId: 'x', enabled: true })).rejects.toThrow('family is required');
    await expect(call({ family: 'site-runtime', enabled: true })).rejects.toBeInstanceOf(ToolInputError);
    await expect(call({ family: 'site-runtime', pluginId: 'x', enabled: 'yes' })).rejects.toThrow("'enabled' (boolean) is required");
  });

  it('scopes the permission check to the family entity type before any disclosure', async () => {
    const t = setup();
    await t.by('pl_set').handler(ctx({ family: 'agent-plugin', pluginId: 'ap1', enabled: false }));
    expect(t.authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: 'perm.enable', entityType: 'agent_plugin', entityId: 'ap1' }));
    const denied = setup({ authorize: (async () => ({ allowed: false, reason: 'no' })) as never });
    await expect(denied.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true }))).rejects.toThrow("not authorized for 'perm.enable'");
    expect(denied.deps.discoverPlugins).not.toHaveBeenCalled();
  });
});

describe('set-enabled for the site-runtime family', () => {
  it('enables after approval, records the approved capability set and reports restartRequired', async () => {
    const recordApproval = vi.fn(async () => {});
    const telemetry = { toggled: vi.fn() };
    const t = setup({ pluginSource: { readApproval: async () => ['tier:tier-3'], recordApproval }, telemetry } as never);
    const out = await t.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true })) as any;
    expect(out.desc).toContain('"adds":["capability:tools.register"]');
    expect(out.desc).toContain('"previousEnabled":false');
    expect(out.desc).toContain('"scope":{"personId":"p1","siteId":"ws1"}');
    expect(out.out).toMatchObject({ changed: true, cancelled: false, family: 'site-runtime', restartRequired: true, note: 'restart:site-a:true',
      plugin: { id: 'site-a', enabled: true, status: 'valid' } });
    expect(recordApproval).toHaveBeenCalledWith({ id: 'site-a', capabilities: ['capability:tools.register', 'tier:tier-3'] }, {});
    expect(t.rows.get('site-a')).toMatchObject({ enabled: true, version: '1.0.0' });
    expect(t.deps.onPluginEnabled).toHaveBeenCalledWith('site-a');
    expect(telemetry.toggled).toHaveBeenCalledWith({ principalId: 'p1', pluginId: 'site-a', enabled: true });
  });

  it('treats a site package with no recorded approval as adding every capability', async () => {
    const t = setup({ pluginSource: { readApproval: async () => undefined, recordApproval: async () => {} } } as never);
    const out = await t.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true })) as any;
    expect(out.desc).toContain('"adds":["capability:tools.register","tier:tier-3"]');
  });

  it('computes no capability diff for a built-in record, a manifest-less record, or without a source port', async () => {
    const builtIn = setup({}, { discovery: [record({ source: 'built-in' })] });
    expect(((await builtIn.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true }))) as any).desc).toContain('"adds":[]');
    const noManifest = setup({}, { discovery: [record({ manifest: undefined })] });
    const nm = await noManifest.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true })) as any;
    expect(nm.desc).toContain('"adds":[]');
    expect(nm.out.changed).toBe(true);
    const noPort = setup();
    const np = await noPort.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true })) as any;
    expect(np.desc).toContain('"adds":["capability:tools.register","tier:tier-3"]');
  });

  it('skips the dialog for a disable and lowers tool access durably after turning off', async () => {
    const telemetry = { toggled: vi.fn() };
    const t = setup({ telemetry } as never);
    t.rows.set('site-a', { pluginId: 'site-a', workspaceId: WS, version: '0.9.0', enabled: true, updatedAt: 'x' });
    const out = await t.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: false })) as any;
    expect(t.opts.ask).toEqual([false]);
    expect(out.desc).toBeUndefined();
    expect(out.out).toMatchObject({ changed: true, restartRequired: false, plugin: { enabled: false } });
    expect(t.rows.get('site-a')).toMatchObject({ enabled: false, version: '0.9.0' });
    expect(t.deps.lowerToolAccess).toHaveBeenCalledWith({ pluginId: 'site-a' });
    expect(t.deps.onPluginDisabled).toHaveBeenCalledWith('site-a');
    expect(telemetry.toggled).toHaveBeenCalledWith({ principalId: 'p1', pluginId: 'site-a', enabled: false });
  });

  it('does not report a toggle when the state did not change', async () => {
    const telemetry = { toggled: vi.fn() };
    const t = setup({ telemetry } as never);
    await t.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: false }));
    expect(telemetry.toggled).not.toHaveBeenCalled();
  });

  it('refuses an unknown plugin id during identity binding', async () => {
    const t = setup();
    await expect(t.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'ghost', enabled: true })))
      .rejects.toThrow("plugin 'ghost' was not found in the current discovery snapshot");
  });

  it('refuses when the plugin changed between approval and write', async () => {
    const t = setup();
    const original = t.deps.approvalFingerprint as ReturnType<typeof vi.fn>;
    let n = 0;
    original.mockImplementation(() => `fp-${n++}`);
    await expect(t.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true })))
      .rejects.toThrow('PLUGINS_STALE_APPROVAL');
    expect(t.rows.size).toBe(0);
  });

  it('reports abandonment instead of writing when the run was aborted after approval', async () => {
    const t = setup();
    const controller = new AbortController();
    controller.abort();
    const out = await t.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true }, { signal: controller.signal })) as any;
    expect(out.out).toEqual({ changed: false, cancelled: true, note: 'not-confirmed:abandoned', reason: 'abandoned' });
    expect(t.rows.size).toBe(0);
  });

  it.each(['declined', 'expired', 'abandoned'] as const)('returns a not-changed result when approval is %s and writes nothing', async (answer) => {
    const t = setup();
    t.opts.answer = answer;
    const out = await t.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true })) as any;
    expect(out.declined).toEqual({ changed: false, family: 'site-runtime', pluginId: 'site-a', restartRequired: false,
      cancelled: true, note: `not-confirmed:${answer}`, reason: answer });
    expect(t.rows.size).toBe(0);
    expect(t.agentPlugins.recordDeclinedAccess).not.toHaveBeenCalled();
  });

  it('rolls back to the exact prior row, or deletes a created one, through the command gateway', async () => {
    let captured: any;
    const t = setup({ executeCommand: (async ({ mutation }: any) => { captured = mutation; await mutation.captureInverse(); return { result: await mutation.execute() }; }) as never });
    t.rows.set('site-a', { pluginId: 'site-a', workspaceId: WS, version: '0.5.0', enabled: true, updatedAt: 'old' });
    await t.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: false }));
    expect(t.rows.get('site-a')!.enabled).toBe(false);
    await captured.rollback();
    expect(t.rows.get('site-a')).toEqual({ pluginId: 'site-a', workspaceId: WS, version: '0.5.0', enabled: true, updatedAt: 'old' });
    expect(t.deps.onPluginEnabled).toHaveBeenLastCalledWith('site-a');

    t.rows.clear();
    await t.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true }));
    expect(t.rows.has('site-a')).toBe(true);
    await captured.rollback();
    expect(t.rows.has('site-a')).toBe(false);
    expect(t.deps.onPluginDisabled).toHaveBeenLastCalledWith('site-a');
  });

  it('captures the prior enabled flag as the inverse', async () => {
    const inverses: unknown[] = [];
    const t = setup({ executeCommand: (async ({ mutation }: any) => { inverses.push(await mutation.captureInverse()); return { result: await mutation.execute() }; }) as never });
    await t.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true }));
    t.rows.set('site-a', { pluginId: 'site-a', workspaceId: WS, version: '1.0.0', enabled: true, updatedAt: 'x' });
    await t.by('pl_set').handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: true }));
    expect(inverses).toEqual([{ enabled: false }, { enabled: true }]);
  });

  it('refuses when the plugin vanishes from the snapshot used for the write', async () => {
    const t = setup({ executeCommand: (async () => ({ result: { activation: { pluginId: 'site-a', workspaceId: WS, version: '1', enabled: true, updatedAt: 'x' } } })) as never });
    t.deps.discoverPlugins = vi.fn().mockResolvedValue([]) as never;
    const regs = buildPluginManagementRegistrations(t.deps);
    const handler = regs.find(r => r.descriptor.id === 'pl_set')!.handler;
    await expect(handler(ctx({ family: 'site-runtime', pluginId: 'site-a', enabled: false }))).rejects.toThrow("plugin 'site-a' was not found in the current discovery snapshot");
  });
});

describe('set-enabled for the agent-plugin family', () => {
  const enable = { family: 'agent-plugin', pluginId: 'ap1', enabled: true };

  it('enables, provisions MCP with the approved access key and reports no restart', async () => {
    const t = setup();
    t.agentPlugins.previewEnableAccess.mockResolvedValue({ key: 'acc-key', resources: [{ name: 'r' }] } as never);
    t.agentPlugins.inactivePluginIds.mockResolvedValue(new Set(['ap1']));
    t.agentPlugins.setEnabled.mockResolvedValue({ pluginId: 'ap1', enabled: true, warnings: ['w1'] } as never);
    const out = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(out.desc).toContain('"previousEnabled":false');
    expect(out.desc).toContain('"resources":[{"name":"r"}]');
    expect(out.out).toEqual({ changed: true, cancelled: false, family: 'agent-plugin', agentPlugin: { pluginId: 'ap1', enabled: true }, warnings: ['w1'], restartRequired: false, note: 'restart:ap1:true' });
    expect(t.agentPlugins.setEnabled).toHaveBeenCalledWith({ workspaceId: WS, pluginId: 'ap1', enabled: true, actor: 'p1' });
    expect(t.agentPlugins.provisionMcp).toHaveBeenCalledWith({ pluginId: 'ap1', principalId: 'p1' }, { approvedEnable: true, approvedEnableKey: 'acc-key' });
  });

  it('binds every installed digest into the identity and names the host-preferred copy', async () => {
    const t = setup();
    t.agentPlugins.listInstalled.mockResolvedValue([rev({ version: '2.0.0', archiveDigest: 'b' }), rev({ version: '1.0.0', archiveDigest: 'a' }), rev({ pluginId: 'other' })]);
    t.agentPlugins.preferInstalled = async ({ installed }) => [installed[0]!];
    const identity = await pluginApprovalIdentity({ deps: t.deps, request: { family: 'agent-plugin', pluginId: 'ap1' } });
    expect(identity.version).toBe('2.0.0');
    expect(identity.label).toBe('ap1');
    expect(identity.key).toBe(`fp:agent-plugin:ap1:${JSON.stringify([['1.0.0', 'a'], ['2.0.0', 'b']])}:0`);
  });

  it('lists every remaining version sorted when the host has no selection owner, skipping unversioned ones', async () => {
    const t = setup();
    t.agentPlugins.listInstalled.mockResolvedValue([rev({ version: '2.0.0' }), rev({ version: undefined, archiveDigest: 'z' }), rev({ version: '1.0.0', archiveDigest: 'q' })]);
    const identity = await pluginApprovalIdentity({ deps: t.deps, request: { family: 'agent-plugin', pluginId: 'ap1' } });
    expect(identity.version).toBe('1.0.0, 2.0.0');
  });

  it('works when the host exposes neither access preview nor preference', async () => {
    const identity = await pluginApprovalIdentity({
      deps: { discoverPlugins: async () => [], approvalFingerprint: ({ revision }) => revision, agentPlugins: { listInstalled: async () => [rev()] } } as never,
      request: { family: 'agent-plugin', pluginId: 'ap1' },
    });
    expect(identity).toMatchObject({ key: JSON.stringify([['2.0.0', 'dg-a']]), version: '2.0.0', accessKey: undefined });
  });

  it('refuses an id that is not installed', async () => {
    const t = setup();
    t.agentPlugins.listInstalled.mockResolvedValue([]);
    await expect(t.by('pl_set').handler(ctx(enable))).rejects.toThrow("Agent Plugin 'ap1' is not installed");
  });

  it('does not provision MCP for a disable and never opens a dialog', async () => {
    const t = setup();
    t.agentPlugins.setEnabled.mockResolvedValue({ pluginId: 'ap1', enabled: false } as never);
    const out = await t.by('pl_set').handler(ctx({ ...enable, enabled: false })) as any;
    expect(t.opts.ask).toEqual([false]);
    expect(out.out).toMatchObject({ changed: true, agentPlugin: { enabled: false }, warnings: [] });
    expect(t.agentPlugins.provisionMcp).not.toHaveBeenCalled();
  });

  it('records a declined access answer for the access key, but not for expiry or without a key', async () => {
    const t = setup();
    t.agentPlugins.previewEnableAccess.mockResolvedValue({ key: 'acc-key' } as never);
    t.opts.answer = 'declined';
    await t.by('pl_set').handler(ctx(enable));
    expect(t.agentPlugins.recordDeclinedAccess).toHaveBeenCalledWith({ accessKey: 'acc-key' });
    t.agentPlugins.recordDeclinedAccess.mockClear();
    t.opts.answer = 'expired';
    await t.by('pl_set').handler(ctx(enable));
    expect(t.agentPlugins.recordDeclinedAccess).not.toHaveBeenCalled();
    t.agentPlugins.previewEnableAccess.mockResolvedValue(undefined);
    t.opts.answer = 'declined';
    await t.by('pl_set').handler(ctx(enable));
    expect(t.agentPlugins.recordDeclinedAccess).not.toHaveBeenCalled();
  });

  it('tolerates a host without recordDeclinedAccess', async () => {
    const t = setup();
    t.agentPlugins.previewEnableAccess.mockResolvedValue({ key: 'acc-key' } as never);
    t.agentPlugins.recordDeclinedAccess = undefined as never;
    t.opts.answer = 'declined';
    const out = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(out.declined.changed).toBe(false);
  });

  it('refuses before the dialog when activations are unreadable, busy, or an update is pending', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = setup();
    t.agentPlugins.assertWritable.mockRejectedValue(new Error('bad file /secret/path'));
    t.agentPlugins.classifyError.mockReturnValue({ kind: 'unreadable', message: 'cannot parse /host/path' });
    let out = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(out.desc).toBeUndefined();
    expect(out.out).toEqual({ changed: false, cancelled: false, family: 'agent-plugin', pluginId: 'ap1', restartRequired: false, reason: 'activations-unreadable', note: 'unreadable:ap1' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[agent-plugins] 'ap1': pl_set refused"));
    t.agentPlugins.classifyError.mockReturnValue({ kind: 'busy', message: 'locked' });
    out = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(out.out).toMatchObject({ reason: 'activations-busy', note: 'busy:ap1' });
    t.agentPlugins.classifyError.mockReturnValue({ kind: 'update', code: 'PLUGIN_UPDATE_PENDING' });
    out = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(out.out).toEqual({ changed: false, cancelled: false, family: 'agent-plugin', pluginId: 'ap1', restartRequired: false, reason: 'update-pending', code: 'PLUGIN_UPDATE_PENDING',
      note: "Nothing changed: an interrupted update of 'ap1' is still waiting to be recovered, so it was NOT enabled. next:PLUGIN_UPDATE_PENDING" });
    t.agentPlugins.classifyError.mockReturnValue({ kind: 'host-incompatible', code: 'PLUGIN_HOST_INCOMPATIBLE' });
    out = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(out.out).toMatchObject({ reason: 'host-incompatible', code: 'PLUGIN_HOST_INCOMPATIBLE', note: 'incompatible:ap1' });
  });

  it('words an update-pending refusal of a disable as NOT disabled', async () => {
    const t = setup();
    t.agentPlugins.setEnabled.mockRejectedValue(new Error('x'));
    t.agentPlugins.classifyError.mockReturnValue({ kind: 'update', code: 'PLUGIN_UPDATE_PENDING' });
    const out = await t.by('pl_set').handler(ctx({ ...enable, enabled: false })) as any;
    expect(out.out.note).toContain('so it was NOT disabled. next:PLUGIN_UPDATE_PENDING');
  });

  it('shows an unknown previous state when the host cannot report inactive ids, and omits the approval scope for a refused enable', async () => {
    const t = setup();
    t.opts.alwaysDescribe = true;
    t.agentPlugins.inactivePluginIds = undefined as never;
    t.providerFaces.linkedProvider.mockResolvedValue('prov-1');
    const refused = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(refused.desc).not.toContain('"scope"');
    t.providerFaces.linkedProvider.mockResolvedValue(undefined);
    t.opts.alwaysDescribe = false;
    const out = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(out.desc).toContain('"previousEnabled":null');
    expect(out.desc).toContain('"scope":{"personId":"p1","siteId":"ws1"}');
  });

  it('rethrows an unclassified writability failure unchanged', async () => {
    const t = setup();
    const boom = new Error('unknown');
    t.agentPlugins.assertWritable.mockRejectedValue(boom);
    await expect(t.by('pl_set').handler(ctx(enable))).rejects.toBe(boom);
  });

  it('refuses a linked provider face before the dialog and tolerates an unreadable link', async () => {
    const t = setup();
    t.providerFaces.linkedProvider.mockResolvedValue('prov-1');
    const out = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(out.out).toEqual({ changed: false, cancelled: false, family: 'agent-plugin', pluginId: 'ap1', restartRequired: false, reason: 'linked',
      code: 'LINKED', providerPluginId: 'prov-1', note: 'Nothing changed. switch the provider' });
    t.providerFaces.linkedProvider.mockRejectedValue(new Error('unreadable'));
    const ok = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(ok.out.changed).toBe(true);
  });

  it('refuses a host-incompatible revision before the dialog', async () => {
    const t = setup();
    t.agentPlugins.compatibility.mockReturnValue({ code: 'PLUGIN_HOST_INCOMPATIBLE' });
    const out = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(out.out).toMatchObject({ changed: false, reason: 'host-incompatible', code: 'PLUGIN_HOST_INCOMPATIBLE' });
    expect(t.agentPlugins.compatibility).toHaveBeenCalledWith({ pluginId: 'ap1', revisions: [expect.objectContaining({ pluginId: 'ap1' })] });
    expect(t.agentPlugins.setEnabled).not.toHaveBeenCalled();
  });

  it('turns a not-installed write failure into an input error carrying the classified message', async () => {
    const t = setup();
    t.agentPlugins.setEnabled.mockRejectedValue(new Error('x'));
    t.agentPlugins.classifyError.mockReturnValue({ kind: 'not-installed', message: "Agent Plugin 'ap1' is not installed" });
    await expect(t.by('pl_set').handler(ctx(enable))).rejects.toThrow("Agent Plugin 'ap1' is not installed");
  });

  it('turns a linked-provider write failure into the linked result and relays classified write refusals', async () => {
    const t = setup();
    t.agentPlugins.setEnabled.mockRejectedValue(new Error('x'));
    t.providerFaces.describeLinkedError.mockReturnValue({ code: 'LINKED', message: 'use the provider', providerPluginId: 'prov-2' });
    let out = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(out.out).toMatchObject({ changed: false, reason: 'linked', providerPluginId: 'prov-2', note: 'Nothing changed. use the provider' });
    t.providerFaces.describeLinkedError.mockReturnValue(undefined);
    t.agentPlugins.classifyError.mockReturnValue({ kind: 'busy', message: 'locked' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    out = await t.by('pl_set').handler(ctx(enable)) as any;
    expect(out.out).toMatchObject({ reason: 'activations-busy' });
    t.agentPlugins.classifyError.mockReturnValue(undefined);
    await expect(t.by('pl_set').handler(ctx(enable))).rejects.toThrow('x');
  });

  it('redacts secrets from the logged refusal text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = setup();
    t.agentPlugins.assertWritable.mockRejectedValue(new Error('x'));
    t.agentPlugins.classifyError.mockReturnValue({ kind: 'busy', message: 'token sk-abcdefghijklmnopqrstuvwxyz0123456789 held' });
    await t.by('pl_set').handler(ctx(enable));
    expect(String(warn.mock.calls[0]![0])).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789');
  });
});

describe('uninstall', () => {
  const uninstall = { family: 'site-runtime', pluginId: 'site-a' };

  it('validates family and pluginId', async () => {
    const t = setup();
    await expect(t.by('pl_uninstall').handler(ctx({ pluginId: 'x' }))).rejects.toThrow('family is required');
    await expect(t.by('pl_uninstall').handler(ctx({ family: 'site-runtime' }))).rejects.toBeInstanceOf(ToolInputError);
  });

  it('delegates agent-plugin removal wholesale with a cloned context and the execution options', async () => {
    const t = setup();
    const input = { family: 'agent-plugin', pluginId: 'ap1' };
    const c = ctx(input);
    const out = await t.by('pl_uninstall').handler(c, { marker: 1 } as never);
    expect(out).toEqual({ agent: 'uninstalled' });
    const call = (t.agentPlugins.uninstall.mock.calls as any)[0][0];
    expect(call.pluginId).toBe('ap1');
    expect(call.executionOptions).toEqual({ marker: 1 });
    expect(call.ctx.input).toEqual(input);
    expect(call.ctx.input).not.toBe(input);
    expect(call.ctx.principal).not.toBe(c.principal);
  });

  it('previews, asks, re-authorizes and moves a disabled site plugin to trash', async () => {
    const t = setup();
    const out = await t.by('pl_uninstall').handler(ctx(uninstall)) as any;
    expect(out.desc).toBe('uninstall site-a');
    expect(out.out).toEqual({ pluginId: 'site-a', trashed: true });
    expect(t.removePlugin).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WS, id: 'site-a', at: '2030-01-01T00:00:00.000Z', actor: { principalId: 'p1', pluginId: 'actor-plugin' } }));
    expect(t.authorize).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'plugin', entityId: 'site-a' }));
  });

  it('refuses a denied principal, an enabled plugin, a built-in and an unknown id before any dialog', async () => {
    const denied = setup({ authorize: (async () => ({ allowed: false, reason: 'no' })) as never });
    await expect(denied.by('pl_uninstall').handler(ctx(uninstall))).rejects.toThrow("not authorized for 'perm.enable'");
    const enabled = setup();
    enabled.rows.set('site-a', { pluginId: 'site-a', workspaceId: WS, version: '1', enabled: true, updatedAt: 'x' });
    await expect(enabled.by('pl_uninstall').handler(ctx(uninstall))).rejects.toThrow('must be disabled everywhere');
    const builtIn = setup({}, { discovery: [record({ source: 'built-in' })] });
    await expect(builtIn.by('pl_uninstall').handler(ctx(uninstall))).rejects.toThrow('built-in plugin and cannot be uninstalled');
    const unknown = setup();
    await expect(unknown.by('pl_uninstall').handler(ctx({ family: 'site-runtime', pluginId: 'ghost' }))).rejects.toThrow("plugin 'ghost' was not found");
    expect(enabled.opts.ask).toEqual([]);
  });

  it.each(['declined', 'expired', 'abandoned'] as const)('returns a not-uninstalled result when approval is %s', async (answer) => {
    const t = setup();
    t.opts.answer = answer;
    const out = await t.by('pl_uninstall').handler(ctx(uninstall)) as any;
    expect(out.declined).toEqual({ pluginId: 'site-a', uninstalled: false, cancelled: true, note: `not-confirmed:${answer}`, reason: answer });
    expect(t.removePlugin).not.toHaveBeenCalled();
  });

  it('reports abandonment when the run was aborted after approval', async () => {
    const t = setup();
    const controller = new AbortController();
    controller.abort();
    const out = await t.by('pl_uninstall').handler(ctx(uninstall, { signal: controller.signal })) as any;
    expect(out.out).toEqual({ uninstalled: false, cancelled: true, note: 'not-confirmed:abandoned', reason: 'abandoned' });
    expect(t.removePlugin).not.toHaveBeenCalled();
  });

  it('returns changed-since-confirmation when the shown name or version moved before removal', async () => {
    const t = setup();
    const base = t.deps.discoverPlugins as ReturnType<typeof vi.fn>;
    base.mockResolvedValueOnce([record()]).mockResolvedValue([record({ version: '2.0.0' })]);
    const out = await t.by('pl_uninstall').handler(ctx(uninstall)) as any;
    expect(out.out).toEqual({ pluginId: 'site-a', uninstalled: false, cancelled: false, reason: 'changed-since-confirmation', note: 'changed:site-a:Site A:1.0.0' });
    expect(t.removePlugin).not.toHaveBeenCalled();
  });

  it('propagates other uninstall failures unchanged', async () => {
    const t = setup();
    t.removePlugin.mockResolvedValue({ ok: false, reason: 'blocked' } as never);
    await expect(t.by('pl_uninstall').handler(ctx(uninstall))).rejects.toThrow("plugin 'site-a' is already in the Trash");
  });
});
