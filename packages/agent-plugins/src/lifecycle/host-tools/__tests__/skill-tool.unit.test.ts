import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import type { ToolExecutionContext, ToolRegistration } from '@jini-ai/core';
import type { InstalledAgentPlugin } from '@jini-ai/core/contracts/site/agent-plugins-lifecycle';
import { createAgentPluginLifecycle } from '../../index.js';
import { createAgentPluginLayout } from '../../layout.js';
import { ports as nativePorts } from '../../__tests__/test-support.js';
import { buildAgentPluginToolRegistrations, loadInstalledAgentPluginToolSources, registerInstalledAgentPluginTools, summarizeSkillMarkdown } from '../skill-tool.js';
import type { AgentPluginHostToolPorts, ApplyHostToolApprovalPolicy, HostGuidancePort } from '../ports.js';

const workspaceId = 'skill-workspace';
const pluginId = 'studio-docs';
const toolId = 'agent_plugin_studio_docs';
const workspace = { workspaceId };
const call = (input: unknown): ToolExecutionContext => ({
  input, executionId: 'skill-call', run: { id: 'read-docs' }, principal: { id: 'owner' }, signal: new AbortController().signal,
});
const unexpected = () => { throw new Error('unexpected tool port call'); };
const notice = "Before saving keys or acting with this plugin, tell the user this integration hasn't been tested end to end yet. It may not work.";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jini-tool-skills-'));
  const layout = createAgentPluginLayout({ root });
  const workspaceRoot = layout.forWorkspace(workspace).root;
  const digest = 'c'.repeat(64);
  const packagesDir = layout.forWorkspace(workspace).pluginPackagesDir({ pluginId });
  const packageRoot = path.join(packagesDir, digest);
  const primary = 'skills/studio-docs/SKILL.md';
  const alternative = 'skills/citation-format/SKILL.md';
  await mkdir(path.join(packageRoot, 'skills', 'studio-docs', 'references'), { recursive: true });
  await mkdir(path.join(packageRoot, 'skills', 'citation-format'), { recursive: true });
  await writeFile(path.join(packageRoot, 'plugin.json'), JSON.stringify({
    name: pluginId, keywords: ['writers'], extensions: { jini: { id: 'studio/docs', provides: ['cap:document'], maturity: 'untested' } },
  }));
  await writeFile(path.join(packageRoot, primary), '# Start here\n\nDraft a project brief.');
  await writeFile(path.join(packageRoot, alternative), '---\ndescription: Use short citations\n---\n\n# Citations');
  await writeFile(path.join(packageRoot, 'skills', 'studio-docs', 'references', 'brief.md'), 'Use three sections.');
  const installed: InstalledAgentPlugin = {
    pluginId, archiveDigest: digest, packageRoot, skills: [
      { name: 'citation-format', skillPath: alternative }, { name: pluginId, skillPath: primary },
    ], files: [],
  };
  const lifecycle = createAgentPluginLifecycle({ ...nativePorts, layout });
  let indexed: readonly InstalledAgentPlugin[] = [installed];
  let verdict: Awaited<ReturnType<AgentPluginHostToolPorts['activations']['resolveAgentPluginActivation']>> = { verdict: 'active' };
  let present = true;
  const resolveAgentPluginActivation = vi.fn<AgentPluginHostToolPorts['activations']['resolveAgentPluginActivation']>(async input => {
    if (input.workspaceRoot !== workspaceRoot || input.pluginId !== pluginId) throw new Error('wrong activation scope');
    return verdict;
  });
  const isInstalledDigestPresent = vi.fn<AgentPluginHostToolPorts['lifecycle']['isInstalledDigestPresent']>(async input =>
    input.packagesDir === packagesDir && input.archiveDigest === digest && present);
  const appendNotes = vi.fn<AgentPluginHostToolPorts['memory']['appendNotes']>(async ({ workspaceId: site, pluginId: id, guidance }) => {
    if (site !== workspaceId || id !== pluginId) throw new Error('wrong note boundaries');
    return guidance + '\n\nOperator note: Use a short brief.';
  });
  const readInstalledSkillFile = vi.fn(lifecycle.readInstalledSkillFile);
  const warn = vi.fn();
  const ports: AgentPluginHostToolPorts = {
    ...lifecycle, layout,
    lifecycle: {
      ...lifecycle, readInstalledSkillFile,
      listInstalledPlugins: async input => {
        if (input.workspaceRoot !== workspaceRoot) throw new Error('wrong installed catalog');
        return indexed;
      },
      readBundledAgentPluginDigests: async () => new Map(), isInstalledDigestPresent,
    },
    activations: {
      ...lifecycle, resolveAgentPluginActivation,
      readAgentPluginActivations: async () => ({ schemaVersion: 1, plugins: {} }),
    },
    memory: { pluginMemory: unexpected, appendNotes },
    permissions: { use: 'workspace.guidance', enable: 'workspace.enable' },
    readFrontmatterField: ({ markdown, key }) => key === 'description' ? /^---\ndescription: ([^\n]+)\n---/.exec(markdown)?.[1] : undefined,
    messages: { pluginToolNavigation: 'Use the Workspace panel for installation.' },
    report: { warn },
  };
  return {
    ports, installed, warn, readInstalledSkillFile, appendNotes, primary, packagesDir, workspaceRoot,
    setIndexed: (next: readonly InstalledAgentPlugin[]) => { indexed = next; },
    disable: () => { verdict = { verdict: 'inactive' }; },
    uninstall: () => { present = false; verdict = { verdict: 'active' }; },
    isInstalledDigestPresent, close: () => rm(root, { recursive: true, force: true }),
  };
}

test('summarizes the first prose line and gives a readable name for an otherwise empty skill', () => {
  const ports = { readFrontmatterField: () => undefined };
  expect(summarizeSkillMarkdown({ skillName: 'long--form', markdown: '# Heading\n\n  Literal   prose.\nIgnore this line.', ports })).toBe('Literal prose.');
  expect(summarizeSkillMarkdown({ skillName: 'long--form', markdown: '# Heading\n\n ## Another heading', ports }))
    .toBe('Long Form guidance and reference material.');
});

test('boot registers real guidance with eponymous selection, contained file reads and a live activation-and-digest gate', async () => {
  const f = await fixture();
  try {
    const registered = new Map<string, ToolRegistration>();
    const withExtensionApprovalPolicy: ApplyHostToolApprovalPolicy = ({ registration }) => registration;
    await registerInstalledAgentPluginTools({
      ports: f.ports, workspaceId, withExtensionApprovalPolicy, registry: { register: registration => {
        const id = registration.descriptor.id;
        if (registered.has(id)) throw new Error('duplicate registration: ' + id);
        registered.set(id, registration);
      } },
    });
    expect([...registered.keys()]).toEqual([toolId, toolId + '__memory_read', toolId + '__memory_write']);
    const reg = registered.get(toolId)!;
    expect(reg.descriptor.description).toContain("returns this plugin's own eponymous 'studio-docs' skill");
    expect(reg.descriptor.description).toContain('Citation Format (citation-format) — Use short citations');
    expect(reg.descriptor.description).toContain('Use the Workspace panel for installation.');
    expect(reg.descriptor.description).toContain('studio/docs writers cap:document');
    const authorize = () => reg.policy.authorize({ ...call(undefined), tool: reg.descriptor });
    expect(await authorize()).toBe('allow');
    const guidance = await reg.handler(call(undefined));
    expect(guidance).toMatchObject({
      pluginId, maturity: 'untested', skillName: pluginId,
      guidance: notice + '\n\n# Start here\n\nDraft a project brief.\n\nOperator note: Use a short brief.',
      files: ['references/brief.md'],
      availableSkills: [{ name: 'citation-format', description: 'Use short citations' }],
    });
    await expect(reg.handler(call({ file: 'references/brief.md' }))).resolves.toMatchObject({
      guidance: notice + '\n\nUse three sections.\n\nOperator note: Use a short brief.',
    });
    expect(f.readInstalledSkillFile.mock.calls).toEqual([
      [{ packageRoot: f.installed.packageRoot, skillPath: f.primary }, {}],
      [{ packageRoot: f.installed.packageRoot, skillPath: f.primary }, { file: 'references/brief.md' }],
    ]);
    f.disable();
    expect(await authorize()).toBe('deny');
    expect(f.isInstalledDigestPresent.mock.calls).toEqual([[{ packagesDir: f.packagesDir, archiveDigest: f.installed.archiveDigest }]]);
    f.uninstall();
    expect(await authorize()).toBe('deny');
    expect(f.isInstalledDigestPresent.mock.calls).toHaveLength(2);
  } finally { await f.close(); }
});

test('retracts all ambiguous revisions without losing unrelated valid sources', async () => {
  const f = await fixture();
  try {
    const competing = { ...f.installed, archiveDigest: 'd'.repeat(64) };
    const unrelated = { ...f.installed, pluginId: 'copy', archiveDigest: 'e'.repeat(64),
      skills: f.installed.skills.filter(skill => skill.name === 'citation-format') };
    f.setIndexed([f.installed, competing, f.installed, unrelated]);
    const [only, ...rest] = await loadInstalledAgentPluginToolSources({ workspaceId, ports: f.ports });
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ id: 'agent_plugin_copy', pluginId: 'copy', defaultSkillName: 'citation-format',
      defaultSkillReason: "no eponymous skill folder ('skills/copy/SKILL.md') exists in this installed package — defaulting to its alphabetically-first skill" });
    expect(f.warn.mock.calls.map(([data]) => data)).toEqual([{ message: 'Plugin tool source skipped.' }]);
  } finally { await f.close(); }
});

test('unknown skills/files return safe recovery and a wrong argument fails instead of reading the default', async () => {
  const registrations = buildAgentPluginToolRegistrations({
    sources: [{ id: toolId, pluginId, archiveDigest: 'pinned', description: 'Read guidance', defaultSkillName: 'draft',
      skills: [{ name: 'draft', summary: 'Draft a brief', markdown: 'Write an outline first.' }] }],
    withExtensionApprovalPolicy: ({ registration }) => registration,
    gate: { isCallable: async ({ archiveDigest }) => archiveDigest === 'pinned' },
    ports: { permissions: { use: 'read', enable: 'enable' } },
  });
  const reg = registrations.find(registration => registration.descriptor.id === toolId)!;
  await expect(reg.handler(call({ skill: '/private/chosen/path', file: 'unknown.md' }))).resolves.toEqual({
    pluginId, skillName: 'draft', guidance: 'Write an outline first.', files: [], availableSkills: [],
    note: "Unrecognized skill for the 'studio-docs' plugin — showing the default skill 'draft' instead. Valid values: draft. File request refused: no supporting-file reader is available. Valid supporting files: (none).",
  });
  await expect(reg.handler(call({ source: 'anything' }))).rejects.toThrow("this tool accepts only optional 'skill' and 'file' arguments — unexpected field(s): source");
});

test('a host-owned supporting file is routed to the overlay and preserves the maturity and note order', async () => {
  const f = await fixture();
  try {
    const registered = new Map<string, ToolRegistration>();
    const hostFile = 'host/brief.md';
    const deliver = vi.fn<HostGuidancePort['deliver']>(async ({ result, file }, options) => {
      if (result.pluginId !== pluginId || file !== hostFile || options?.notice !== notice) throw new Error('wrong overlay route or maturity');
      return { guidance: notice + '\n\nHost rules for writing a brief.', files: ['references/brief.md', hostFile] };
    });
    await registerInstalledAgentPluginTools({
      ports: f.ports, workspaceId, withExtensionApprovalPolicy: ({ registration }) => registration,
      registry: { register: item => { registered.set(item.descriptor.id, item); } },
    }, { hostGuidance: { isFileRequest: ({ file }) => file.startsWith('host/'), deliver } });
    const tool = registered.get(toolId)!;
    const context = call({ skill: pluginId, file: hostFile });
    expect(await tool.policy.authorize({ ...context, tool: tool.descriptor })).toBe('allow');
    await expect(tool.handler(context)).resolves.toMatchObject({
      pluginId, skillName: pluginId, maturity: 'untested',
      guidance: notice + '\n\nHost rules for writing a brief.\n\nOperator note: Use a short brief.',
      files: ['references/brief.md', hostFile],
    });
    expect(f.readInstalledSkillFile.mock.calls).toEqual([[{ packageRoot: f.installed.packageRoot, skillPath: f.primary }, {}]]);
    expect(deliver.mock.calls[0]?.[0].file).toBe(hostFile);
    expect(f.appendNotes.mock.calls).toEqual([[{ workspaceId, pluginId, guidance: notice + '\n\nHost rules for writing a brief.' }]]);
  } finally { await f.close(); }
});
