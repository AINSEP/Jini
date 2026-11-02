import * as fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { assembleAgentPluginPackage } from '../assemble-agent-plugin-package.js';
import {
  agentPluginPackageName, agentPluginPackageRoot, agentPluginPackages, defineAgentPluginPackages,
} from '../lib/agent-plugin-packages.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const temporary: string[] = [];
afterEach(async () => { for (const root of temporary.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function fixture(id = 'ui-ux-design') {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'agent-package-assembly-'));
  temporary.push(root);
  const sourceDir = path.join(root, 'source');
  const packageRoot = path.join(root, 'destination');
  await fs.mkdir(packageRoot);
  await fs.copyFile(path.join(workspace, `packages/plugin-${id}/package.json`), path.join(packageRoot, 'package.json'));
  await fs.cp(path.join(workspace, `packages/agent-plugins/${id}`), sourceDir, { recursive: true });
  return { root, sourceDir, packageRoot };
}

/** The file list the pre-table assembler shipped: four fixed roots, each filtered the same way. */
const legacyRoots = ['plugin.json', 'mcp.json', 'skills', 'com.anthropic.claude-code'];

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
  const before = await files(input.sourceDir);
  const { payloadRoot } = await assembleAgentPluginPackage(input);
  expect(await files(payloadRoot)).toEqual(before);
  expect(before).toHaveLength(46);
  for (const name of before) expect(await fs.readFile(path.join(payloadRoot, name))).toEqual(await fs.readFile(path.join(input.sourceDir, name)));
  expect(JSON.parse(await fs.readFile(path.join(payloadRoot, 'plugin.json'), 'utf8')).version).toBe('0.4.6');
  expect((await fs.stat(path.join(payloadRoot, 'skills/shadcn-ui/scripts/verify-setup.sh'))).mode & 0o777)
    .toBe((await fs.stat(path.join(input.sourceDir, 'skills/shadcn-ui/scripts/verify-setup.sh'))).mode & 0o777);
});

test('assembles the slide-design payload byte for byte under its own name', async () => {
  const input = await fixture('slide-design');
  const before = await files(input.sourceDir);
  const { payloadRoot } = await assembleAgentPluginPackage(input);
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
  const { payloadRoot } = await assembleAgentPluginPackage(input);
  const legacy: string[] = [];
  for (const name of await fs.readdir(input.sourceDir)) {
    if (!legacyRoots.includes(name)) continue;
    const stat = await fs.stat(path.join(input.sourceDir, name));
    legacy.push(...(stat.isDirectory() ? (await files(path.join(input.sourceDir, name))).map(child => `${name}/${child}`) : [name]));
  }
  // The authored folders hold only the old roots, so packaging output for both plugins is unchanged.
  expect((await fs.readdir(input.sourceDir)).filter(name => !legacyRoots.includes(name))).toEqual([]);
  expect(await files(payloadRoot)).toEqual(legacy.sort());
  for (const name of legacy) expect(await fs.readFile(path.join(payloadRoot, name))).toEqual(await fs.readFile(path.join(input.sourceDir, name)));
});

test('every table entry pairs a real source with its own package and build script', async () => {
  expect(agentPluginPackages.map(entry => entry.name)).toEqual(['slide-design', 'ui-ux-design']);
  for (const entry of agentPluginPackages) {
    const manifest = JSON.parse(await fs.readFile(path.join(workspace, entry.sourceDir, 'plugin.json'), 'utf8'));
    const pkg = JSON.parse(await fs.readFile(path.join(workspace, agentPluginPackageRoot(entry), 'package.json'), 'utf8'));
    expect(manifest.name).toBe(entry.name);
    expect(pkg.name).toBe(agentPluginPackageName(entry));
    // The build argument is the package id: one invocation assembles every row the package ships.
    expect(pkg.scripts.build).toBe(`node --import tsx ../../scripts/assemble-agent-plugin-package.ts ${pkg.name.slice('@jini-ai/plugin-'.length)}`);
    expect(pkg.scripts.prepack).toBe(pkg.scripts.build);
  }
});

test('a combined package assembles its face under the face name next to a provider payload', async () => {
  const input = await fixture('slide-design');
  const rows = defineAgentPluginPackages({ rows: [
    { name: 'slide-design', sourceDir: 'packages/agent-plugins/slide-design', packageId: 'charts-fixture' },
  ] });
  const provider = path.join(input.packageRoot, 'plugins/charts-fixture/0.6.19/client/provider.js');
  await fs.mkdir(path.dirname(provider), { recursive: true });
  await fs.writeFile(provider, 'export {};');
  await expect(assembleAgentPluginPackage(input, { rows })).rejects.toThrow('identities must agree');
  await fs.writeFile(path.join(input.packageRoot, 'package.json'), '{"name":"@jini-ai/plugin-charts-fixture"}');
  const { payloadRoot } = await assembleAgentPluginPackage(input, { rows });
  expect(path.relative(input.packageRoot, payloadRoot)).toBe('slide-design');
  expect(await fs.readFile(provider, 'utf8')).toBe('export {};');
  expect((await fs.readdir(input.packageRoot)).sort()).toEqual(['package.json', 'plugins', 'slide-design']);
});

test('only plugin.json is required: a plugin without mcp.json or a client extension root assembles', async () => {
  const input = await fixture('slide-design');
  await fs.unlink(path.join(input.sourceDir, 'mcp.json'));
  await fs.rm(path.join(input.sourceDir, 'com.anthropic.claude-code'), { recursive: true });
  await fs.writeFile(path.join(input.sourceDir, 'README.md'), 'authored');
  await fs.mkdir(path.join(input.sourceDir, 'lib'));
  await fs.writeFile(path.join(input.sourceDir, 'lib/helper.mjs'), 'export const ok = true;');
  const { payloadRoot } = await assembleAgentPluginPackage(input);
  expect(await files(payloadRoot)).toEqual(await files(input.sourceDir));
  expect(await files(payloadRoot)).toContain('lib/helper.mjs');
});

test('the layout table refuses malformed and duplicate rows', () => {
  const row = { name: 'fixture', sourceDir: 'packages/agent-plugins/fixture' };
  expect(() => defineAgentPluginPackages({ rows: [row, row] })).toThrow('listed twice');
  expect(() => defineAgentPluginPackages({ rows: [{ ...row, sourceDir: 'packages/agent-plugins/other' }] })).toThrow('must live in');
  expect(() => defineAgentPluginPackages({ rows: [{ name: 'plugins', sourceDir: 'packages/agent-plugins/plugins' }] })).toThrow('Invalid agent plugin name');
  expect(() => defineAgentPluginPackages({ rows: [{ ...row, packageId: '../core' }] })).toThrow('Invalid package id');
  expect(agentPluginPackageName({ ...row, packageId: 'charts-fixture' })).toBe('@jini-ai/plugin-charts-fixture');
  expect(Object.isFrozen(agentPluginPackages[0])).toBe(true);
});

test('refuses a package that does not match the plugin it is given', async () => {
  const input = await fixture('slide-design');
  await fs.copyFile(path.join(workspace, 'packages/plugin-ui-ux-design/package.json'), path.join(input.packageRoot, 'package.json'));
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
  expect(await files(payloadRoot)).toEqual(await files(sourceDir));
  const completedManifest = await fs.readFile(path.join(payloadRoot, 'plugin.json'));
  await fs.unlink(path.join(sourceDir, 'plugin.json'));
  const failed = run();
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain('ENOENT');
  expect(await fs.readFile(path.join(payloadRoot, 'plugin.json'))).toEqual(completedManifest);
  await fs.writeFile(path.join(sourceDir, 'plugin.json'), completedManifest);
  const unknown = spawnSync(process.execPath, ['--import', 'tsx', invokedScript, 'no-such-plugin'], { cwd: workspace, encoding: 'utf8' });
  expect(unknown.status).toBe(1);
  expect(unknown.stderr).toContain('Unknown agent plugin package: no-such-plugin');
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
