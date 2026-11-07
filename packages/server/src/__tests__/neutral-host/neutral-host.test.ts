/**
 * The neutral host: each moved class must work in a product that is not the one it came from, with
 * memory stores and public `@jini-ai/*` entries only. One `.todo` per class; the batch that moves a
 * class turns its `.todo` into a check here, through the test dispatcher, with the moved tool itself
 * (never a stand-in fixture). The cost counters are read across complete calls, before and after.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  buildAgentPluginSearchRegistrations, buildPluginMemoryRegistrations, createAgentPluginToolGate, loadInstalledAgentPluginToolSources,
  pluginNoteHandler, pluginNoteToolCatalog, pluginNoteRisk, registerInstalledAgentPluginTools, WRITE_PLUGIN_NOTE, type ApplyHostToolApprovalPolicy,
} from '@jini-ai/agent-plugins/lifecycle/host-tools';
import { buildDomainRegistrations, indexCatalogById } from '@jini-ai/core';
import {
  bundledPluginDir, COST_COUNTER_NAMES, countToolCatalog, createNeutralHost, installBundledPlugin, NEUTRAL_PERMISSIONS, NEUTRAL_PRODUCT_NAME,
  scansPerToolCall, SKILLS_ONLY_PLUGIN_IDS, type NeutralHost,
} from './support/index.ts';

let root: string;
let host: NeutralHost;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'neutral-host-'));
  host = createNeutralHost({ root });
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('neutral host harness', () => {
  it('boots as "Another Studio" from public entries, with nothing installed and nothing counted', async () => {
    expect(host.productName).toBe(NEUTRAL_PRODUCT_NAME);
    expect(NEUTRAL_PRODUCT_NAME).toBe('Another Studio');
    expect(await host.lifecycle.listInstalledPlugins({ workspaceRoot: host.workspaceRoot })).toEqual([]);
    expect(Object.values(host.counters.snapshot()).every(count => count === 0)).toBe(true);
    expect(host.provisioning).toEqual([]);
  });

  it('counts one trusted-package scan per scan, and none for a tool call', async () => {
    const before = host.counters.snapshot();
    await host.lifecycle.findTrustedPluginPackages({ workspaceId: host.workspaceId, filename: 'studio-agent-tools.json', contribution: 'agent tools', requireActive: true });
    await expect(host.dispatcher.dispatch({ toolId: 'not_registered', input: {} })).rejects.toThrow();
    const delta = host.counters.since({ before });
    expect(delta.trustedPackageScans).toBe(1);
    expect(delta.toolCalls).toBe(1);
    expect(scansPerToolCall({ counts: { ...delta, trustedPackageScans: 0 } })).toBe(0);
  });

  it('counts vault listings and envelope opens through the memory ports', () => {
    host.vault.put({ workspaceId: host.workspaceId, key: 'a', value: 'one' });
    host.vault.put({ workspaceId: host.workspaceId, key: 'b', value: 'two' });
    host.vault.put({ workspaceId: 'elsewhere', key: 'c', value: 'three' });
    const envelope = host.sealer.seal({ plaintext: 'secret value' });
    expect(host.vault.list({ workspaceId: host.workspaceId })).toHaveLength(2);
    expect(host.sealer.open({ envelope })).toBe('secret value');
    const counts = host.counters.snapshot();
    expect(counts.vaultListCalls).toBe(1);
    expect(counts.vaultListRows).toBe(2);
    expect(counts.vaultListBytes).toBeGreaterThan(0);
    expect(counts.sealerOpens).toBe(1);
    expect(counts.sealerOpenBytes).toBe('secret value'.length);
  });

  it('names every §10 operation as a counter', () => {
    expect(COST_COUNTER_NAMES).toEqual(expect.arrayContaining([
      'sealerOpens', 'vaultListCalls', 'contributionLoads', 'credentialOpens', 'fileReads', 'toolCatalogBytes',
      'trustedPackageScans', 'mailSettingsReads', 'mailCredentialListCalls', 'mailLedgerCalls', 'mailCatalogLoads',
    ]));
  });
});

/** The neutral host's approval policy: every family runs as the kit registered it. */
const asRegistered: ApplyHostToolApprovalPolicy = ({ registration }) => registration;
const toolIdOf = (pluginId: string) => `agent_plugin_${pluginId.replace(/-/g, '_')}`;

async function registerSkillTools(required: { readonly host: NeutralHost }) {
  const { host } = required;
  await registerInstalledAgentPluginTools({ registry: { register: registration => host.dispatcher.register({ registration }) },
    workspaceId: host.workspaceId, ports: host.hostTools, withExtensionApprovalPolicy: asRegistered });
}

/** The note tool, wired the way a host wires it: its catalog, its handler and the host's permission check. */
function registerNoteTool(required: { readonly host: NeutralHost; readonly allow: boolean }) {
  const { host } = required;
  const checks: string[] = [];
  const handler = pluginNoteHandler({ workspaceId: host.workspaceId, ports: host.hostTools, requirePermission: async ({ permission }) => {
    checks.push(permission);
    if (!required.allow) throw new Error(`denied: ${permission}`);
  } });
  for (const registration of buildDomainRegistrations({ domain: 'studio-notes', catalogModule: 'neutral-host', handlers: { [WRITE_PLUGIN_NOTE]: handler },
    catalog: indexCatalogById({ catalog: pluginNoteToolCatalog({ permission: NEUTRAL_PERMISSIONS.enable }) }), derivedRisk: pluginNoteRisk })) {
    host.dispatcher.register({ registration });
  }
  return checks;
}

describe('test dispatcher, with moved tools as they arrive', () => {
  it('denies a call before any I/O (no file read, vault listing or envelope open)', async () => {
    await installBundledPlugin({ host, pluginId: 'site-import' });
    const checks = registerNoteTool({ host, allow: false });
    const before = host.counters.snapshot();
    const record = await host.dispatcher.dispatch({ toolId: WRITE_PLUGIN_NOTE, input: { pluginId: 'site-import', entryPath: 'a.md', text: 'hello' } });
    const delta = host.counters.since({ before });
    expect(record.result.status).not.toBe('completed');
    expect(checks).toEqual([NEUTRAL_PERMISSIONS.enable]);
    expect([delta.fileReads, delta.vaultListCalls, delta.sealerOpens]).toEqual([0, 0, 0]);
    expect(await host.lifecycle.pluginMemory({ workspaceId: host.workspaceId, pluginId: 'site-import' }).list({ kind: 'notes' })).toEqual([]);
  });

  it('denies a revoked skill tool before its handler reads the skill', async () => {
    await installBundledPlugin({ host, pluginId: 'site-import' });
    await registerSkillTools({ host });
    await host.lifecycle.setAgentPluginActivation({ workspaceRoot: host.workspaceRoot, pluginId: 'site-import', enabled: false, actor: 'neutral-host-operator' });
    const before = host.counters.snapshot();
    const record = await host.dispatcher.dispatch({ toolId: toolIdOf('site-import'), input: {} });
    expect(record.result.status).toBe('denied');
    // The gate reads the activation record only; no skill file is opened.
    expect(host.counters.since({ before }).fileReads).toBe(1);
  });

  it('refuses malformed input before the handler runs', async () => {
    await installBundledPlugin({ host, pluginId: 'site-import' });
    await registerSkillTools({ host });
    const checks = registerNoteTool({ host, allow: true });
    const before = host.counters.snapshot();
    const skill = await host.dispatcher.dispatch({ toolId: toolIdOf('site-import'), input: { skill: 'site-import', packageRoot: '/etc' } });
    const note = await host.dispatcher.dispatch({ toolId: WRITE_PLUGIN_NOTE, input: { pluginId: 'site-import', entryPath: 'a.md', text: 'x', extra: true } });
    expect(skill.result.status).not.toBe('completed');
    expect(note.result.status).not.toBe('completed');
    expect(checks).toEqual([]);
    expect(host.counters.since({ before }).fileReads).toBeLessThanOrEqual(1);
    expect(JSON.stringify([skill.result, note.result])).not.toContain(host.root);
  });

  it('leaves no note behind for a call cancelled before it writes', async () => {
    await installBundledPlugin({ host, pluginId: 'site-import' });
    registerNoteTool({ host, allow: true });
    const cancelled = new AbortController();
    cancelled.abort();
    const record = await host.dispatcher.dispatch({ toolId: WRITE_PLUGIN_NOTE, input: { pluginId: 'site-import', entryPath: 'a.md', text: 'hello' } }, { signal: cancelled.signal });
    expect(record.result.status).not.toBe('completed');
    expect(await host.lifecycle.pluginMemory({ workspaceId: host.workspaceId, pluginId: 'site-import' }).list({ kind: 'notes' })).toEqual([]);
  });

  it.todo('raises exactly one human card for a call that needs a person');
  it.todo('asks for ordinary write approval for a write tool, and runs it once approved');
  it.todo('cancels a call waiting on a person, with no effect left behind');
});

describe('moved classes in a neutral host', () => {
  // @jini-ai/agent-plugins/lifecycle/host-tools
  it('skill tool: returns a plugin skill by reading one bounded file, for every skills-only plugin', async () => {
    for (const pluginId of SKILLS_ONLY_PLUGIN_IDS) await installBundledPlugin({ host, pluginId });
    await registerSkillTools({ host });
    const descriptors = host.dispatcher.registry.list({}).filter(descriptor => descriptor.id.startsWith('agent_plugin_') && !descriptor.id.includes('__memory_'));
    expect(descriptors.map(descriptor => descriptor.id).sort()).toEqual(SKILLS_ONLY_PLUGIN_IDS.map(toolIdOf).sort());
    expect(countToolCatalog({ descriptors: descriptors.map(({ id, description, inputSchema }) => ({ id, description, inputSchema })), counters: host.counters })).toBeGreaterThan(0);
    for (const descriptor of descriptors) {
      expect(descriptor.description).not.toMatch(/page\.navigate/);
    }
    for (const pluginId of SKILLS_ONLY_PLUGIN_IDS) {
      const before = host.counters.snapshot();
      const record = await host.dispatcher.dispatch({ toolId: toolIdOf(pluginId), input: {} });
      const delta = host.counters.since({ before });
      expect(record.result.status, pluginId).toBe('completed');
      const output = record.result.output as { pluginId: string; skillName: string; guidance: string; files: string[] };
      expect(output.pluginId).toBe(pluginId);
      const skillFile = await readFile(join(bundledPluginDir({ pluginId }), 'skills', output.skillName, 'SKILL.md'), 'utf8');
      expect(output.guidance.endsWith(skillFile.trimEnd()) || output.guidance.includes(skillFile.trim().slice(0, 200)), pluginId).toBe(true);
      // One bounded SKILL.md read, plus the reader's text check of each supporting file it lists.
      expect(delta.fileReads, pluginId).toBe(1 + output.files.length);
      if (output.files.length === 0) expect(delta.fileReadBytes, pluginId).toBe(Buffer.byteLength(skillFile));
      expect(JSON.stringify(record.result)).not.toContain(host.root);
    }
  });

  it('plugin search: finds installed plugins by the host\'s own names', async () => {
    for (const pluginId of ['site-import', 'site-compliance', 'charts-echarts']) await installBundledPlugin({ host, pluginId });
    for (const registration of buildAgentPluginSearchRegistrations({ workspaceId: host.workspaceId, ports: host.hostTools })) host.dispatcher.register({ registration });
    const listed = await host.dispatcher.dispatch({ toolId: 'search_agent_plugin_local', input: {} });
    expect(listed.result.status).toBe('completed');
    expect(JSON.stringify(listed.result.output)).toContain('site-compliance');
    const ranked = await host.dispatcher.dispatch({ toolId: 'search_agent_plugin_local', input: { query: 'charts', limit: 1 } });
    expect((ranked.result.output as { matches: { pluginId: string }[] }).matches.map(match => match.pluginId)).toEqual(['charts-echarts']);
    const refused = await host.dispatcher.dispatch({ toolId: 'search_agent_plugin_local', input: { offset: -1 } });
    expect(refused.result.status).not.toBe('completed');
  });

  it('plugin memory tools: read and write a plugin\'s own memory', async () => {
    await installBundledPlugin({ host, pluginId: 'site-import' });
    const sources = await loadInstalledAgentPluginToolSources({ workspaceId: host.workspaceId, ports: host.hostTools });
    const gate = createAgentPluginToolGate({ workspaceId: host.workspaceId, ports: host.hostTools });
    for (const registration of buildPluginMemoryRegistrations({ sources, workspaceId: host.workspaceId, ports: host.hostTools, gate, withExtensionApprovalPolicy: asRegistered })) {
      host.dispatcher.register({ registration });
    }
    const id = toolIdOf('site-import');
    expect((await host.dispatcher.dispatch({ toolId: `${id}__memory_read`, input: { entryPath: 'account.md' } })).result.output).toEqual({ pluginId: 'site-import', entryPath: 'account.md', exists: false });
    expect((await host.dispatcher.dispatch({ toolId: `${id}__memory_write`, input: { entryPath: 'account.md', text: 'two sites' } })).result.status).toBe('completed');
    expect((await host.dispatcher.dispatch({ toolId: `${id}__memory_read`, input: { entryPath: 'account.md' } })).result.output).toMatchObject({ text: 'two sites' });
    expect((await host.dispatcher.dispatch({ toolId: `${id}__memory_read`, input: { pluginId: 'other' } })).result.status).not.toBe('completed');
  });

  it('write-note: saves a note under the plugin\'s own state, and the skill tool folds it in', async () => {
    await installBundledPlugin({ host, pluginId: 'site-import' });
    const checks = registerNoteTool({ host, allow: true });
    await registerSkillTools({ host });
    const saved = await host.dispatcher.dispatch({ toolId: WRITE_PLUGIN_NOTE, input: { pluginId: 'site-import', entryPath: 'prefs.md', text: 'Keep slugs.' } });
    expect(saved.result.status).toBe('completed');
    expect(saved.result.output).toMatchObject({ saved: true });
    expect(checks).toEqual([NEUTRAL_PERMISSIONS.enable]);
    const missing = await host.dispatcher.dispatch({ toolId: WRITE_PLUGIN_NOTE, input: { pluginId: 'not-installed', entryPath: 'a.md', text: 'x' } });
    expect(missing.result.status).not.toBe('completed');
    const skill = await host.dispatcher.dispatch({ toolId: toolIdOf('site-import'), input: {} });
    expect((skill.result.output as { guidance: string }).guidance).toContain('Keep slugs.');
  });
  it.todo('provider status: reports configured providers with no product names');
  // @jini-ai/agent-plugins/lifecycle/mail
  it.todo('mail: loads adapters, selects a provider and sends through the host mailer');
  // @jini-ai/server/agent-plugin-host
  it.todo('credential save: saves a key through the host card, never echoing it');
  it.todo('connect: connects a plugin through one card');
  it.todo('access token: issues a token for a connected plugin, with one credential open per lookup');
  it.todo('provisioning: provisions what a plugin declares, through the host ports');
  it.todo('API connection host: calls a declared API connection with the saved credential');
  it.todo('connect orchestration: completes an exchange started by a card');
  it.todo('executable-tool host: runs p_<plugin>__<tool> with the plugin\'s own disclosure and approval');
  // @jini-ai/server/hosted-mcp
  it.todo('MCP store: lists servers, opening each envelope as counted');
  it.todo('MCP sign-in: completes an OAuth exchange for a hosted MCP server');
  it.todo('revocation: revokes a hosted MCP grant and forgets its credential');
  it.todo('vault: plugin-state writes list the workspace vault as counted');
});
