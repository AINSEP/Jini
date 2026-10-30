import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { assembleAgentPluginPackage } from '../assemble-agent-plugin-package.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const temporary: string[] = [];
afterEach(async () => { for (const root of temporary.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'agent-package-assembly-'));
  temporary.push(root);
  const sourceDir = path.join(root, 'source');
  const packageRoot = path.join(root, 'destination');
  await fs.mkdir(packageRoot);
  await fs.copyFile(path.join(workspace, 'packages/plugin-ui-ux-design/package.json'), path.join(packageRoot, 'package.json'));
  await fs.cp(path.join(workspace, 'packages/agent-plugins/ui-ux-design'), sourceDir, { recursive: true });
  return { root, sourceDir, packageRoot };
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
  const before = await files(input.sourceDir);
  const { payloadRoot } = await assembleAgentPluginPackage(input);
  expect(await files(payloadRoot)).toEqual(before);
  expect(before).toHaveLength(46);
  for (const name of before) expect(await fs.readFile(path.join(payloadRoot, name))).toEqual(await fs.readFile(path.join(input.sourceDir, name)));
  expect(JSON.parse(await fs.readFile(path.join(payloadRoot, 'plugin.json'), 'utf8')).version).toBe('0.4.6');
  expect((await fs.stat(path.join(payloadRoot, 'skills/shadcn-ui/scripts/verify-setup.sh'))).mode & 0o777)
    .toBe((await fs.stat(path.join(input.sourceDir, 'skills/shadcn-ui/scripts/verify-setup.sh'))).mode & 0o777);
});

test('selects only runtime roots and excludes nested tests, dependency trees and caches on repeat assembly', async () => {
  const input = await fixture();
  const outputRoot = path.join(input.root, 'scratch');
  const baseline = await assembleAgentPluginPackage(input, { outputRoot });
  const expected = await files(baseline.payloadRoot);
  for (const name of ['other-plugin/plugin.json', 'README.md', 'skills/__tests__/fixture.json', 'skills/design.test.ts',
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

test('a missing required asset leaves the completed payload intact and removes staging', async () => {
  const input = await fixture();
  const { payloadRoot } = await assembleAgentPluginPackage(input);
  const before = await files(payloadRoot);
  await fs.unlink(path.join(input.sourceDir, 'mcp.json'));
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
