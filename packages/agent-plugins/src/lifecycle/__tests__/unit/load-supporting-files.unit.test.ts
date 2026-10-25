import { expect, test, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentPluginLifecycle, createAgentPluginLayout, createAutomaticAgentPluginUse } from '../../index.js';
import type { AutomaticAgentPluginPorts } from '../../automatic-use.js';
import type { FilesystemPort } from '../../ports.js';
import type { AgentPluginSearchCandidate } from '../../search.js';
import { ports } from '../test-support.js';

// Real resolver/containment/reader over injected activation, digest, catalog, consent and filesystem ports.
test('enable, load and supporting reads share admission after loading, including revocation and refused files', async () => {
  const root = await filesystem.realpath(await filesystem.mkdtemp(path.join(tmpdir(), 'plugin-supporting-')));
  const layout = createAgentPluginLayout({ root });
  const workspace = layout.forWorkspace({ workspaceId: 'workspace-a' });
  const pluginId = 'synthetic';
  const packageRoot = path.join(workspace.root, pluginId, 'package', 'sha256', 'a'.repeat(64));
  const skillRoot = path.join(packageRoot, 'skills', pluginId);
  let enabled = false;
  let active = false;
  let trusted = true;
  const injectedFilesystem: FilesystemPort = { ...filesystem,
    readFile: (async (filename: Parameters<FilesystemPort['readFile']>[0], options: Parameters<FilesystemPort['readFile']>[1]) => {
      if (String(filename) === path.join(workspace.root, 'activations.json')) return JSON.stringify({ schemaVersion: 1, plugins: { [pluginId]: { enabled: active, origin: 'bundled', updatedAt: '2026-10-25T00:00:00.000Z', updatedBy: 'approved-test-operator' } } });
      if (String(filename) === path.join(workspace.root, 'bundled-digests.json')) return JSON.stringify({ schemaVersion: 1, plugins: { [pluginId]: { archiveDigest: (trusted ? 'a' : 'b').repeat(64) } } });
      return filesystem.readFile(filename, options);
    }) as FilesystemPort['readFile'],
  };
  const api = createAgentPluginLifecycle({ ...ports, layout, filesystem: injectedFilesystem });
  const candidate = (): AgentPluginSearchCandidate => ({ pluginId, enabled, keywords: [], skills: [], mcpServerIds: [] });
  const publish = vi.fn();
  const ask = vi.fn(async () => ({ action: 'use' as const, selected: [pluginId] }));
  const resolve = vi.fn(({ pluginId: id, ...request }: Parameters<AutomaticAgentPluginPorts['resolve']>[0]) => api.resolveAgentPluginRefs({ pluginRefIds: [id], workspaceLayout: workspace }, { deliveryMode: 'inject', ...request }));
  const makeController = (excluded: string[] = []) => createAutomaticAgentPluginUse({ mode: 'ask', state: { decision: null, excluded }, ports: {
    list: async () => [candidate()], rank: () => [], resolve, ask, publish, saveAuto: async () => {}, formatPluginToolPointer: ports.formatPluginToolPointer,
  } });
  try {
    await filesystem.mkdir(path.join(skillRoot, 'references'), { recursive: true });
    await filesystem.mkdir(path.join(packageRoot, 'skills', 'other'), { recursive: true });
    await filesystem.writeFile(path.join(packageRoot, 'plugin.json'), JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: pluginId }));
    await filesystem.writeFile(path.join(skillRoot, 'SKILL.md'), '# Primary guidance: read references/permissions.md first.');
    await filesystem.writeFile(path.join(packageRoot, 'skills', 'other', 'SKILL.md'), '# Other declared skill');
    await filesystem.writeFile(path.join(skillRoot, 'references', 'permissions.md'), 'Exact permissions reference.');
    await filesystem.writeFile(path.join(skillRoot, 'oversized.md'), 'x'.repeat(256 * 1024 + 1));
    await filesystem.writeFile(path.join(root, 'outside.md'), 'OUTSIDE_CANARY');
    await filesystem.symlink(path.join(root, 'outside.md'), path.join(skillRoot, 'escape.md'));
    const controller = makeController();
    const request = { pluginId, skill: pluginId, file: 'references/permissions.md' };
    expect(await controller.load(request)).toEqual({ status: 'installed-but-inactive', guidance: '' });
    expect(resolve).not.toHaveBeenCalled();
    // Models the existing approved-enable owner changing activation; loading never writes activation.
    enabled = true; active = true;
    const loaded = await controller.load({ pluginId });
    expect(loaded.status).toBe('loaded');
    expect(loaded.guidance).toContain('host_read_plugin({"pluginId":"synthetic","skill":"synthetic","file":"<relative path>"})');
    expect(loaded.guidance).not.toContain('load_agent_plugin');
    expect(loaded.guidance).not.toContain('agent_plugin_synthetic');
    expect(await controller.load({ pluginId })).toEqual({ status: 'already-loaded', guidance: '' });
    const reference = await controller.load(request);
    expect(reference.status).toBe('loaded');
    expect(reference.guidance).toContain('Exact permissions reference.');
    expect(reference.guidance).not.toContain(root);
    expect(ask).toHaveBeenCalledTimes(1);
    expect((await controller.load({ pluginId, skill: 'other' })).guidance).toContain('# Other declared skill');
    for (const [file, refusal] of [
      ['../other/SKILL.md', 'use a path relative to this skill folder, without traversal or absolute paths.'],
      ['escape.md', 'file is missing, unreadable, or resolves outside this skill folder.'],
      ['oversized.md', 'exceeds the 256 KiB text limit; no content returned.'],
    ] as const) {
      expect(await controller.load({ ...request, file })).toEqual({ status: 'unavailable', guidance: `File request refused: ${refusal} Valid supporting files: references/permissions.md. Omit file to request SKILL.md.` });
    }
    expect(await controller.load({ ...request, skill: '../other' })).toEqual({ status: 'unavailable', guidance: "Agent Plugin 'synthetic' has no readable 'skills/../other/SKILL.md' in its installed package: no such skill folder" });
    // A stale enabled catalog cannot override the resolver's fresh activation check.
    active = false;
    const inactive = await controller.load(request);
    expect(inactive.status).toBe('unavailable');
    expect(inactive.guidance).toContain('is installed in this workspace but is not enabled');
    expect(inactive.guidance).not.toContain(root);
    active = true; trusted = false;
    const untrusted = await controller.load(request);
    expect(untrusted.status).toBe('untrusted');
    expect(untrusted.guidance).toContain('only plugins shipped with the host may add agent guidance');
    expect(untrusted.guidance).not.toContain(root);
    trusted = true;
    const calls = resolve.mock.calls.length;
    expect(await makeController([pluginId]).load(request)).toEqual({ status: 'excluded', guidance: '' });
    expect(resolve).toHaveBeenCalledTimes(calls);
    expect(await controller.load({ ...request, signal: AbortSignal.abort() })).toEqual({ status: 'cancelled', guidance: '' });
    const referenceOnly = makeController();
    await referenceOnly.load(request);
    expect((await referenceOnly.load({ pluginId })).status).toBe('loaded');
    const pinned = makeController();
    await pinned.prepare({ loaded: [pluginId] });
    expect((await pinned.load(request)).guidance).toContain('Exact permissions reference.');
    expect((await pinned.load({ pluginId })).status).toBe('already-loaded');
  } finally { await filesystem.rm(root, { recursive: true, force: true }); }
});
