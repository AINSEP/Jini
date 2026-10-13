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
    'skills/interface-design/references/foundations.md': 'A stable visual foundation precedes individual screens.\n',
    'skills/interface-design/examples/card.tsx': 'export const Card = () => <section />;\n',
    'skills/interface-design/resources/image.png': 'NOT_READABLE_TEXT',
    'skills/other-skill/SKILL.md': '# Other skill\n',
  };
  const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
    for (const [entryPath, text] of Object.entries(files)) yield { kind: 'file', entryPath, declaredSize: Buffer.byteLength(text), openReadStream: async function* () { yield Buffer.from(text); } };
  } };
  try {
    const installed = await api.installAgentPlugin({ archive, archiveReader, expectedSha256: createHash('sha256').update(archive).digest('hex'), layout, workspaceId: 'workspace-a' });
    const workspaceLayout = layout.forWorkspace({ workspaceId: 'workspace-a' });
    const result = await api.resolveAgentPluginRefs({ pluginRefIds: ['interface-design'], workspaceLayout });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.promptPrefix).toContain(markdown);
    expect(result.promptPrefix).toContain('files: ["examples/card.tsx","references/foundations.md"]');
    expect(result.promptPrefix).toContain("skill 'interface-design' and file '<relative path>'");
    expect(result.promptPrefix).not.toContain(installed.packageRoot);
    expect(result.promptPrefix).not.toContain(root);
    expect(result.promptPrefix).not.toContain('NOT_READABLE_TEXT');
    expect(result.promptPrefix).not.toContain('# Other skill');
    const reference = await api.readInstalledSkillFile({ packageRoot: installed.packageRoot, skillPath: 'skills/interface-design/SKILL.md' }, { file: 'references/foundations.md' });
    expect(reference).toEqual({ text: 'A stable visual foundation precedes individual screens.\n', files: ['examples/card.tsx', 'references/foundations.md'] });
    const sibling = await api.readInstalledSkillFile({ packageRoot: installed.packageRoot, skillPath: 'skills/interface-design/SKILL.md' }, { file: '../other-skill/SKILL.md' });
    expect(sibling.text).toBe('');
    expect(sibling.note).toContain('File request refused:');
    expect(sibling.files).toEqual(reference.files);
    expect(JSON.stringify(sibling)).not.toContain(installed.packageRoot);
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
