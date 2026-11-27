/** EXTRACT-S6 L1b part 1: the capability-tool registrar bound to a second host — its own permission
 * names, entity scope, identity namespace, catalog path, metadata, approval family and wording —
 * through the public `./host` barrel only. Proves the SAME supplied permission reaches the catalog
 * entry and the handler, and that the content payload shape is unchanged. */
import { describe, expect, it, vi } from 'vitest';
import * as core from '@jini-ai/core';
import { createToolRegistry, ToolInputError, type LegacyToolAuthorizeFn, type ToolRegistration } from '@jini-ai/core';
import { authorizeToolInvocation } from '@jini-ai/core/composition';
import { buildCapabilityScopedSdk } from '../../capability-sdk.js';
import { createPluginContributionCapture, createPluginContributionRegistry } from '../../contributions.js';
import { pluginSdkBinding } from '../support/fixture-bindings.js';
import {
  capabilityToolIdFor,
  createPluginCapabilityTools,
  InMemoryPluginActivationRepo,
  pluginCapabilityToolDerivedRisk,
  type PluginCapabilityToolDeps,
  type PluginCapabilityToolText,
  type PluginDiscoveryRecord,
  type PluginManifest,
} from '../../index.js';

// Observe the catalog entries the registrar hands the core registration kit (the kit keeps them
// internal), without changing what it does.
vi.mock('@jini-ai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jini-ai/core')>();
  return { ...actual, buildDomainRegistrations: vi.fn(actual.buildDomainRegistrations) };
});

const WORKSPACE = 'ws-second';

/** A second host's wording: none of the first host's sentences. */
const TEXT: PluginCapabilityToolText = {
  genericFieldDescription: ({ pluginName, path, type }) => `[generic ${pluginName} ${path} ${type}]`,
  discovery: ({ terms }) => ` [terms ${terms}]`,
  freshDescription: ({ pluginName, fieldText }) => `[fresh ${pluginName}]${fieldText}`,
  storedDescription: ({ pluginName, fieldText }) => `[stored ${pluginName}]${fieldText}`,
  postIdDescription: '[record id]',
  noDataNote: ({ pluginName }) => `[nothing yet from ${pluginName}]`,
  previewFailed: ({ pluginName, postId }) => `[failed ${pluginName} on ${postId}]`,
  activationReadDenied: ({ pluginId, detail }) => `[denied ${pluginId}: ${detail}]`,
};

interface SecondRecord { readonly id: string; readonly ext?: Record<string, Record<string, string | number>>; readonly body: string }
interface SecondDraft { readonly recordId: string; readonly body: string }

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'meter', name: 'Meter', version: '1.0.0', sdkRange: '^1', engine: 1, tier: 'tier-3',
    capabilities: [], hooks: ['content.entry.beforeSave'], integrity: {}, keywords: ['measure'],
    extensions: { second: { id: 'acme/meter', provides: ['metrics.count'] }, first: { id: 'other/ignored' } },
    fields: [
      { path: 'ext.meter.count', type: 'number', description: 'Counts things.' },
      { path: 'ext.meter.report', type: 'string' },
    ],
    ...overrides,
  } as PluginManifest;
}

function discovered(m: PluginManifest): PluginDiscoveryRecord {
  return { id: m.id, name: m.name, version: m.version, source: 'site', status: 'valid', manifest: m } as PluginDiscoveryRecord;
}

function secondHost() {
  const approvals: string[] = [];
  const tools = createPluginCapabilityTools<SecondRecord, SecondDraft, 'second-family'>({
    identityNamespace: 'second',
    beforeSaveHook: 'content.entry.beforeSave',
    text: TEXT,
    catalog: { domain: 'second-capability', catalogModule: 'second/catalog.ts', metadata: {} },
    access: { permission: 'records.view', entityType: 'record' },
    executableAccess: { permission: 'records.admin', entityType: 'extension', metadata: { approval: { class: 'publish', confirmation: 'direct' } } },
    approvalFamily: 'second-family',
    toPreviewDraft: ({ post }) => ({ recordId: post.id, body: post.body }),
  }, {});
  const applyApprovalPolicy = vi.fn(({ registration, family }: { registration: ToolRegistration; family: 'second-family' }) => {
    approvals.push(`${registration.descriptor.id}:${family}`);
    return registration;
  });
  return { tools, approvals, applyApprovalPolicy };
}

async function enabledRepo(pluginId = 'meter'): Promise<InMemoryPluginActivationRepo> {
  const repo = new InMemoryPluginActivationRepo();
  await repo.save({ pluginId, workspaceId: WORKSPACE, version: '1.0.0', enabled: true, updatedAt: '2026-11-09T00:00:00.000Z' } as never);
  return repo;
}

function deps(over: Partial<PluginCapabilityToolDeps<SecondRecord, SecondDraft>> & { pluginActivationRepo: InMemoryPluginActivationRepo; authorize: LegacyToolAuthorizeFn }): PluginCapabilityToolDeps<SecondRecord, SecondDraft> {
  return {
    workspaceId: WORKSPACE,
    postRead: { readRequired: async ({ id }) => ({ id, body: 'hello', ext: { meter: { count: 3, report: '{"a":1}' } } }) },
    ...over,
  };
}

describe('EXTRACT-S6 capability tools: second host vocabulary', () => {
  it('derives the saved capability id, the second namespace and the second wording', async () => {
    const { tools } = secondHost();
    const repo = await enabledRepo();
    const sources = await tools.loadSources({ workspaceId: WORKSPACE, pluginActivationRepo: repo, discoverPlugins: async () => [discovered(manifest())] });
    expect(sources).toHaveLength(1);
    expect(sources[0]!.id).toBe(capabilityToolIdFor({ pluginId: 'meter' }));
    expect(sources[0]!.id).toBe('plugin_capability_meter');
    expect(sources[0]!.fields.map((f) => f.description)).toEqual(['Counts things.', '[generic Meter ext.meter.report string]']);
    expect(sources[0]!.description).toBe('[stored Meter]Counts things. [generic Meter ext.meter.report string] [terms acme/meter measure metrics.count]');
    expect(sources[0]!.runsFresh).toBe(false);
    expect(pluginCapabilityToolDerivedRisk({ sources }).get('plugin_capability_meter')).toBe('none');
  });

  it('a disabled or absent plugin yields no source', async () => {
    const { tools } = secondHost();
    const sources = await tools.loadSources({ workspaceId: WORKSPACE, pluginActivationRepo: new InMemoryPluginActivationRepo(), discoverPlugins: async () => [discovered(manifest())] });
    expect(sources).toEqual([]);
  });

  it('the SAME supplied permission and entity scope reach the catalog entry and the handler', async () => {
    const { tools, approvals, applyApprovalPolicy } = secondHost();
    const repo = await enabledRepo();
    const sources = await tools.loadSources({ workspaceId: WORKSPACE, pluginActivationRepo: repo, discoverPlugins: async () => [discovered(manifest())] });
    const checks: unknown[] = [];
    const authorize: LegacyToolAuthorizeFn = async (req) => { checks.push(req); return { allowed: true, reason: 'ok' }; };
    const [registration] = tools.buildRegistrations({ sources, deps: deps({ pluginActivationRepo: repo, authorize }), applyApprovalPolicy }, {});
    expect(approvals).toEqual(['plugin_capability_meter:second-family']);
    const spec = vi.mocked(core.buildDomainRegistrations).mock.calls.at(-1)![0];
    expect(spec.domain).toBe('second-capability');
    expect(spec.catalogModule).toBe('second/catalog.ts');
    expect(spec.catalog.get('plugin_capability_meter')!.authorization).toEqual({ permission: 'records.view' });
    expect(registration!.descriptor.inputSchema).toEqual({
      type: 'object', additionalProperties: false, required: ['postId'],
      properties: { postId: { type: 'string', minLength: 1, description: '[record id]' } },
    });
    const result = await registration!.handler({ input: { postId: 'r1' }, principal: { id: 'p1' } } as never);
    expect(checks).toEqual([{ principalId: 'p1', permission: 'records.view', workspaceId: WORKSPACE, entityType: 'record', entityId: 'r1' }]);
    // Content payload: unchanged keys and order, JSON-string fields decoded.
    expect(result).toEqual({ postId: 'r1', pluginId: 'meter', computedNow: false, fields: { count: 3, report: { a: 1 } } });
    expect(Object.keys(result as object)).toEqual(['postId', 'pluginId', 'computedNow', 'fields']);
  });

  it('a denied permission refuses before the post is read', async () => {
    const { tools, applyApprovalPolicy } = secondHost();
    const repo = await enabledRepo();
    const sources = await tools.loadSources({ workspaceId: WORKSPACE, pluginActivationRepo: repo, discoverPlugins: async () => [discovered(manifest())] });
    const readRequired = vi.fn();
    const [registration] = tools.buildRegistrations({ sources, deps: deps({ pluginActivationRepo: repo, authorize: async () => ({ allowed: false, reason: 'no' }), postRead: { readRequired } }), applyApprovalPolicy });
    await expect(registration!.handler({ input: { postId: 'r1' }, principal: { id: 'p1' } } as never)).rejects.toMatchObject({ permission: 'records.view' });
    expect(readRequired).not.toHaveBeenCalled();
  });

  it('no stored data answers nulls plus the host note', async () => {
    const { tools, applyApprovalPolicy } = secondHost();
    const repo = await enabledRepo();
    const sources = await tools.loadSources({ workspaceId: WORKSPACE, pluginActivationRepo: repo, discoverPlugins: async () => [discovered(manifest())] });
    const [registration] = tools.buildRegistrations({ sources, deps: deps({ pluginActivationRepo: repo, authorize: async () => ({ allowed: true, reason: 'ok' }), postRead: { readRequired: async ({ id }) => ({ id, body: '', ext: {} }) } }), applyApprovalPolicy });
    expect(await registration!.handler({ input: { postId: 'r2' }, principal: { id: 'p1' } } as never)).toEqual({
      postId: 'r2', pluginId: 'meter', computedNow: false, fields: { count: null, report: null }, note: '[nothing yet from Meter]',
    });
  });

  it('a tier-2 before-save plugin runs fresh through the host draft, and a failed run uses the host text', async () => {
    const { tools, applyApprovalPolicy } = secondHost();
    const repo = await enabledRepo();
    const sources = await tools.loadSources({ workspaceId: WORKSPACE, pluginActivationRepo: repo, discoverPlugins: async () => [discovered(manifest({ tier: 'tier-2' }))] });
    expect(sources[0]!.description.startsWith('[fresh Meter]')).toBe(true);
    const drafts: unknown[] = [];
    const preview = vi.fn(async (pluginId: string, entry: SecondDraft) => { drafts.push([pluginId, entry]); return { count: 9 }; });
    const live = deps({ pluginActivationRepo: repo, authorize: async () => ({ allowed: true, reason: 'ok' }), previewPluginBeforeSave: preview });
    const [registration] = tools.buildRegistrations({ sources, deps: live, applyApprovalPolicy });
    expect(await registration!.handler({ input: { postId: 'r3' }, principal: { id: 'p1' } } as never)).toEqual({
      postId: 'r3', pluginId: 'meter', computedNow: true, fields: { count: 9, report: null },
    });
    expect(drafts).toEqual([['meter', { recordId: 'r3', body: 'hello' }]]);
    const cause = new Error('worker died');
    preview.mockRejectedValueOnce(cause);
    const failure = await registration!.handler({ input: { postId: 'r3' }, principal: { id: 'p1' } } as never).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ToolInputError);
    expect((failure as Error).message).toBe('[failed Meter on r3]');
    expect((failure as Error).cause).toBe(cause);
  });

  it('the per-call activation gate rereads, and a failed read denies with the host log text', async () => {
    const { tools, applyApprovalPolicy } = secondHost();
    const repo = await enabledRepo();
    const sources = await tools.loadSources({ workspaceId: WORKSPACE, pluginActivationRepo: repo, discoverPlugins: async () => [discovered(manifest())] });
    const live = deps({ pluginActivationRepo: repo, authorize: async () => ({ allowed: true, reason: 'ok' }) });
    const [registration] = tools.buildRegistrations({ sources, deps: live, applyApprovalPolicy });
    const ctx = { toolId: 'plugin_capability_meter', principal: { id: 'p1' }, input: {} } as never;
    expect(await registration!.policy.authorize(ctx)).not.toBe('deny');
    await repo.deleteActivation({ workspaceId: WORKSPACE, pluginId: 'meter' });
    expect(await registration!.policy.authorize(ctx)).toBe('deny');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(repo, 'getActivation').mockRejectedValueOnce(new Error('boom api_key=SECRETSECRETSECRETSECRET'));
    expect(await registration!.policy.authorize(ctx)).toBe('deny');
    expect(warn).toHaveBeenCalledWith('[denied meter: Error]');
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/boom|SECRETSECRET/);
    warn.mockRestore();
  });

  it('registerEnabled registers each enabled capability tool on the given registry', async () => {
    const { tools, applyApprovalPolicy } = secondHost();
    const repo = await enabledRepo();
    const registry = createToolRegistry({});
    await tools.registerEnabled({
      registry,
      deps: { ...deps({ pluginActivationRepo: repo, authorize: async () => ({ allowed: true, reason: 'ok' }) }), discoverPlugins: async () => [discovered(manifest())] },
      applyApprovalPolicy,
    }, {});
    expect(registry.has({ toolId: 'plugin_capability_meter' })).toBe(true);
  });
});

/** An executable (tier-3) plugin contribution registry holding one `echo` tool from `exec-plug`. */
function executableContributions() {
  const execManifest = { id: 'exec-plug', name: 'Exec', version: '0.1.0', sdkRange: '*', engine: 1, tier: 'tier-3',
    capabilities: ['tools.register'], hooks: [], fields: [], integrity: {}, contributes: { tools: ['echo'] } } as PluginManifest;
  const coreDeps = { getCurrentEntry: () => ({ workspaceId: WORKSPACE, ext: {} }), writeExtField: () => {}, attachFilter: () => {} };
  const sdk = buildCapabilityScopedSdk({ pluginId: execManifest.id, pluginSdkBinding, capabilities: [], coreDeps });
  const contributions = createPluginContributionRegistry({});
  const capture = createPluginContributionCapture({ manifest: execManifest });
  const seen: unknown[] = [];
  capture.tools.add({ name: 'echo', description: 'echo', inputSchema: { type: 'object' }, handler: (ctx) => { seen.push(ctx.auth); return { echoed: ctx.input }; } });
  contributions.replace({ contributions: capture.seal({ sdk }) });
  return { contributions, seen };
}

describe('capability tools: field decoding and executable contribution ports', () => {
  it('a stored string that only looks like JSON is returned exactly as written', async () => {
    const { tools, applyApprovalPolicy } = secondHost();
    const repo = await enabledRepo();
    const sources = await tools.loadSources({ workspaceId: WORKSPACE, pluginActivationRepo: repo, discoverPlugins: async () => [discovered(manifest())] });
    const [registration] = tools.buildRegistrations({ sources, deps: deps({ pluginActivationRepo: repo, authorize: async () => ({ allowed: true, reason: 'ok' }),
      postRead: { readRequired: async ({ id }) => ({ id, body: '', ext: { meter: { count: 1, report: '{not json' } } }) } }), applyApprovalPolicy });
    expect(await registration!.handler({ input: { postId: 'r9' }, principal: { id: 'p1' } } as never)).toEqual({
      postId: 'r9', pluginId: 'meter', computedNow: false, fields: { count: 1, report: '{not json' },
    });
  });

  it('a post with no ext bag, or a non-object plugin bag, reads as not yet written instead of throwing', async () => {
    const { tools, applyApprovalPolicy } = secondHost();
    const repo = await enabledRepo();
    const sources = await tools.loadSources({ workspaceId: WORKSPACE, pluginActivationRepo: repo, discoverPlugins: async () => [discovered(manifest())] });
    const posts: Record<string, SecondRecord> = {
      bare: { id: 'bare', body: '' },
      odd: { id: 'odd', body: '', ext: { meter: 'oops' as unknown as Record<string, string> } },
    };
    const [registration] = tools.buildRegistrations({ sources, deps: deps({ pluginActivationRepo: repo, authorize: async () => ({ allowed: true, reason: 'ok' }),
      postRead: { readRequired: async ({ id }) => posts[id]! } }), applyApprovalPolicy });
    for (const postId of ['bare', 'odd']) {
      expect(await registration!.handler({ input: { postId }, principal: { id: 'p1' } } as never)).toEqual({
        postId, pluginId: 'meter', computedNow: false, fields: { count: null, report: null }, note: '[nothing yet from Meter]',
      });
    }
  });

  it('attaches executable contribution tools to the dedicated registry, gated by activation and the executable permission', async () => {
    const { tools, applyApprovalPolicy } = secondHost();
    const repo = await enabledRepo();
    await repo.save({ pluginId: 'exec-plug', workspaceId: WORKSPACE, version: '0.1.0', enabled: true, updatedAt: '2026-11-09T00:00:00.000Z' } as never);
    const { contributions, seen } = executableContributions();
    const registry = createToolRegistry({});
    const executableRegistry = createToolRegistry({});
    const checks: unknown[] = [];
    const authorize: LegacyToolAuthorizeFn = async (req) => { checks.push(req); return { allowed: true, reason: 'ok' }; };
    await tools.registerEnabled({
      registry,
      deps: { ...deps({ pluginActivationRepo: repo, authorize }), discoverPlugins: async () => [discovered(manifest())], pluginContributions: contributions, executablePluginToolRegistry: executableRegistry },
      applyApprovalPolicy,
    }, {});
    expect(registry.has({ toolId: 'p_exec_plug__echo' })).toBe(false);
    expect(executableRegistry.has({ toolId: 'p_exec_plug__echo' })).toBe(true);
    const descriptor = executableRegistry.list({}).find((d) => d.id === 'p_exec_plug__echo')!;
    // Host executable metadata reaches the descriptor: direct confirmation lifts the default confirm.
    expect(descriptor.metadata).toEqual({ approval: { class: 'publish', confirmation: 'direct' } });
    expect(descriptor.requiresConfirmation).toBe(false);
    const call = { registry: executableRegistry, toolId: 'p_exec_plug__echo', principal: { id: 'p7' }, run: { id: 'r1' }, input: { a: 1 } } as never;
    const granted = await authorizeToolInvocation(call);
    expect(granted?.decision).toBe('allow');
    expect(checks).toEqual([{ principalId: 'p7', permission: 'records.admin', workspaceId: WORKSPACE, entityType: 'extension', entityId: 'exec-plug' }]);
    const handler = granted!.decision === 'allow' ? granted!.handler : undefined;
    const ctx = { executionId: 'e1', principal: { id: 'p7' }, run: { id: 'r1' }, input: { a: 1 }, signal: new AbortController().signal } as never;
    expect(await handler!(ctx)).toEqual({ echoed: { a: 1 } });
    expect(seen).toEqual([{ access: 'admin', principalId: 'p7', workspaceId: WORKSPACE }]);
    await repo.save({ pluginId: 'exec-plug', workspaceId: WORKSPACE, version: '0.1.0', enabled: false, updatedAt: '2026-11-09T00:00:01.000Z' } as never);
    expect((await authorizeToolInvocation(call))?.decision).toBe('deny');
  });

  it('falls back to the capability registry when it can list, and attaches nothing to a register-only port', async () => {
    const { tools, applyApprovalPolicy } = secondHost();
    const repo = await enabledRepo();
    await repo.save({ pluginId: 'exec-plug', workspaceId: WORKSPACE, version: '0.1.0', enabled: true, updatedAt: '2026-11-09T00:00:00.000Z' } as never);
    const live = (contributions: ReturnType<typeof executableContributions>['contributions']) => ({
      ...deps({ pluginActivationRepo: repo, authorize: async () => ({ allowed: true, reason: 'ok' }) }), discoverPlugins: async () => [discovered(manifest())], pluginContributions: contributions,
    });
    const registry = createToolRegistry({});
    await tools.registerEnabled({ registry, deps: live(executableContributions().contributions), applyApprovalPolicy }, {});
    expect(registry.has({ toolId: 'p_exec_plug__echo' })).toBe(true);
    expect(registry.has({ toolId: 'plugin_capability_meter' })).toBe(true);
    const registered: string[] = [];
    await tools.registerEnabled({ registry: { register: (r: ToolRegistration) => { registered.push(r.descriptor.id); } }, deps: live(executableContributions().contributions), applyApprovalPolicy }, {});
    expect(registered).toEqual(['plugin_capability_meter']);
  });
});
