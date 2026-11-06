import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createAgentPluginLifecycle } from '../../index.js';
import { ports } from '../test-support.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const pluginNames = (await readdir(root, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .filter(name => existsSync(path.join(root, name, 'plugin.json')));
const host = createAgentPluginLifecycle({
  ...ports,
  productName: 'Another Studio',
  extensionNamespace: 'another-studio',
  formatPluginToolPointer: ({ pluginId }) => `Read the ${pluginId} instructions`,
});

// Use the public lifecycle as a second host would, with no application imports or metadata adapter.
test.each(pluginNames)('%s loads unchanged in another host', async pluginId => {
  const packageRoot = path.join(root, pluginId);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'plugin.json'), 'utf8'));
  expect(manifest.extensions.jini).toBeDefined();
  expect(manifest.extensions.tovu).toBeUndefined();
  const installed = await host.indexInstalledRoot({ packageRoot, archiveDigest: 'test-digest' });
  expect(installed.id).toBe(manifest.extensions.jini.id);
  expect(installed.provides).toEqual(manifest.extensions.jini.provides ?? []);
  expect(installed.displayName).toBe(manifest.extensions.jini.displayName?.trim());
  const config = existsSync(path.join(packageRoot, 'mcp.json'))
    ? JSON.parse(await readFile(path.join(packageRoot, 'mcp.json'), 'utf8')) : { mcpServers: {} };
  const servers = await host.readInstalledMcpServers({ packageRoot });
  expect(Object.keys(servers).sort()).toEqual(Object.keys(config.mcpServers).sort());
  for (const [serverId, metadata] of Object.entries(manifest.extensions.jini.mcpServers ?? {}) as [string, { authMode?: string; defaultTools?: unknown }][]) {
    expect(servers[serverId]).toMatchObject(metadata);
  }
  const skillFiles = (await readdir(packageRoot, { recursive: true }))
    .filter(file => file.startsWith('skills/') && file.endsWith('/SKILL.md')).sort();
  expect(installed.skills.map(skill => skill.skillPath).sort()).toEqual(skillFiles);
  for (const skill of installed.skills) {
    const result = await host.readInstalledSkillFile({ packageRoot, skillPath: skill.skillPath });
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).not.toMatch(/tovu|agent_plugin_connect|media_import_from_url|credential_save/iu);
    const skillRoot = path.dirname(path.join(packageRoot, skill.skillPath));
    for (const file of await readdir(skillRoot, { recursive: true, withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue;
      const text = await readFile(path.join(file.parentPath, file.name), 'utf8');
      expect(text, `${pluginId}/${file.name}`).not.toMatch(/tovu|agent_plugin_connect|media_import_from_url|credential_save/iu);
    }
  }
});
