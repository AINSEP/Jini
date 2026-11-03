import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { AGENT_PLUGINS_PACKAGE, agentPluginExports, agentPluginPackages, agentPluginSubpath,
  defineAgentPluginPackages, isPublishedAgentPluginFile } from '../lib/agent-plugin-packages.js';
const workspace = fileURLToPath(new URL('../../', import.meta.url));

test('every table row is a real plugin folder published as its own subpath of the agent-plugins package', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(workspace, 'packages/agent-plugins/package.json'), 'utf8'));
  expect(pkg.name).toBe(AGENT_PLUGINS_PACKAGE);
  for (const entry of agentPluginPackages) {
    const manifest = JSON.parse(await fs.readFile(path.join(workspace, entry.sourceDir, 'plugin.json'), 'utf8'));
    expect(manifest.name).toBe(entry.name);
    expect(agentPluginSubpath(entry)).toBe(`@jini-ai/agent-plugins/${entry.name}`);
    for (const [key, target] of Object.entries(agentPluginExports(entry))) {
      expect(pkg.exports[key]).toBe(target);
      expect(pkg.jini.entries[key]).toBe('universal');
    }
    expect(pkg.files).toContain(entry.name);
  }
  expect(pkg.files).toContain('!**/__tests__/**');
  // Every folder with a plugin.json is in the table, so no plugin ships without a reviewed row.
  const folders = [];
  for (const name of await fs.readdir(path.join(workspace, 'packages/agent-plugins'))) {
    if (await fs.stat(path.join(workspace, 'packages/agent-plugins', name, 'plugin.json')).then(() => true, () => false)) folders.push(name);
  }
  expect(agentPluginPackages.map(entry => entry.name)).toEqual(folders.sort());
});

test('the layout table refuses malformed and duplicate rows', () => {
  const row = { name: 'fixture', sourceDir: 'packages/agent-plugins/fixture' };
  expect(() => defineAgentPluginPackages({ rows: [row, row] })).toThrow('listed twice');
  expect(() => defineAgentPluginPackages({ rows: [{ ...row, sourceDir: 'packages/agent-plugins/other' }] })).toThrow('must live in');
  for (const name of ['plugins', 'src', 'dist', 'core', 'docs']) {
    expect(() => defineAgentPluginPackages({ rows: [{ name, sourceDir: `packages/agent-plugins/${name}` }] })).toThrow('Invalid agent plugin name');
  }
  expect(Object.isFrozen(agentPluginPackages[0])).toBe(true);
  expect(agentPluginExports(row)).toEqual({ './fixture': './fixture/plugin.json', './fixture/*': './fixture/*' });
});

test('published payload files exclude tests, dependency trees, caches and compiled-test artefacts', () => {
  for (const path of ['plugin.json', 'lib/helper.mjs', 'skills/a/SKILL.md', 'docs/spec-notes.md']) expect(isPublishedAgentPluginFile({ path })).toBe(true);
  for (const path of ['__tests__/a.test.mjs', 'lib/__tests__/fixture.json', 'lib/helper.test.mjs', 'skills/x.spec.ts',
    'node_modules/v/index.js', 'skills/.cache/blob', 'coverage/lcov.info', 'dist/old.js', 'build.tsbuildinfo', 'a\\__tests__\\b.mjs']) {
    expect(isPublishedAgentPluginFile({ path })).toBe(false);
  }
});

