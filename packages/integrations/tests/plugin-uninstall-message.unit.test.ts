import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createAgentPluginLayout } from '../../agent-plugins/src/lifecycle/layout.js';
import { createNodeAgentPluginEffects } from '../../agent-plugins/src/lifecycle/node.js';
import type { AgentPluginLifecyclePorts } from '../../agent-plugins/src/lifecycle/ports.js';
import { AgentPluginNotUninstallableError, createUninstallModule } from '../../agent-plugins/src/lifecycle/uninstall.js';

// Kept in this package because the fix's edit scope permits only uninstall.ts
// in the sibling package. Exercise its real preview/uninstall refusals, not source text.
it.each(['"bundled"', '{"enabled":"yes","origin":"operator-installed"}'])('names the supplied product in a malformed-entry refusal (%s), removing nothing', async (entry) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jini-uninstall-message-'));
  try {
    const layout = createAgentPluginLayout({ root });
    const workspace = layout.forWorkspace({ workspaceId: 'workspace-1' });
    const digest = 'a'.repeat(64);
    const packageRoot = path.join(workspace.packages, digest);
    const manifest = JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'test-plugin', version: '1.0.0' });
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, 'plugin.json'), manifest);
    const activationsPath = path.join(workspace.root, 'activations.json');
    const activationBytes = `{"schemaVersion":1,"plugins":{"test-plugin":${entry}}}`;
    await writeFile(activationsPath, activationBytes);

    const effects = createNodeAgentPluginEffects({});
    const remove = vi.fn(effects.filesystem.rm.bind(effects.filesystem));
    const rename = vi.fn(effects.filesystem.rename.bind(effects.filesystem));
    const ports: AgentPluginLifecyclePorts = {
      ...effects,
      filesystem: { ...effects.filesystem, rm: remove, rename },
      layout,
      productName: 'Example Studio',
      extensionNamespace: 'org.example.studio',
      deliveryMode: 'inject',
      seededEnabledPluginIds: new Set(),
      retiredBundledPlugins: new Map(),
      bundledArchiveMagic: 'EXAMPLEPKG1\n',
      formatPluginToolPointer: ({ pluginId }) => pluginId,
      fetch: async () => { throw new Error('unexpected network request'); },
      outboundGuard: { assertAllowed: async () => { throw new Error('unexpected outbound URL'); } },
      mcpProvisioning: {
        provision: async () => { throw new Error('unexpected provisioning'); },
        setEnabled: async () => { throw new Error('unexpected activation change'); },
        remove: async () => { throw new Error('unexpected MCP removal'); },
        notifyRosterChanged: async () => { throw new Error('unexpected roster change'); },
      },
    };
    const uninstall = createUninstallModule(ports);
    const request = { layout, workspaceId: 'workspace-1', pluginId: 'test-plugin' };
    const message = "Agent Plugin 'test-plugin' cannot be uninstalled: its entry in this workspace's activation record is malformed, so " +
      'whether it is bundled with Example Studio (and would be re-seeded on the next boot) cannot be established. Nothing was ' +
      'removed. Tell the user an operator has to repair that entry in activations.json first; until then this ' +
      "plugin's tool calls and plugin-pinned runs are refused.";

    for (const operation of [uninstall.previewAgentPluginUninstall, uninstall.uninstallAgentPlugin]) {
      await expect(operation(request)).rejects.toBeInstanceOf(AgentPluginNotUninstallableError);
      await expect(operation(request)).rejects.toThrow(message);
    }
    expect(remove).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect((await stat(packageRoot)).isDirectory()).toBe(true);
    expect(await readdir(workspace.packages)).toEqual([digest]);
    expect(await readFile(path.join(packageRoot, 'plugin.json'), 'utf8')).toBe(manifest);
    expect(await readFile(activationsPath, 'utf8')).toBe(activationBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
