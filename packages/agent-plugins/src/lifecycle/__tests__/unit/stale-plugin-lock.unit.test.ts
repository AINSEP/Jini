import { expect, test } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readBootIdentity } from '@jini-ai/platform/fs/file-lock';
import { createAgentPluginLayout, createAgentPluginLifecycle, type AgentPluginArchiveReaderPort } from '../../index.js';
import { createNodeAgentPluginEffects } from '../../node.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

/**
 * Demo practice run (2026-11-02): on every boot of one site an Agent Plugin timed out on a file lock
 * and stayed off. Its per-plugin state lock never ages out (`staleMs: Infinity`), so a lock a killed
 * process left behind is reclaimed only once its owner is PROVEN dead, and a holder on another host is
 * never probed. macOS reports one machine as `name.lan` or `name.local` as its network changes, and
 * the lifecycle's process port recorded no boot, so the lock read as foreign forever. The node port
 * now records the kernel boot, and the same first label in the same boot proves the same machine.
 */
const workspaceId = 'workspace-a';
const DEAD_PID = 4242;

function archiveInput(layout: ReturnType<typeof createAgentPluginLayout>, pluginId: string) {
  const files = {
    'plugin.json': JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: pluginId, version: '1.0.0' }),
    [`skills/${pluginId}/SKILL.md`]: `# ${pluginId}\nGuidance.`,
  };
  const archive = Buffer.from(JSON.stringify(files));
  const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
    for (const [entryPath, text] of Object.entries(files)) yield { kind: 'file', entryPath, openReadStream: async function* () { yield Buffer.from(text); } };
  } };
  return { archive, archiveReader, expectedSha256: createHash('sha256').update(archive).digest('hex'), layout, workspaceId };
}

test('the node process port records the kernel boot its locks are taken in', () => {
  expect(createNodeAgentPluginEffects({}).process.bootIdentity?.()).toEqual(readBootIdentity({}));
});

test('an enable reclaims a plugin state lock a killed process left under another hostname spelling', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-stale-lock-'));
  try {
    const layout = createAgentPluginLayout({ root: path.join(temp, 'plugins') });
    // The lock wait runs on the monotonic clock; advancing it on every sleep makes the 15 s budget instant.
    let monotonic = 0;
    const node = createNodeAgentPluginEffects({});
    const context = { ...ports, layout,
      clock: { ...node.clock, monotonicMs: () => monotonic, sleep: async ({ ms }: { ms: number }) => { monotonic += ms; } },
      process: { ...node.process, hostname: () => 'LAs-MacBook-Pro.local',
        isAlive: ({ pid }: { pid: number }) => pid !== DEAD_PID && node.process.isAlive({ pid }) } };
    const api = createAgentPluginLifecycle(context);
    await api.installAgentPlugin(archiveInput(layout, 'composio'));
    const workspaceRoot = layout.forWorkspace({ workspaceId }).root;
    const lockPath = path.join(workspaceRoot, 'staging', '.plugin-state-composio.lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify({ pid: DEAD_PID, hostname: 'LAs-MacBook-Pro.lan', token: 'killed-boot',
      acquiredAt: new Date().toISOString(), bootId: readBootIdentity({})!.id }));

    await expect(api.setAgentPluginEnabled({ workspaceId, pluginId: 'composio', enabled: true, actor: 'operator:alice' }))
      .resolves.toEqual({ pluginId: 'composio', enabled: true });
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await forceRemove(temp); }
});
