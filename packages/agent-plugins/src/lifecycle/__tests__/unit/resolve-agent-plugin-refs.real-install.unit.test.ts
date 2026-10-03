import { test, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAgentPluginLifecycle, createAgentPluginLayout, type AgentPluginArchiveReaderPort } from '../../index.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

// Replaces the consumer's opt-in real-site proof with an isolated, real on-disk installation.
test('a real install injects exact skill markdown and refuses an absent pinned ref', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plugin-real-install-'));
  const layout = createAgentPluginLayout({ root });
  const api = createAgentPluginLifecycle({ ...ports, layout });
  const markdown = '# Interface design\n\nRead the actual installed bytes.\n';
  const archive = Buffer.from('source-archive');
  const files = {
    'plugin.json': JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'interface-design' }),
    'skills/interface-design/SKILL.md': markdown,
  };
  const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
    for (const [entryPath, text] of Object.entries(files)) yield { kind: 'file', entryPath, declaredSize: Buffer.byteLength(text), openReadStream: async function* () { yield Buffer.from(text); } };
  } };
  try {
    await api.installAgentPlugin({ archive, archiveReader, expectedSha256: createHash('sha256').update(archive).digest('hex'), layout, workspaceId: 'workspace-a' });
    const workspaceLayout = layout.forWorkspace({ workspaceId: 'workspace-a' });
    const result = await api.resolveAgentPluginRefs({ pluginRefIds: ['interface-design'], workspaceLayout });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.promptPrefix).toContain(markdown);
    const pointerApi = createAgentPluginLifecycle({ ...ports, layout, deliveryMode: 'pointer', formatPluginToolPointer: ({ pluginId }) => `host_read_plugin({"id":"${pluginId}"})` });
    const pointer = await pointerApi.resolveAgentPluginRefs({ pluginRefIds: ['interface-design'], workspaceLayout });
    expect(pointer.ok).toBe(true);
    if (pointer.ok) {
      expect(pointer.promptPrefix).toContain('host_read_plugin({"id":"interface-design"})');
      expect(pointer.promptPrefix).not.toContain(markdown);
    }
    const override = await pointerApi.resolveAgentPluginRefs({ pluginRefIds: ['interface-design'], workspaceLayout }, { deliveryMode: 'inject' });
    if (!override.ok) throw new Error(override.reason);
    expect(override.promptPrefix).toContain(markdown);
    const absent = await api.resolveAgentPluginRefs({ pluginRefIds: ['not-installed'], workspaceLayout });
    expect(absent.ok).toBe(false);
    if (!absent.ok) expect(absent.reason).toContain('not-installed');
  } finally { await forceRemove(root); }
});
