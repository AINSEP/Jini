import { onTestFinished, test, type TestContext } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { StagedClosureAudit } from '../staged-closure.js';
import ts from "typescript";
import { auditStagedClosure } from "../staged-closure.js";
import { createTypeScriptImportReader } from "../typescript.js";
import { memoryFs } from "./memory-fs.js";

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
  const root = join(realpathSync(parent), 'stage');
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
test('a nameless dist/cjs type marker does not hide the owning optional-peer opt-in', t => {
  const f = fixture(t);
  // Dual builds write dist/cjs/package.json = {"type":"commonjs"}; the named package.json above it owns the contract.
  f.write('stage/node_modules/@jini-ai/daemon/package.json', { name: '@jini-ai/daemon', exports: './dist/index.js', peerDependencies: { 'smol-toml': '*' }, peerDependenciesMeta: { 'smol-toml': { optional: true } }, jini: { optionalPeers: { 'smol-toml': 'opt-in: terminal — This feature needs smol-toml.' } } });
  f.write('stage/node_modules/@jini-ai/daemon/dist/index.js', 'export const ok = true;');
  f.write('stage/node_modules/@jini-ai/daemon/dist/cjs/package.json', { type: 'commonjs' });
  f.write('stage/node_modules/@jini-ai/daemon/dist/cjs/index.js', 'exports.parse = () => require("smol-toml");');
  const result = f.audit();
  assert.deepEqual(result.problems, []);
  assert.equal(result.optIns.length, 1);
  assert.match(result.optIns[0]!, /dist[\\/]cjs[\\/]index\.js/);
});

test('native runtime resolver refuses startup without importer-relative resolution enabled', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
    import { createNodeRuntimeResolver } from ${JSON.stringify(new URL('../staged-closure-node.ts', import.meta.url).href)};
    try {
      createNodeRuntimeResolver({});
      process.stdout.write('incorrectly started');
    } catch (err) {
      process.stdout.write(err.message);
    }
  `], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'staged closure needs node --experimental-import-meta-resolve to resolve from each staged importer');
});

test('rejects a scanned symlink to code outside the staged tree', t => {
  const f = fixture(t);
  f.write('outside.js', 'export const outside = true;');
  const link = join(f.root, 'dist', 'outside.js');
  symlinkSync(join(f.root, '..', 'outside.js'), link, 'file');
  assert.throws(f.audit, { message: new RegExp(`staged scan escapes root: .*outside\\.js`) });
});

test('reports absent and directory import targets, but excludes declarations and specs from roots', t => {
  const f = fixture(t);
  f.write('stage/dist/server.js', 'import "./missing.js";\nimport "./folder";');
  f.write('stage/dist/folder/README.md', 'not a module');
  f.write('stage/dist/types.d.ts', 'export type { T } from "type-only";');
  f.write('stage/dist/local.spec.js', 'import "test-only";');
  f.write('stage/node_modules/@jini-ai/daemon/dist/index.js', 'export const ready = true;');
  const result = f.audit();
  assert.equal(result.checked, 2);
  assert.deepEqual(result.optIns, []);
  assert.equal(result.problems.length, 2);
  assert.match(result.problems[0]!, /server\.js:1 -> \.\/missing\.js: resolved target does not exist$/);
  assert.match(result.problems[1]!, /server\.js:2 -> \.\/folder: .*Directory import/);
});

test('checks resolved file containment and ignores only builtins and registered host modules', () => {
  const root = '/staged-closure-logical';
  const { fs, scan, files } = (() => {
    const scan = join(root, 'dist', 'server.js');
    const badLink = join(root, 'dist', 'escape.js');
    const directory = join(root, 'dist', 'directory');
    const good = join(root, 'dist', 'good.js');
    const files = { badLink, directory, good, missing: join(root, 'dist', 'missing.js'), outside: join(root, '..', 'outside.js') };
    const fs = memoryFs({ files: {
      [scan]: ['import "node:fs";', 'import "electron";', 'import "./escape.js";', 'import "./directory";', 'import "./missing.js";',
        'import "../outside.js";', 'import "./good.js";', 'export * from "./good.js";'].join('\n'),
      [badLink]: '', [good]: 'import "./server.js";',
    } }, { realpaths: { [badLink]: files.outside }, dirs: [directory] });
    return { fs, scan, files };
  })();
  const expected = new Map([
    ['./escape.js', files.badLink], ['./directory', files.directory], ['./missing.js', files.missing], ['../outside.js', files.outside],
    ['./good.js', files.good], ['./server.js', scan],
  ]);
  const reads: { fromFile: string; specifier: string; kind: string }[] = [];
  const result = auditStagedClosure({ root, scan: [scan, scan], fs, imports: createTypeScriptImportReader({ compiler: ts }), hostModules: new Set(['electron']),
    resolver: { resolve({ fromFile, specifier, kind }) {
      reads.push({ fromFile, specifier, kind });
      const candidate = expected.get(specifier);
      if (!candidate) throw new Error(`Unexpected runtime lookup: ${specifier}`);
      return candidate;
    } },
  });
  assert.deepEqual(reads, ['./escape.js', './directory', './missing.js', '../outside.js', './good.js', './good.js', './server.js'].map(specifier => ({
    specifier, kind: 'import', fromFile: specifier === './server.js' ? files.good : scan,
  })));
  const relativeFile = join('dist', 'server.js');
  assert.deepEqual(result, { checked: 2, optIns: [], problems: [
    `${relativeFile}:3 -> ./escape.js: resolved symlink escapes the staged tree`,
    `${relativeFile}:4 -> ./directory: resolved target is not a file`,
    `${relativeFile}:5 -> ./missing.js: resolved target does not exist`,
    `${relativeFile}:6 -> ../outside.js: resolved outside the staged tree`,
  ] });
});

test('uses the nearest named Jini manifest for peer exemptions even in a nested package tree', () => {
  const root = '/stage';
  const owner = join(root, 'node_modules/vendor/node_modules/@jini-ai/runtime');
  const file = join(owner, 'dist/cjs/main.cjs');
  const fs = memoryFs({ files: {
    [join(owner, 'package.json')]: JSON.stringify({ name: '@jini-ai/runtime', peerDependencies: { 'optional-receiver': '*' },
      peerDependenciesMeta: { 'optional-receiver': { optional: true } },
      jini: { optionalPeers: { 'optional-receiver': 'opt-in: Forms — Install optional-receiver to receive forms.' } } }),
    [join(owner, 'dist/cjs/package.json')]: '{"type":"commonjs"}',
    [file]: 'require("optional-receiver/feature");\nrequire("./missing.cjs");\nrequire("#declared-alias");',
  } });
  const runtimeFile = join('node_modules/vendor/node_modules/@jini-ai/runtime/dist/cjs/main.cjs');
  assert.deepEqual(auditStagedClosure({ root, scan: [join(root, 'nonexistent')], fs, imports: createTypeScriptImportReader({ compiler: ts }),
    resolver: { resolve({ specifier }) { throw `unavailable: ${specifier}`; } },
  }), {
    checked: 1,
    optIns: [`${runtimeFile}:1 -> optional-receiver/feature (opt-in: Forms — Install optional-receiver to receive forms.)`],
    problems: [`${runtimeFile}:2 -> ./missing.cjs: unavailable: ./missing.cjs`, `${runtimeFile}:3 -> #declared-alias: unavailable: #declared-alias`],
  });
});
