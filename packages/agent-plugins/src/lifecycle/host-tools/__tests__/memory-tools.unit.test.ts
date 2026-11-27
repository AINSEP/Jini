import * as filesystem from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import type { ToolExecutionContext, ToolRegistration } from '@jini-ai/core';
import { createPluginMemory } from '../../../../persistent-state.js';
import { buildPluginMemoryRegistrations } from '../memory-tools.js';
import { pluginNoteHandler, pluginNoteRisk, pluginNoteToolCatalog } from '../write-note-tool.js';
import type { AgentPluginHostToolPorts, ApplyHostToolApprovalPolicy, RequireHostToolPermission } from '../ports.js';

const workspaceId = 'tenant-b';
const pluginId = 'postal';
const permission = 'manage.postal.notes';
const toolContext = (input: unknown, signal = new AbortController().signal): ToolExecutionContext => ({
  executionId: 'notes-execution', run: { id: 'run-b' }, principal: { id: 'user-b' }, input, signal,
});
const source = { id: 'agent_plugin_postal', pluginId, archiveDigest: 'approved-digest' };
const unexpected = () => { throw new Error('unexpected host port call'); };

async function fixture() {
  const root = await filesystem.realpath(await filesystem.mkdtemp(path.join(os.tmpdir(), 'jini-owner-memory-')));
  const workspaceRoot = path.join(root, workspaceId);
  const effects = {
    filesystem, workspaceRoot,
    contain: async ({ root, entryPath }: { root: string; entryPath: string }) => {
      const resolved = path.resolve(root, entryPath);
      if (!resolved.startsWith(root + path.sep)) throw Object.assign(new Error('outside plugin memory'), { code: 'EACCES' });
      return resolved;
    },
    withLock: async <T>({ run }: { run(): Promise<T> }) => run(),
  };
  const pluginMemory = vi.fn<AgentPluginHostToolPorts['memory']['pluginMemory']>(input => {
    if (input.workspaceId !== workspaceId || ![pluginId, 'unrelated'].includes(input.pluginId)) throw new Error('wrong memory owner');
    return createPluginMemory({ ...effects, pluginId: input.pluginId });
  });
  const normalizePackageEntryPath = vi.fn<AgentPluginHostToolPorts['lifecycle']['normalizePackageEntryPath']>(({ rawEntryPath }) => {
    if (rawEntryPath.startsWith('../')) throw new Error('not a package entry');
    return rawEntryPath;
  });
  const listInstalledPlugins = vi.fn<AgentPluginHostToolPorts['lifecycle']['listInstalledPlugins']>(async input => {
    if (input.workspaceRoot !== workspaceRoot) throw new Error('wrong workspace root');
    return [{ pluginId, packageRoot: path.join(workspaceRoot, 'postal-package'), archiveDigest: 'approved-digest', files: [], skills: [] }];
  });
  const ports = {
    memory: { pluginMemory, appendNotes: unexpected },
    permissions: { use: 'read.postal.memory', enable: permission },
    layout: { forWorkspace: (request: { workspaceId: string }) => {
      if (request.workspaceId !== workspaceId) throw new Error('wrong workspace');
      return { root: workspaceRoot, pluginPackagesDir: unexpected };
    } },
    lifecycle: {
      listInstalledPlugins, normalizePackageEntryPath, readBundledAgentPluginDigests: unexpected,
      preferBundledAgentPluginDigests: unexpected, isInstalledDigestPresent: unexpected, readInstalledSkillMarkdown: unexpected,
      readInstalledSkillFile: unexpected, readInstalledMcpServerIds: unexpected, rankInstalledAgentPlugins: unexpected,
    },
  } satisfies Pick<AgentPluginHostToolPorts, 'layout' | 'lifecycle' | 'memory' | 'permissions'>;
  return { ports, root, memory: createPluginMemory({ ...effects, pluginId }), close: () => filesystem.rm(root, { recursive: true, force: true }) };
}

function registrations(ports: Parameters<typeof buildPluginMemoryRegistrations>[0]['ports']) {
  let approvedDigest = source.archiveDigest;
  const families = new Map<string, string>();
  const withExtensionApprovalPolicy: ApplyHostToolApprovalPolicy = ({ registration, family }) => {
    families.set(registration.descriptor.id, family);
    return registration;
  };
  const isCallable = vi.fn(async ({ pluginId, archiveDigest }: { pluginId: string; archiveDigest: string }) =>
    pluginId === source.pluginId && archiveDigest === approvedDigest);
  const result = buildPluginMemoryRegistrations({ withExtensionApprovalPolicy, ports, workspaceId, sources: [source], gate: { isCallable } });
  const get = (name: string): ToolRegistration => {
    const tool = result.find(item => item.descriptor.id === 'agent_plugin_postal__memory_' + name);
    if (!tool) throw new Error('missing ' + name + ' registration');
    return tool;
  };
  return { result, read: get('read'), write: get('write'), families, changeApprovedDigest: () => { approvedDigest = 'different-digest'; } };
}

test('each registration carries its own approval family and stale digests deny further use', async () => {
  const f = await fixture();
  try {
    const reg = registrations(f.ports);
    expect([...reg.families]).toEqual([
      ['agent_plugin_postal__memory_read', 'plugin-memory-read'], ['agent_plugin_postal__memory_write', 'plugin-memory-write'],
    ]);
    expect(reg.read.descriptor).toMatchObject({ readOnly: true, sideEffects: 'none', inputSchema: {
      required: [], additionalProperties: false, properties: { entryPath: { type: 'string' } },
    } });
    expect(reg.write.descriptor).toMatchObject({ readOnly: false, sideEffects: 'mutates-durable-state', inputSchema: {
      required: ['entryPath', 'text'], additionalProperties: false, properties: { entryPath: { type: 'string' }, text: { type: 'string' } },
    } });
    const authorize = (reg: ToolRegistration) => reg.policy.authorize({ ...toolContext({}), tool: reg.descriptor });
    expect(await authorize(reg.read)).toBe('allow');
    expect(await authorize(reg.write)).toBe('allow');
    reg.changeApprovedDigest();
    expect(await authorize(reg.read)).toBe('deny');
    expect(await authorize(reg.write)).toBe('deny');
  } finally { await f.close(); }
});

test('writes learned memory under its bound owner and reads it without exposing user notes', async () => {
  const f = await fixture();
  try {
    const { read, write } = registrations(f.ports);
    await f.memory.writeNote({ entryPath: 'user.md', text: 'Private note' });
    const entryPath = 'observed.md';
    await expect(read.handler(toolContext({ entryPath }))).resolves.toEqual({ pluginId, entryPath, exists: false });
    await expect(write.handler(toolContext({ entryPath, text: 'Café' }))).resolves.toEqual({ relativePath: entryPath, bytes: 5 });
    await expect(f.memory.learned.read({ entryPath })).resolves.toBe('Café');
    await expect(read.handler(toolContext({ entryPath }))).resolves.toEqual({ pluginId, entryPath, text: 'Café' });
    await expect(read.handler(toolContext({}))).resolves.toEqual({ pluginId, entries: [{ relativePath: entryPath, text: 'Café' }] });
    expect(f.ports.memory.pluginMemory.mock.calls).toEqual(Array.from({ length: 4 }, () => [{ workspaceId, pluginId }]));
  } finally { await f.close(); }
});

test('rejects caller-supplied owner/kind and does not disguise non-ENOENT read failures', async () => {
  const fault = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  const learnedRead = vi.fn(async (_input: { entryPath: string }) => { throw fault; });
  const pluginMemory = vi.fn(() => ({ learned: { read: learnedRead, write: unexpected }, list: unexpected, read: unexpected, writeNote: unexpected }));
  const { read, write } = registrations({ memory: { pluginMemory, appendNotes: unexpected }, permissions: { use: 'use', enable: 'enable' } });
  await expect(read.handler(toolContext({ pluginId: 'unrelated' }))).rejects.toThrow('Memory tool accepts no plugin id, kind, or other fields');
  await expect(write.handler(toolContext({ kind: 'notes', entryPath: 'x.md', text: 'x' }))).rejects.toThrow('Memory tool accepts no plugin id, kind, or other fields');
  expect(pluginMemory.mock.calls).toEqual([]);
  await expect(read.handler(toolContext({ entryPath: 'existing.md' }))).rejects.toBe(fault);
  expect(pluginMemory.mock.calls).toEqual([[{ workspaceId, pluginId }]]);
  expect(learnedRead.mock.calls).toEqual([[{ entryPath: 'existing.md' }]]);
});

test('note tool uses the host permission and writes user notes, not learned facts', async () => {
  const f = await fixture();
  try {
    const requirePermission = vi.fn<RequireHostToolPermission>(async () => {});
    const writeNote = pluginNoteHandler({ workspaceId, requirePermission, ports: f.ports });
    const entryPath = 'project.md';
    const toolId = 'agent_plugin_write_note';
    expect(pluginNoteToolCatalog({ permission }).find(item => item.name === toolId)).toMatchObject({
      authorization: { permission }, sideEffects: 'mutates-durable-state',
      inputSchema: { required: ['pluginId', 'entryPath', 'text'], additionalProperties: false },
    });
    expect(pluginNoteRisk.get(toolId)).toBe('mutates-durable-state');
    await expect(writeNote(toolContext({ pluginId, entryPath, text: 'Café' }))).resolves
      .toEqual({ saved: true, relativePath: entryPath, bytes: 5 });
    await expect(f.memory.list({ kind: 'notes' })).resolves.toEqual([{ relativePath: entryPath, text: 'Café' }]);
    await expect(f.memory.list({ kind: 'learned' })).resolves.toEqual([]);
    expect(requirePermission.mock.calls).toEqual([[{ workspaceId, principalId: 'user-b', permission }, { entityType: 'agent-plugin', entityId: pluginId }]]);
    expect(f.ports.lifecycle.normalizePackageEntryPath.mock.calls).toEqual([[{ rawEntryPath: entryPath }]]);
  } finally { await f.close(); }
});

test.each([
  [{ extra: true }, 'Unexpected note field'],
  [{ entryPath: '../other.txt' }, 'not a package entry'],
  [{ text: 'é'.repeat(8193) }, 'Note is not valid bounded UTF-8 text'],
  [{ text: 'left\0right' }, 'Note is not valid bounded UTF-8 text'],
] as const)('rejects invalid note input %j before checking permission or opening memory', async (override, message) => {
  const f = await fixture();
  try {
    const requirePermission = vi.fn<RequireHostToolPermission>(async () => {});
    const writeNote = pluginNoteHandler({ workspaceId, requirePermission, ports: f.ports });
    await expect(writeNote(toolContext({ pluginId, entryPath: 'project.md', text: 'keep in notes', ...override }))).rejects.toThrow(message);
    expect(requirePermission.mock.calls).toEqual([]);
    expect(f.ports.memory.pluginMemory.mock.calls).toEqual([]);
  } finally { await f.close(); }
});

test('denied, uninstalled and abandoned note requests never open plugin memory', async () => {
  const f = await fixture();
  try {
    const requirePermission = vi.fn<RequireHostToolPermission>(async () => {});
    const writeNote = pluginNoteHandler({ workspaceId, requirePermission, ports: f.ports });
    const input = { pluginId, entryPath: 'project.md', text: 'keep in notes' };
    requirePermission.mockRejectedValueOnce(new Error('note write denied'));
    await expect(writeNote(toolContext(input))).rejects.toThrow('note write denied');
    expect(f.ports.lifecycle.listInstalledPlugins.mock.calls).toEqual([]);
    await expect(writeNote(toolContext({ ...input, pluginId: 'unrelated' }))).rejects.toThrow('Agent Plugin is not installed');
    const controller = new AbortController();
    requirePermission.mockImplementationOnce(async () => { controller.abort(); });
    await expect(writeNote(toolContext(input, controller.signal))).resolves.toEqual({ saved: false, reason: 'abandoned' });
    expect(f.ports.memory.pluginMemory.mock.calls).toEqual([]);
    await expect(f.memory.list({ kind: 'notes' })).resolves.toEqual([]);
  } finally { await f.close(); }
});
