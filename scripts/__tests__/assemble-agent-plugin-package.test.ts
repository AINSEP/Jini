import * as fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { assembleAgentPluginPackage } from '../assemble-agent-plugin-package.js';
import {
  AGENT_PLUGINS_PACKAGE, agentPluginExports, agentPluginPackages, agentPluginSubpath, defineAgentPluginPackages,
  isPublishedAgentPluginFile, legacyAgentPluginPackages,
} from '../lib/agent-plugin-packages.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const temporary: string[] = [];
afterEach(async () => { for (const root of temporary.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

// slide-design never had a published package; its rows here only exercise the assembler on a second payload.
const legacyPackages = { ...legacyAgentPluginPackages, 'slide-design': '@jini-ai/plugin-slide-design' };

async function fixture(id = 'ui-ux-design') {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'agent-package-assembly-'));
  temporary.push(root);
  const sourceDir = path.join(root, 'source');
  const packageRoot = path.join(root, 'destination');
  await fs.mkdir(packageRoot);
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: legacyPackages[id as keyof typeof legacyPackages] }));
  await fs.cp(path.join(workspace, `packages/agent-plugins/${id}`), sourceDir, { recursive: true });
  return { root, sourceDir, packageRoot };
}

/** The file list the pre-table assembler shipped: four fixed roots, each filtered the same way. */
const legacyRoots = ['plugin.json', 'mcp.json', 'skills', 'com.anthropic.claude-code'];

/** Source files the tarball carries (tests stay in the checkout). */
async function publishedFiles(root: string): Promise<string[]> {
  return (await files(root)).filter(name => isPublishedAgentPluginFile({ path: name }));
}

async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...(await files(path.join(root, entry.name))).map(name => `${entry.name}/${name}`));
    else result.push(entry.name);
  }
  return result.sort();
}

test('assembles exactly the authored runtime files, preserving manifests, references, examples and executable helpers', async () => {
  const input = await fixture();
  const before = await publishedFiles(input.sourceDir);
  const { payloadRoot } = await assembleAgentPluginPackage(input);
  expect(await files(payloadRoot)).toEqual(before);
  expect(before).toHaveLength(50);
  for (const name of before) expect(await fs.readFile(path.join(payloadRoot, name))).toEqual(await fs.readFile(path.join(input.sourceDir, name)));
  expect(JSON.parse(await fs.readFile(path.join(payloadRoot, 'plugin.json'), 'utf8')).version).toBe('0.6.1');
  expect((await fs.stat(path.join(payloadRoot, 'skills/shadcn-ui/scripts/verify-setup.sh'))).mode & 0o777)
    .toBe((await fs.stat(path.join(input.sourceDir, 'skills/shadcn-ui/scripts/verify-setup.sh'))).mode & 0o777);
});

test('assembles the slide-design payload byte for byte under its own name', async () => {
  const input = await fixture('slide-design');
  const before = await files(input.sourceDir);
  const { payloadRoot } = await assembleAgentPluginPackage(input, { legacyPackages });
  expect(path.basename(payloadRoot)).toBe('slide-design');
  expect(await files(payloadRoot)).toEqual(before);
  expect(before).toEqual([
    'com.anthropic.claude-code/hooks/hooks.json', 'mcp.json', 'plugin.json', 'skills/slide-design/SKILL.md',
    'skills/slide-design/references/charts-and-exhibits.md', 'skills/slide-design/references/html-deck.md',
    'skills/slide-design/references/layout-and-style.md', 'skills/slide-design/references/review.md',
    'skills/slide-design/references/storyline.md',
  ]);
  for (const name of before) expect(await fs.readFile(path.join(payloadRoot, name))).toEqual(await fs.readFile(path.join(input.sourceDir, name)));
  expect(JSON.parse(await fs.readFile(path.join(payloadRoot, 'plugin.json'), 'utf8')).version).toBe('0.1.0');
});

test.each(['ui-ux-design', 'slide-design'])('whole-folder assembly of %s is byte-identical to the old fixed-root selection', async (id) => {
  const input = await fixture(id);
  const { payloadRoot } = await assembleAgentPluginPackage(input, { legacyPackages });
  const legacy: string[] = [];
  for (const name of await fs.readdir(input.sourceDir)) {
    if (!legacyRoots.includes(name)) continue;
    const stat = await fs.stat(path.join(input.sourceDir, name));
    legacy.push(...(stat.isDirectory() ? (await files(path.join(input.sourceDir, name))).map(child => `${name}/${child}`) : [name]));
  }
  // The authored folders hold only the old roots, so packaging output for both plugins is unchanged.
  expect((await fs.readdir(input.sourceDir)).filter(name => !legacyRoots.includes(name) && name !== '__tests__')).toEqual([]);
  expect(await files(payloadRoot)).toEqual(legacy.sort());
  for (const name of legacy) expect(await fs.readFile(path.join(payloadRoot, name))).toEqual(await fs.readFile(path.join(input.sourceDir, name)));
});

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

test('the legacy standalone package still builds its payload from the same source folder', async () => {
  expect(Object.keys(legacyAgentPluginPackages)).toEqual(['ui-ux-design']);
  const pkg = JSON.parse(await fs.readFile(path.join(workspace, 'packages/plugin-ui-ux-design/package.json'), 'utf8'));
  expect(pkg.name).toBe(legacyAgentPluginPackages['ui-ux-design']);
  expect(pkg.scripts.build).toBe('node --import tsx ../../scripts/assemble-agent-plugin-package.ts ui-ux-design');
  expect(pkg.scripts.prepack).toBe(pkg.scripts.build);
});

test('only plugin.json is required: a plugin without mcp.json or a client extension root assembles', async () => {
  const input = await fixture('slide-design');
  await fs.unlink(path.join(input.sourceDir, 'mcp.json'));
  await fs.rm(path.join(input.sourceDir, 'com.anthropic.claude-code'), { recursive: true });
  await fs.writeFile(path.join(input.sourceDir, 'README.md'), 'authored');
  await fs.mkdir(path.join(input.sourceDir, 'lib'));
  await fs.writeFile(path.join(input.sourceDir, 'lib/helper.mjs'), 'export const ok = true;');
  const { payloadRoot } = await assembleAgentPluginPackage(input, { legacyPackages });
  expect(await files(payloadRoot)).toEqual(await files(input.sourceDir));
  expect(await files(payloadRoot)).toContain('lib/helper.mjs');
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

test('refuses a package that does not match the plugin it is given', async () => {
  const input = await fixture('slide-design');
  await fs.copyFile(path.join(workspace, 'packages/plugin-ui-ux-design/package.json'), path.join(input.packageRoot, 'package.json'));
  await expect(assembleAgentPluginPackage(input, { legacyPackages })).rejects.toThrow('identities must agree');
  // slide-design has no legacy package by default: the subpath is its only publication.
  await fs.writeFile(path.join(input.packageRoot, 'package.json'), '{"name":"@jini-ai/plugin-slide-design"}');
  await expect(assembleAgentPluginPackage(input)).rejects.toThrow('identities must agree');
  expect((await fs.readdir(input.packageRoot)).sort()).toEqual(['package.json']);
});

test('copies the whole folder but excludes nested tests, dependency trees and caches on repeat assembly', async () => {
  const input = await fixture();
  const outputRoot = path.join(input.root, 'scratch');
  const baseline = await assembleAgentPluginPackage(input, { outputRoot });
  const expected = await files(baseline.payloadRoot);
  for (const name of ['__tests__/fixture.json', 'lib/helper.test.mjs', 'skills/__tests__/fixture.json', 'skills/design.test.ts',
    'skills/design.spec.mjs', 'skills/.cache/blob', 'skills/node_modules/vendor/index.js', 'skills/dist/old.js', 'skills/build.tsbuildinfo']) {
    const target = path.join(input.sourceDir, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'must not ship');
  }
  await fs.writeFile(path.join(baseline.payloadRoot, 'stale.txt'), 'previous output');
  const sibling = path.join(outputRoot, 'other-plugin');
  await fs.mkdir(sibling);
  await fs.writeFile(path.join(sibling, 'keep'), 'untouched');
  const { payloadRoot } = await assembleAgentPluginPackage(input, { outputRoot });
  expect(await files(payloadRoot)).toEqual(expected);
  expect(await fs.readFile(path.join(sibling, 'keep'), 'utf8')).toBe('untouched');
  expect((await fs.readdir(input.packageRoot)).sort()).toEqual(['package.json']);
});

test('a missing plugin.json leaves the completed payload intact and removes staging', async () => {
  const input = await fixture();
  const { payloadRoot } = await assembleAgentPluginPackage(input);
  const before = await files(payloadRoot);
  await fs.unlink(path.join(input.sourceDir, 'plugin.json'));
  await expect(assembleAgentPluginPackage(input)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await files(payloadRoot)).toEqual(before);
  expect((await fs.readdir(input.packageRoot)).sort()).toEqual(['package.json', 'ui-ux-design']);
});

test('refuses source and destination identity mismatches before creating output', async () => {
  const input = await fixture();
  await fs.writeFile(path.join(input.sourceDir, 'plugin.json'), '{"name":"other-plugin"}');
  await expect(assembleAgentPluginPackage(input)).rejects.toThrow('identities must agree');
  await fs.writeFile(path.join(input.sourceDir, 'plugin.json'), '{"name":"ui-ux-design"}');
  await fs.writeFile(path.join(input.packageRoot, 'package.json'), '{"name":"@jini-ai/agent-plugins"}');
  await expect(assembleAgentPluginPackage(input)).rejects.toThrow('identities must agree');
  expect((await fs.readdir(input.packageRoot)).sort()).toEqual(['package.json']);
});

test('refuses a symlink within a selected asset tree without replacing completed output', async () => {
  const input = await fixture();
  const { payloadRoot } = await assembleAgentPluginPackage(input);
  const original = await fs.readFile(path.join(payloadRoot, 'plugin.json'));
  await fs.symlink(path.join(input.sourceDir, 'plugin.json'), path.join(input.sourceDir, 'skills/linked.json'));
  await expect(assembleAgentPluginPackage(input)).rejects.toThrow('regular file or directory');
  expect(await fs.readFile(path.join(payloadRoot, 'plugin.json'))).toEqual(original);
});

test.each(['canonical', 'symlink'] as const)('the build CLI assembles a payload through a %s path and reports assembly failures', async (entryPath) => {
  const input = await fixture();
  const script = path.join(input.root, 'scripts/assemble-agent-plugin-package.ts');
  const sourceDir = path.join(input.root, 'packages/agent-plugins/ui-ux-design');
  const packageRoot = path.join(input.root, 'packages/plugin-ui-ux-design');
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.copyFile(path.join(workspace, 'scripts/assemble-agent-plugin-package.ts'), script);
  await fs.mkdir(path.join(path.dirname(script), 'lib'));
  for (const helper of ['is-main-module.ts', 'agent-plugin-packages.ts']) {
    await fs.copyFile(path.join(workspace, 'scripts/lib', helper), path.join(path.dirname(script), 'lib', helper));
  }
  await fs.mkdir(path.dirname(sourceDir), { recursive: true });
  await fs.rename(input.sourceDir, sourceDir);
  await fs.rename(input.packageRoot, packageRoot);
  let invokedScript = await fs.realpath(script);
  if (entryPath === 'symlink') {
    // Exercise aliases on every OS, even when its temporary directory is already canonical.
    const alias = path.join(input.root, 'linked-root');
    await fs.symlink(await fs.realpath(input.root), alias, 'dir');
    invokedScript = path.join(alias, 'scripts/assemble-agent-plugin-package.ts');
  }
  const run = () => spawnSync(process.execPath, ['--import', 'tsx', invokedScript, 'ui-ux-design'], { cwd: workspace, encoding: 'utf8' });
  const built = run();
  expect(built.status, built.stderr).toBe(0);
  const payloadRoot = path.join(packageRoot, 'ui-ux-design');
  expect(await files(payloadRoot)).toEqual(await publishedFiles(sourceDir));
  const completedManifest = await fs.readFile(path.join(payloadRoot, 'plugin.json'));
  await fs.unlink(path.join(sourceDir, 'plugin.json'));
  const failed = run();
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain('ENOENT');
  expect(await fs.readFile(path.join(payloadRoot, 'plugin.json'))).toEqual(completedManifest);
  await fs.writeFile(path.join(sourceDir, 'plugin.json'), completedManifest);
  const unknown = spawnSync(process.execPath, ['--import', 'tsx', invokedScript, 'no-such-plugin'], { cwd: workspace, encoding: 'utf8' });
  expect(unknown.status).toBe(1);
  expect(unknown.stderr).toContain('Not a legacy agent plugin package: no-such-plugin');
  const subpathOnly = spawnSync(process.execPath, ['--import', 'tsx', invokedScript, 'slide-design'], { cwd: workspace, encoding: 'utf8' });
  expect(subpathOnly.status).toBe(1);
  expect(subpathOnly.stderr).toContain('Not a legacy agent plugin package: slide-design');
});

test('the assembler remains importable from stdin without running its CLI', () => {
  const moduleUrl = pathToFileURL(path.join(workspace, 'scripts/assemble-agent-plugin-package.ts')).href;
  const imported = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-'], {
    cwd: workspace, encoding: 'utf8',
    input: `import ${JSON.stringify(moduleUrl)}; console.log('imported');`,
  });
  expect(imported.status, imported.stderr).toBe(0);
  expect(imported.stdout.trim()).toBe('imported');
});
