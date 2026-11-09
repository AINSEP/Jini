/** EXTRACT-S6-FIX finding 3: a second host whose SDK names its before-save hook `record.preCommit`.
 * A valid tier-2 plugin declaring that hook must run fresh (through the host preview port), and a
 * plugin declaring only the FIRST host's hook id must NOT — the registrar compares against the
 * host-supplied `beforeSaveHook`, never a literal. Public `./host` barrel only. */
import { describe, expect, it, vi } from 'vitest';
import type { ToolRegistration } from '@jini-ai/core';
import {
  createPluginCapabilityTools,
  InMemoryPluginActivationRepo,
  type PluginCapabilityToolText,
  type PluginDiscoveryRecord,
  type PluginManifest,
} from '../../index.js';

const WORKSPACE = 'ws-second';
const HOOK = 'record.preCommit';

const TEXT: PluginCapabilityToolText = {
  genericFieldDescription: ({ pluginName, path, type }) => `[generic ${pluginName} ${path} ${type}]`,
  discovery: ({ terms }) => ` [terms ${terms}]`,
  freshDescription: ({ pluginName }) => `[fresh ${pluginName}]`,
  storedDescription: ({ pluginName }) => `[stored ${pluginName}]`,
  postIdDescription: '[record id]',
  noDataNote: ({ pluginName }) => `[nothing yet from ${pluginName}]`,
  previewFailed: ({ pluginName, postId }) => `[failed ${pluginName} on ${postId}]`,
  activationReadDenied: ({ pluginId, detail }) => `[denied ${pluginId}: ${detail}]`,
};

interface SecondRecord { readonly id: string; readonly ext?: Record<string, Record<string, string | number>>; readonly body: string }
interface SecondDraft { readonly recordId: string; readonly body: string }

function discovered(hooks: readonly string[]): PluginDiscoveryRecord {
  const manifest = {
    id: 'meter', name: 'Meter', version: '1.0.0', sdkRange: '^1', engine: 1, tier: 'tier-2',
    capabilities: [], hooks, integrity: {}, keywords: [],
    fields: [{ path: 'ext.meter.count', type: 'number', description: 'Counts things.' }],
  } as unknown as PluginManifest;
  return { id: 'meter', name: 'Meter', version: '1.0.0', source: 'site', status: 'valid', manifest } as PluginDiscoveryRecord;
}

async function run(hooks: readonly string[]) {
  const tools = createPluginCapabilityTools<SecondRecord, SecondDraft, 'second-family'>({
    identityNamespace: 'second',
    beforeSaveHook: HOOK,
    text: TEXT,
    catalog: { domain: 'second-capability', catalogModule: 'second/catalog.ts', metadata: {} },
    access: { permission: 'records.view', entityType: 'record' },
    executableAccess: { permission: 'records.admin', entityType: 'extension', metadata: { approval: { class: 'publish', confirmation: 'direct' } } },
    approvalFamily: 'second-family',
    toPreviewDraft: ({ post }) => ({ recordId: post.id, body: post.body }),
  }, {});
  const repo = new InMemoryPluginActivationRepo();
  await repo.save({ pluginId: 'meter', workspaceId: WORKSPACE, version: '1.0.0', enabled: true, updatedAt: '2026-11-09T00:00:00.000Z' } as never);
  const sources = await tools.loadSources({ workspaceId: WORKSPACE, pluginActivationRepo: repo, discoverPlugins: async () => [discovered(hooks)] });
  const preview = vi.fn(async (_pluginId: string, _draft: SecondDraft) => ({ count: 9 }));
  const [registration] = tools.buildRegistrations({
    sources,
    deps: {
      workspaceId: WORKSPACE,
      pluginActivationRepo: repo,
      authorize: async () => ({ allowed: true, reason: 'ok' }),
      postRead: { readRequired: async ({ id }) => ({ id, body: 'hello', ext: { meter: { count: 3 } } }) },
      previewPluginBeforeSave: preview,
    },
    applyApprovalPolicy: ({ registration: r }: { registration: ToolRegistration }) => r,
  });
  const result = await registration!.handler({ input: { postId: 'r1' }, principal: { id: 'p1' } } as never);
  return { source: sources[0]!, preview, result };
}

describe('EXTRACT-S6-FIX capability tools: host-supplied before-save hook id', () => {
  it('a tier-2 plugin declaring the second host hook runs fresh through the preview port', async () => {
    const { source, preview, result } = await run([HOOK]);
    expect(source.runsFresh).toBe(true);
    expect(source.description).toBe('[fresh Meter]');
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith('meter', { recordId: 'r1', body: 'hello' });
    expect(result).toEqual({ postId: 'r1', pluginId: 'meter', computedNow: true, fields: { count: 9 } });
  });

  it('a tier-2 plugin declaring only another host hook id reads stored values', async () => {
    const { source, preview, result } = await run(['content.entry.beforeSave']);
    expect(source.runsFresh).toBe(false);
    expect(source.description).toBe('[stored Meter]');
    expect(preview).not.toHaveBeenCalled();
    expect(result).toEqual({ postId: 'r1', pluginId: 'meter', computedNow: false, fields: { count: 3 } });
  });
});
