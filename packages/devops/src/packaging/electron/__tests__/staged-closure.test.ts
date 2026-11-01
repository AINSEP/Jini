import { onTestFinished, test, type TestContext } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { StagedClosureAudit } from '../staged-closure.js';

/** Native Node must own import.meta.resolve: Vite's SSR import.meta omits it. */
function audit(input: { root: string; scan: string[]; packageRoots?: string[] }): StagedClosureAudit {
  const directory = fileURLToPath(new URL('..', import.meta.url));
  const script = `
    import ts from 'typescript';
    import { auditStagedClosure } from ${JSON.stringify(new URL('../staged-closure.ts', import.meta.url).href)};
    import { createNodePackagingFilesystem } from ${JSON.stringify(new URL('../node.ts', import.meta.url).href)};
    import { createNodeRuntimeResolver } from ${JSON.stringify(new URL('../staged-closure-node.ts', import.meta.url).href)};
    import { createTypeScriptImportReader } from ${JSON.stringify(new URL('../typescript.ts', import.meta.url).href)};
    const input = JSON.parse(process.argv[1]);
    console.log(JSON.stringify(auditStagedClosure({ ...input, fs: createNodePackagingFilesystem({}), imports: createTypeScriptImportReader({ compiler: ts }), resolver: createNodeRuntimeResolver({}) })));
  `;
  const result = spawnSync(process.execPath, ['--experimental-import-meta-resolve', '--import', 'tsx', '--input-type=module', '--eval', script, JSON.stringify(input)], { cwd: directory, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function fixture(_t: TestContext) {
  const parent = mkdtempSync(join(tmpdir(), 'jini-staged-'));
  onTestFinished(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'stage');
  function write(file: string, content: unknown) { const target = join(parent, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content)); }
  write('stage/package.json', { name: 'host', type: 'module' });
  write('stage/dist/server.js', "import '@jini-ai/daemon';");
  write('stage/node_modules/@jini-ai/daemon/package.json', { name: '@jini-ai/daemon', type: 'module', exports: './dist/index.js' });
  write('stage/node_modules/@jini-ai/daemon/dist/index.js', "import { createRequire } from 'node:module'; const parse = () => createRequire(import.meta.url)('smol-toml');");
  return { root, write, audit: () => audit({ root, scan: [join(root, 'dist')] }) };
}
test('staged closure rejects missing smol-toml even when an ancestor has it', t => {
  const f = fixture(t); f.write('node_modules/smol-toml/package.json', { name: 'smol-toml', main: 'index.js' }); f.write('node_modules/smol-toml/index.js', 'exports.parse = () => ({});');
  assert.match(f.audit().problems.join('\n'), /smol-toml/);
});
test('staged closure passes when smol-toml is actually present', t => {
  const f = fixture(t); f.write('stage/node_modules/smol-toml/package.json', { name: 'smol-toml', main: 'index.js' }); f.write('stage/node_modules/smol-toml/index.js', 'exports.parse = () => ({});');
  assert.deepEqual(f.audit().problems, []);
});
test('only an owning Jini optional peer classification exempts a miss', t => {
  const f = fixture(t);
  f.write('stage/node_modules/@jini-ai/daemon/package.json', { name: '@jini-ai/daemon', exports: './dist/index.js', peerDependencies: { 'smol-toml': '*' }, peerDependenciesMeta: { 'smol-toml': { optional: true } }, jini: { optionalPeers: { 'smol-toml': 'opt-in: terminal — This feature needs smol-toml.' } } });
  assert.deepEqual(f.audit().problems, []);
  assert.equal(f.audit().optIns.length, 1);
});
test('uses import and require export conditions and detects missing relative targets', t => {
  const f = fixture(t);
  f.write('stage/node_modules/@jini-ai/daemon/dist/index.js', 'import "driver"; require("driver");');
  f.write('stage/node_modules/driver/package.json', { name: 'driver', type: 'module', exports: { import: './esm.js', require: './common.cjs' } });
  f.write('stage/node_modules/driver/esm.js', 'export const ok = true;');
  assert.match(f.audit().problems.join('\n'), /driver/);
  f.write('stage/node_modules/driver/common.cjs', 'exports.ok = true;');
  assert.deepEqual(f.audit().problems, []);
  f.write('stage/node_modules/@jini-ai/daemon/dist/index.js', 'import "./gone.js";');
  assert.match(f.audit().problems.join('\n'), /gone.js/);
});
test('scans unreferenced Jini dist modules but does not audit third-party optional implementations', t => {
  const f = fixture(t);
  f.write('stage/node_modules/@jini-ai/daemon/dist/index.js', 'import "driver";');
  f.write('stage/node_modules/driver/package.json', { name: 'driver', main: 'index.js' });
  f.write('stage/node_modules/driver/index.js', 'try { require("third-party-optional"); } catch {}');
  assert.deepEqual(f.audit().problems, []);
  f.write('stage/node_modules/@jini-ai/daemon/dist/deferred.js', 'export const run = () => require.resolve("missing-deferred");');
  assert.match(f.audit().problems.join('\n'), /missing-deferred/);
});
test('the asar resource layout checks Jini inside app and resolves sibling website files', t => {
  const f = fixture(t);
  f.write('resources/app/package.json', { name: 'shell', type: 'module' });
  f.write('resources/app/main.ts', 'import "../website/shared.js";');
  f.write('resources/website/shared.js', 'export const shared = true;');
  f.write('resources/app/node_modules/@jini-ai/daemon/package.json', { name: '@jini-ai/daemon', exports: './dist/index.js' });
  f.write('resources/app/node_modules/@jini-ai/daemon/dist/index.js', 'export const parse = () => require("smol-toml");');
  const resources = join(f.root, '..', 'resources');
  const app = join(resources, 'app');
  const result = audit({ root: resources, packageRoots: [app], scan: [join(app, 'main.ts')] });
  assert.equal(result.checked, 3);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0]!, /smol-toml/);
});
test('a third-party package nested under Jini retains third-party ownership', t => {
  const f = fixture(t);
  f.write('stage/node_modules/@jini-ai/daemon/dist/index.js', 'export const ok = true;');
  f.write('stage/node_modules/@jini-ai/daemon/node_modules/vendor/package.json', { name: 'vendor', main: 'dist/index.js' });
  f.write('stage/node_modules/@jini-ai/daemon/node_modules/vendor/dist/index.js', 'try { require("vendor-optional"); } catch {}');
  assert.deepEqual(f.audit().problems, []);
});
