import { test, expect } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAgentPluginLifecycle, createAgentPluginLayout, AgentPluginInstallError, type AgentPluginArchiveReaderPort } from '../../index.js';
import { ports } from '../test-support.js';
import { forceRemove } from '../fixtures/force-remove.js';

// Generalized URL pipeline assertions use injected transport/archive ports and actual disk I/O.
test('pinned URL install verifies the independent digest, TOFU is labelled, and bad pins never extract', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plugin-url-install-'));
  const layout = createAgentPluginLayout({ root });
  const bytes = Buffer.from('archive-bytes');
  // An install iterates entries twice (a metadata-only limits pass, then extraction), so an
  // extraction is counted when the manifest's content is read, not when entries is called.
  let readerCalls = 0;
  let extractions = 0;
  const archiveReader: AgentPluginArchiveReaderPort = { async *entries() {
    readerCalls++;
    for (const [entryPath, text] of Object.entries({
      'plugin.json': JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'fixture' }),
      'skills/fixture/SKILL.md': '# Exact installed guidance\n',
    })) yield { kind: 'file', entryPath, declaredSize: Buffer.byteLength(text), openReadStream: async function* () {
      if (entryPath === 'plugin.json') extractions++;
      yield Buffer.from(text);
    } };
  } };
  const api = createAgentPluginLifecycle({ ...ports, layout, fetch: async () => new Response(bytes), outboundGuard: { assertAllowed: async () => {} } });
  const input = { url: 'https://example.com/package.zip', layout, workspaceId: 'workspace-a', archiveReader };
  try {
    await expect(api.installAgentPluginFromUrl({ ...input, integrity: { kind: 'pinned', sha256: '0'.repeat(64) } })).rejects.toBeInstanceOf(AgentPluginInstallError);
    expect(readerCalls).toBe(0);
    expect(await readdir(root)).toEqual([]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const pinned = await api.installAgentPluginFromUrl({ ...input, integrity: { kind: 'pinned', sha256 } });
    expect(pinned.digestWasPinned).toBe(true);
    expect(await readFile(path.join(pinned.installed.packageRoot, 'skills/fixture/SKILL.md'), 'utf8')).toBe('# Exact installed guidance\n');
    const tofu = await api.installAgentPluginFromUrl({ ...input, integrity: { kind: 'trust-on-first-use' } });
    expect(tofu.digestWasPinned).toBe(false);
    expect(tofu.sha256).toBe(sha256);
    expect(extractions).toBe(1);
  } finally { await forceRemove(root); }
});
