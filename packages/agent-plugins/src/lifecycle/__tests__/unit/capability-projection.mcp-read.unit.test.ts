/**
 * @file `readInstalledMcpServerIds` reads plugin.json alongside mcp.json: a version mismatch between
 * the two refuses the config (so dropping the plugin.json read would wrongly admit it), while a
 * missing/unparsable plugin.json still lets a valid mcp.json through; an unparsable mcp.json is
 * empty, never thrown. Closes Stryker run-2 survivors at capability-projection.ts:43, 50, 55.
 */
import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readInstalledMcpServerIds } from '../test-support.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const schema = (version: string, kind: 'plugin' | 'mcp') => `https://agent-plugins.org/schemas/${version}/${kind}.schema.json`;
async function pkg(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'jini-mcp-read-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, name), content);
  return root;
}
const mcp = (version: string) => JSON.stringify({ $schema: schema(version, 'mcp'), mcpServers: { docs: { type: 'streamable-http', url: 'https://mcp.example.com/mcp' } } });
const plugin = (version: string) => JSON.stringify({ $schema: schema(version, 'plugin'), name: 'example' });

test('matching plugin.json and mcp.json versions list the servers', async () => {
  expect(await readInstalledMcpServerIds(await pkg({ 'mcp.json': mcp('1.1.0'), 'plugin.json': plugin('1.1.0') }))).toEqual(['docs']);
});

test('an mcp.json targeting a different version than plugin.json is refused', async () => {
  expect(await readInstalledMcpServerIds(await pkg({ 'mcp.json': mcp('1.1.0'), 'plugin.json': plugin('1.0.0') }))).toEqual([]);
});

test.each([['missing', {}], ['unparsable', { 'plugin.json': '{not json' }]])('a %s plugin.json does not block a valid mcp.json', async (_name, extra) => {
  expect(await readInstalledMcpServerIds(await pkg({ 'mcp.json': mcp('1.1.0'), ...extra }))).toEqual(['docs']);
});

test.each([['unparsable', '{"mcpServers":'], ['empty', ''], ['JSON null', 'null']])('an %s mcp.json is empty, not an error', async (_name, raw) => {
  await expect(readInstalledMcpServerIds(await pkg({ 'mcp.json': raw, 'plugin.json': plugin('1.1.0') }))).resolves.toEqual([]);
});
