import assert from 'node:assert/strict';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'vitest';
import { createNodePackagingFilesystem } from '../node.js';
import {
  assertClosureComplete, declaredDependencies, diskBytes, isExcluded, newestMtime, productionDependencyOutput, pruneNativePrebuilds,
  stageBundledNpm, stageDir, stagedPackageDirs, stagePayloadFiles, stageTransitiveDependencies, stripNonRuntimeFiles,
} from '../staging.js';
import type { PackageResolverPort, ProcessRunnerPort } from '../ports.js';
import { effects, memoryFs } from './memory-fs.js';

const BACKSLASH = String.fromCharCode(92);
const manifestOf = (name: string, version: string | undefined, dependencies: Record<string, string> = {}) => JSON.stringify({ name, version, dependencies });
/** Resolves `name` from any directory to `/store/<name>` unless `table` overrides it. */
function resolverOf(table: Record<string, string | undefined> = {}): PackageResolverPort & { requests: string[] } {
  const requests: string[] = [];
  return { requests, resolve: ({ fromDirectory, packageName }) => {
    requests.push(`${fromDirectory} -> ${packageName}`);
    const key = `${fromDirectory} -> ${packageName}`;
    return key in table ? table[key] : packageName in table ? table[packageName] : `/store/${packageName}`;
  } };
}

describe('isExcluded / declaredDependencies / stageDir', () => {
  test('an exact name is excluded', () => { assert.equal(isExcluded({ name: 'electron', excluded: new Set(['electron']) }), true); });
  test('a scoped name is excluded by its scope', () => { assert.equal(isExcluded({ name: '@types/node', excluded: new Set(['@types']) }), true); });
  test('a backslash-joined name is excluded by its first segment', () => { assert.equal(isExcluded({ name: `@types${BACKSLASH}node`, excluded: new Set(['@types']) }), true); });
  test('an unrelated name is not excluded', () => { assert.equal(isExcluded({ name: '@typesx/node', excluded: new Set(['@types', 'node']) }), false); });
  test('a directory without package.json declares nothing', () => { assert.deepEqual(declaredDependencies({ packageDir: '/p', fs: memoryFs({ files: {} }) }), []); });
  test('a manifest without dependencies declares nothing', () => { assert.deepEqual(declaredDependencies({ packageDir: '/p', fs: memoryFs({ files: { '/p/package.json': '{}' } }) }), []); });
  test('declared dependency names come from the manifest', () => { assert.deepEqual(declaredDependencies({ packageDir: '/p', fs: memoryFs({ files: { '/p/package.json': manifestOf('p', '1', { a: '1', '@s/b': '2' }) } }) }), ['a', '@s/b']); });
  test('stageDir forwards the copy options unchanged', () => {
    const fs = memoryFs({ files: {} });
    stageDir({ source: '/a', destination: '/b', fs }, { dropNestedModules: true });
    stageDir({ source: '/c', destination: '/d', fs });
    assert.deepEqual(effects(fs), [{ op: 'copy', from: '/a', to: '/b', dropNestedModules: true, excluding: false }, { op: 'copy', from: '/c', to: '/d', dropNestedModules: undefined, excluding: false }]);
  });
});

describe('stageTransitiveDependencies', () => {
  const root = '/app';
  const base = { roots: [root], outDir: '/out', excluded: new Set<string>() };
  test('stages the closure once, follows cycles, drops nested node_modules and counts copies', () => {
    const fs = memoryFs({ files: {
      '/app/package.json': manifestOf('app', '1', { a: '1' }), '/store/a/package.json': manifestOf('a', '1', { b: '1' }),
      '/store/b/package.json': manifestOf('b', '1', { a: '1' }), '/store/b/node_modules/x/package.json': manifestOf('x', '1'),
    } });
    assert.equal(stageTransitiveDependencies({ ...base, fs, resolver: resolverOf() }), 2);
    assert.deepEqual(effects(fs), [
      { op: 'copy', from: '/store/a', to: '/out/node_modules/a', dropNestedModules: true, excluding: false },
      { op: 'copy', from: '/store/b', to: '/out/node_modules/b', dropNestedModules: true, excluding: false },
    ]);
  });
  test('roots that share a real path are walked once', () => {
    const fs = memoryFs({ files: { '/real/package.json': manifestOf('app', '1', { a: '1' }), '/store/a/package.json': manifestOf('a', '1') } }, { realpaths: { '/l1': '/real', '/l2': '/real' } });
    const resolver = resolverOf();
    assert.equal(stageTransitiveDependencies({ ...base, roots: ['/l1', '/l2'], fs, resolver }), 1);
    assert.deepEqual(resolver.requests, ['/real -> a']);
  });
  test('the resolved directory is canonicalised before staging', () => {
    const fs = memoryFs({ files: { '/app/package.json': manifestOf('app', '1', { a: '1' }), '/pnpm/a@1/package.json': manifestOf('a', '1') } }, { realpaths: { '/store/a': '/pnpm/a@1' } });
    stageTransitiveDependencies({ ...base, fs, resolver: resolverOf() });
    assert.deepEqual(effects(fs).map(call => call.op === 'copy' && call.from), ['/pnpm/a@1']);
  });
  for (const name of ['../escape', '..', 'a/b', '@scope/../x', '.hidden', '']) {
    test(`an invalid dependency name ${JSON.stringify(name)} is refused before resolution`, () => {
      const fs = memoryFs({ files: { '/app/package.json': JSON.stringify({ dependencies: { [name]: '1' } }) } });
      const resolver = resolverOf();
      assert.throws(() => stageTransitiveDependencies({ ...base, fs, resolver }), { message: `Invalid package name: ${name}` });
      assert.deepEqual(resolver.requests, []);
    });
  }
  test('an excluded dependency is neither resolved nor staged', () => {
    const fs = memoryFs({ files: { '/app/package.json': manifestOf('app', '1', { electron: '1', '@types/node': '1' }) } });
    const resolver = resolverOf();
    assert.equal(stageTransitiveDependencies({ ...base, excluded: new Set(['electron', '@types']), fs, resolver }), 0);
    assert.deepEqual(resolver.requests, []);
  });
  test('an unresolved dependency names both ends and nothing is copied', () => {
    const fs = memoryFs({ files: { '/app/package.json': manifestOf('app', '1', { gone: '1' }) } });
    assert.throws(() => stageTransitiveDependencies({ ...base, fs, resolver: resolverOf({ gone: undefined }) }), { message: 'Unresolved production dependency: /app -> gone' });
    assert.deepEqual(effects(fs), []);
  });
  function twoCopies(versions: { first: string | undefined; second: string | undefined }) {
    return memoryFs({ files: {
      '/app/package.json': manifestOf('app', '1', { a: '1', b: '1' }),
      '/store/a/package.json': manifestOf('a', '1', { shared: '1' }), '/store/b/package.json': manifestOf('b', '1', { shared: '1' }),
      '/one/package.json': manifestOf('shared', versions.first), '/two/package.json': manifestOf('shared', versions.second),
    } });
  }
  const sharedResolver = () => resolverOf({ '/store/a -> shared': '/one', '/store/b -> shared': '/two' });
  for (const versions of [{ first: '1.0.0', second: '2.0.0' }, { first: undefined, second: undefined }]) {
    test(`two different directories (${versions.first ?? 'unversioned'} / ${versions.second ?? 'unversioned'}): the second nests under its dependent`, () => {
      const fs = twoCopies(versions);
      assert.equal(stageTransitiveDependencies({ ...base, fs, resolver: sharedResolver() }), 4);
      assert.deepEqual(effects(fs).filter(call => call.op === 'copy' && call.to.endsWith('/shared')).map(call => call.op === 'copy' && `${call.from} -> ${call.to}`), [
        '/one -> /out/node_modules/shared', '/two -> /out/node_modules/b/node_modules/shared',
      ]);
    });
  }
  test('two different directories with the same version stage the first one only', () => {
    const fs = twoCopies({ first: '1.0.0', second: '1.0.0' });
    assert.equal(stageTransitiveDependencies({ ...base, fs, resolver: sharedResolver() }), 3);
    assert.ok(effects(fs).some(call => call.op === 'copy' && call.from === '/one'));
    assert.ok(!effects(fs).some(call => call.op === 'copy' && call.from === '/two'));
  });
  test('the same unversioned directory reached twice does not conflict', () => {
    const fs = twoCopies({ first: undefined, second: undefined });
    assert.equal(stageTransitiveDependencies({ ...base, fs, resolver: resolverOf({ '/store/a -> shared': '/one', '/store/b -> shared': '/one' }) }), 3);
  });
  test('an already-staged destination with the same version is kept and not recopied', () => {
    const fs = memoryFs({ files: { '/app/package.json': manifestOf('app', '1', { a: '1' }), '/store/a/package.json': manifestOf('a', '1'), '/out/node_modules/a/package.json': manifestOf('a', '1') } });
    assert.equal(stageTransitiveDependencies({ ...base, fs, resolver: resolverOf() }), 0);
    assert.deepEqual(effects(fs), []);
  });
  test('an already-staged destination with the same version still has its own dependencies staged', () => {
    const fs = memoryFs({ files: { '/app/package.json': manifestOf('app', '1', { a: '1' }), '/store/a/package.json': manifestOf('a', '1', { z: '1' }), '/store/z/package.json': manifestOf('z', '1'), '/out/node_modules/a/package.json': manifestOf('a', '1') } });
    assert.equal(stageTransitiveDependencies({ ...base, fs, resolver: resolverOf() }), 1);
    assert.deepEqual(effects(fs).map(call => call.op === 'copy' && call.to), ['/out/node_modules/z']);
  });
  test('an already-staged destination with another version conflicts', () => {
    const fs = memoryFs({ files: { '/app/package.json': manifestOf('app', '1', { a: '1' }), '/store/a/package.json': manifestOf('a', '1'), '/out/node_modules/a/package.json': manifestOf('a', '2') } });
    assert.throws(() => stageTransitiveDependencies({ ...base, fs, resolver: resolverOf() }), { message: /^Package version conflict while flattening a: \/store\/a / });
  });
  test('an already-staged destination without a manifest conflicts', () => {
    const fs = memoryFs({ files: { '/app/package.json': manifestOf('app', '1', { a: '1' }), '/store/a/package.json': manifestOf('a', '1'), '/out/node_modules/a/index.js': '' } });
    assert.throws(() => stageTransitiveDependencies({ ...base, fs, resolver: resolverOf() }), { message: /^Package version conflict while flattening a: \/store\/a / });
  });
  test('an already-staged destination conflicts when the source has no version', () => {
    const fs = memoryFs({ files: { '/app/package.json': manifestOf('app', '1', { a: '1' }), '/store/a/package.json': manifestOf('a', undefined), '/out/node_modules/a/package.json': manifestOf('a', undefined) } });
    assert.throws(() => stageTransitiveDependencies({ ...base, fs, resolver: resolverOf() }), { message: /^Package version conflict while flattening a: \/store\/a / });
  });
  /** npm's layout: /app needs b and debug@4 (hoisted); b keeps its own debug@2 in /store/b/node_modules. */
  function nestedDebug(extra: Record<string, string> = {}) {
    return memoryFs({ files: {
      '/app/package.json': manifestOf('app', '1', { b: '1', debug: '4' }), '/store/b/package.json': manifestOf('b', '1', { debug: '2' }),
      '/store/debug/package.json': manifestOf('debug', '4.4.3'), '/store/b/node_modules/debug/package.json': manifestOf('debug', '2.6.9'), ...extra,
    } });
  }
  const nestedResolver = (table: Record<string, string> = {}) => resolverOf({ '/store/b -> debug': '/store/b/node_modules/debug', ...table });
  test('a transitive package keeps its own conflicting nested version under itself instead of failing', () => {
    const fs = nestedDebug();
    assert.equal(stageTransitiveDependencies({ ...base, fs, resolver: nestedResolver() }), 3);
    assert.deepEqual(effects(fs).map(call => call.op === 'copy' && `${call.from} -> ${call.to}`), [
      '/store/b -> /out/node_modules/b', '/store/debug -> /out/node_modules/debug',
      '/store/b/node_modules/debug -> /out/node_modules/b/node_modules/debug',
    ]);
  });
  test('a nested version also stays nested when the top level was staged before the walk', () => {
    const fs = nestedDebug({ '/app/package.json': manifestOf('app', '1', { b: '1' }), '/out/node_modules/debug/package.json': manifestOf('debug', '4.4.3') });
    assert.equal(stageTransitiveDependencies({ ...base, fs, resolver: nestedResolver() }), 2);
    assert.deepEqual(effects(fs).map(call => call.op === 'copy' && call.to), ['/out/node_modules/b', '/out/node_modules/b/node_modules/debug']);
  });
  test('a nested package resolves its own dependencies from where it is staged', () => {
    const fs = nestedDebug({
      '/store/debug/package.json': manifestOf('debug', '4.4.3', { ms: '2.1' }), '/store/ms/package.json': manifestOf('ms', '2.1.3'),
      '/store/b/node_modules/debug/package.json': manifestOf('debug', '2.6.9', { ms: '2.0' }), '/store/b/node_modules/ms/package.json': manifestOf('ms', '2.0.0'),
    });
    stageTransitiveDependencies({ ...base, fs, resolver: nestedResolver({ '/store/b/node_modules/debug -> ms': '/store/b/node_modules/ms' }) });
    // npm's own layout: b's ms sits beside b's debug, where Node finds it from debug.
    assert.ok(effects(fs).some(call => call.op === 'copy' && call.from === '/store/b/node_modules/ms' && call.to === '/out/node_modules/b/node_modules/ms'));
    assert.doesNotThrow(() => assertClosureComplete({ outDir: '/out', excluded: new Set(), fs }));
  });
  test('a nested package already shipped above its dependent is reused, not copied again', () => {
    const fs = nestedDebug({ '/store/b/node_modules/c/package.json': manifestOf('c', '1', { debug: '2' }), '/store/b/package.json': manifestOf('b', '1', { debug: '2', c: '1' }) });
    const resolver = nestedResolver({ '/store/b -> c': '/store/b/node_modules/c', '/store/b/node_modules/c -> debug': '/store/b/node_modules/debug' });
    assert.equal(stageTransitiveDependencies({ ...base, fs, resolver }), 4);
    assert.ok(!effects(fs).some(call => call.op === 'copy' && call.to.endsWith('/c/node_modules/debug')));
  });
  test('conflicting versions that alternate down a dependency cycle are refused instead of nesting forever', () => {
    const fs = memoryFs({ files: {
      '/app/package.json': manifestOf('app', '1', { a: '1', b: '1' }), '/store/a/package.json': manifestOf('a', '1', { b: '1' }), '/store/b/package.json': manifestOf('b', '1', { a: '2' }),
      '/a2/package.json': manifestOf('a', '2', { b: '2' }), '/b2/package.json': manifestOf('b', '2', { a: '1' }),
    } });
    const resolver = resolverOf({ '/store/b -> a': '/a2', '/a2 -> b': '/b2', '/b2 -> a': '/store/a' });
    assert.throws(() => stageTransitiveDependencies({ ...base, fs, resolver }), { message: /^Package version conflict while flattening b: / });
    assert.deepEqual(effects(fs), []);
  });
  test('a scoped dependency is staged under its scope directory', () => {
    const fs = memoryFs({ files: { '/app/package.json': manifestOf('app', '1', { '@s/a': '1' }), '/store/@s/a/package.json': manifestOf('@s/a', '1') } });
    assert.equal(stageTransitiveDependencies({ ...base, fs, resolver: resolverOf() }), 1);
    assert.deepEqual(effects(fs).map(call => call.op === 'copy' && call.to), ['/out/node_modules/@s/a']);
  });
});

describe('stagedPackageDirs', () => {
  test('a missing modules directory has no packages', () => { assert.deepEqual(stagedPackageDirs({ modulesDir: '/m', fs: memoryFs({ files: {} }) }), []); });
  test('hidden entries and manifest-less directories are skipped; scopes are containers', () => {
    const fs = memoryFs({ files: {
      '/m/.bin/tool': '', '/m/plain/package.json': '{}', '/m/nomanifest/index.js': '',
      '/m/@s/one/package.json': '{}', '/m/@s/two/index.js': '', '/m/@empty/.keep/x': '',
    } });
    assert.deepEqual(stagedPackageDirs({ modulesDir: '/m', fs }), ['/m/plain', '/m/@s/one']);
  });
});

describe('assertClosureComplete', () => {
  const base = { outDir: '/out', excluded: new Set(['excluded']) };
  test('a missing staged tree is refused', () => {
    assert.throws(() => assertClosureComplete({ ...base, fs: memoryFs({ files: {} }) }), { message: 'staged node_modules tree is missing' });
  });
  test('hoisted, nested and excluded dependencies satisfy the closure', () => {
    const fs = memoryFs({ files: {
      '/out/node_modules/a/package.json': manifestOf('a', '1', { b: '1', c: '1', excluded: '1' }),
      '/out/node_modules/b/package.json': manifestOf('b', '1'), '/out/node_modules/a/node_modules/c/package.json': manifestOf('c', '1'),
    } });
    assert.doesNotThrow(() => assertClosureComplete({ ...base, fs }));
  });
  test('every missing dependency is listed relative to the staged tree', () => {
    const fs = memoryFs({ files: { '/out/node_modules/a/package.json': manifestOf('a', '1', { x: '1' }), '/out/node_modules/@s/b/package.json': manifestOf('@s/b', '1', { y: '1' }), '/out/node_modules/x/index.js': '' } });
    assert.throws(() => assertClosureComplete({ ...base, fs }), { message: 'staged tree is missing 2 declared dependencies:\n  a -> x\n  @s/b -> y' });
  });
  test('an invalid declared name is refused', () => {
    const fs = memoryFs({ files: { '/out/node_modules/a/package.json': JSON.stringify({ dependencies: { '../up': '1' } }) } });
    assert.throws(() => assertClosureComplete({ ...base, fs }), { message: 'Invalid package name: ../up' });
  });
});

describe('productionDependencyOutput', () => {
  test('forwards the request without the runner and returns stdout on exit 0', () => {
    const seen: Parameters<ProcessRunnerPort['run']>[0][] = [];
    const runner: ProcessRunnerPort = { run: request => { seen.push(request); return { stdout: 'listing', exitCode: 0 }; } };
    assert.equal(productionDependencyOutput({ command: 'npm', args: ['ls'], cwd: '/app', shell: false, runner }), 'listing');
    assert.deepEqual(seen, [{ command: 'npm', args: ['ls'], cwd: '/app', shell: false }]);
  });
  test('a non-zero exit is refused with its code', () => {
    const runner: ProcessRunnerPort = { run: () => ({ stdout: 'partial', exitCode: 3 }) };
    assert.throws(() => productionDependencyOutput({ command: 'npm', args: [], cwd: '/app', shell: true, runner }), { message: 'dependency listing failed with exit 3' });
  });
});

describe('newestMtime / diskBytes', () => {
  test('a missing path is 0', () => { assert.equal(newestMtime({ absolutePath: '/none', fs: memoryFs({ files: {} }) }), 0); });
  test('a bundle-input file returns its mtime', () => { assert.equal(newestMtime({ absolutePath: '/src/a.ts', fs: memoryFs({ files: { '/src/a.ts': '' } }, { mtimes: { '/src/a.ts': 7 } }) }), 7); });
  test('a test file named directly is 0', () => { assert.equal(newestMtime({ absolutePath: '/src/a.test.ts', fs: memoryFs({ files: { '/src/a.test.ts': '' } }, { mtimes: { '/src/a.test.ts': 7 } }) }), 0); });
  test('a non-regular entry is 0', () => { assert.equal(newestMtime({ absolutePath: '/src/link', fs: memoryFs({ files: {} }, { others: ['/src/link'], mtimes: { '/src/link': 9 } }) }), 0); });
  test('a directory takes the newest bundle input, skipping hidden, dependency and test trees', () => {
    const fs = memoryFs({ files: { '/src/a.ts': '', '/src/deep/b.ts': '', '/src/.cache/x.ts': '', '/src/node_modules/y.js': '', '/src/__tests__/z.ts': '', '/src/c.spec.ts': '' } },
      { mtimes: { '/src/a.ts': 3, '/src/deep/b.ts': 5, '/src/.cache/x.ts': 90, '/src/node_modules/y.js': 91, '/src/__tests__/z.ts': 92, '/src/c.spec.ts': 93 } });
    assert.equal(newestMtime({ absolutePath: '/src', fs }), 5);
  });
  test('an empty directory is 0', () => { assert.equal(newestMtime({ absolutePath: '/src', fs: memoryFs({ files: {} }, { dirs: ['/src'] }) }), 0); });
  test('diskBytes sums files recursively', () => { assert.equal(diskBytes({ absolutePath: '/d', fs: memoryFs({ files: { '/d/a': '', '/d/e/b': '', '/d/e/c': '' } }, { diskBytes: 4 }) }), 12); });
  test('diskBytes of a file is its own size', () => { assert.equal(diskBytes({ absolutePath: '/d/a', fs: memoryFs({ files: { '/d/a': '' } }, { diskBytes: 4 }) }), 4); });
});

describe('stripNonRuntimeFiles', () => {
  test('a missing staged tree strips nothing', () => {
    const fs = memoryFs({ files: {} });
    assert.deepEqual(stripNonRuntimeFiles({ outDir: '/out', keepScopes: new Set(), fs }), { declaration: 0, sourceMap: 0, coverage: 0, bytes: 0 });
    assert.deepEqual(effects(fs), []);
  });
  test('coverage directories, declarations and unkept maps are removed and tallied', () => {
    const fs = memoryFs({ files: {
      '/out/node_modules/a/package.json': '{}', '/out/node_modules/a/coverage/index.html': '', '/out/node_modules/a/coverage/x.js': '',
      '/out/node_modules/a/dist/a.d.ts': '', '/out/node_modules/a/dist/a.js.map': '', '/out/node_modules/a/dist/a.js': '',
      '/out/node_modules/@keep/b/package.json': '{}', '/out/node_modules/@keep/b/b.js.map': '', '/out/node_modules/@keep/b/b.d.mts': '',
    } }, { diskBytes: 2 });
    assert.deepEqual(stripNonRuntimeFiles({ outDir: '/out', keepScopes: new Set(['@keep']), fs }), { declaration: 2, sourceMap: 1, coverage: 1, bytes: 10 });
    assert.deepEqual(effects(fs).map(call => call.op === 'remove' && call.path), ['/out/node_modules/a/coverage', '/out/node_modules/a/dist/a.d.ts', '/out/node_modules/a/dist/a.js.map', '/out/node_modules/@keep/b/b.d.mts']);
  });
  test('a coverage FILE is not treated as a coverage directory', () => {
    const fs = memoryFs({ files: { '/out/node_modules/a/package.json': '{}', '/out/node_modules/a/coverage': '' } });
    assert.equal(stripNonRuntimeFiles({ outDir: '/out', keepScopes: new Set(), fs }).coverage, 0);
    assert.deepEqual(effects(fs), []);
  });
});

describe('pruneNativePrebuilds', () => {
  const pkg = '/out/node_modules/native';
  test('no targets is refused', () => {
    assert.throws(() => pruneNativePrebuilds({ outDir: '/out', targets: [], fs: memoryFs({ files: {} }) }), { message: 'at least one native target is required' });
  });
  test('packages without prebuilds are left alone, build inputs included', () => {
    const fs = memoryFs({ files: { [`${pkg}/package.json`]: '{}', [`${pkg}/binding.gyp`]: '' } });
    assert.deepEqual(pruneNativePrebuilds({ outDir: '/out', targets: [{ platform: 'linux', arch: 'x64' }], fs }), { prebuilds: 0, buildInputs: 0, bytes: 0 });
    assert.deepEqual(effects(fs), []);
  });
  test('foreign prebuilds and build inputs are removed; serving, unknown and musl prebuilds stay', () => {
    const fs = memoryFs({ files: {
      [`${pkg}/package.json`]: '{}', [`${pkg}/prebuilds/linux-x64.node`]: '', [`${pkg}/prebuilds/linuxmusl-x64.node`]: '',
      [`${pkg}/prebuilds/darwin-arm64/a.node`]: '', [`${pkg}/prebuilds/win32-x64.node`]: '', [`${pkg}/prebuilds/linux-arm64.node`]: '',
      [`${pkg}/prebuilds/README`]: '', [`${pkg}/deps/x.c`]: '', [`${pkg}/binding.gyp`]: '',
    } }, { diskBytes: 3 });
    assert.deepEqual(pruneNativePrebuilds({ outDir: '/out', targets: [{ platform: 'linux', arch: 'x64' }], fs }), { prebuilds: 3, buildInputs: 2, bytes: 15 });
    assert.deepEqual(effects(fs).map(call => call.op === 'remove' && call.path), [`${pkg}/prebuilds/darwin-arm64`, `${pkg}/prebuilds/win32-x64.node`, `${pkg}/prebuilds/linux-arm64.node`, `${pkg}/deps`, `${pkg}/binding.gyp`]);
  });
  test('a musl-only prebuild serves a linux target', () => {
    const fs = memoryFs({ files: { [`${pkg}/package.json`]: '{}', [`${pkg}/prebuilds/linuxmusl-x64.node`]: '' } });
    assert.deepEqual(pruneNativePrebuilds({ outDir: '/out', targets: [{ platform: 'linux', arch: 'x64' }], fs }), { prebuilds: 0, buildInputs: 0, bytes: 0 });
  });
  test('a linux prebuild does not serve a linuxmusl target', () => {
    const fs = memoryFs({ files: { [`${pkg}/package.json`]: '{}', [`${pkg}/prebuilds/linux-x64.node`]: '' } });
    assert.throws(() => pruneNativePrebuilds({ outDir: '/out', targets: [{ platform: 'linuxmusl', arch: 'x64' }], fs }), { message: 'native ships no prebuild for every requested target: linuxmusl-x64' });
  });
  test('an unrecognised prebuild never satisfies a target', () => {
    const fs = memoryFs({ files: { [`${pkg}/package.json`]: '{}', [`${pkg}/prebuilds/README`]: '' } });
    assert.throws(() => pruneNativePrebuilds({ outDir: '/out', targets: [{ platform: 'linux', arch: 'x64' }], fs }), { message: 'native ships no prebuild for every requested target: linux-x64' });
  });
  test('a later unserved package aborts before an earlier package is pruned', () => {
    const fs = memoryFs({ files: {
      '/out/node_modules/a/package.json': '{}', '/out/node_modules/a/prebuilds/linux-x64+arm64.node': '', '/out/node_modules/a/prebuilds/win32-x64.node': '',
      '/out/node_modules/a/binding.gyp': '', '/out/node_modules/b/package.json': '{}', '/out/node_modules/b/prebuilds/linux-x64.node': '',
    } });
    assert.throws(() => pruneNativePrebuilds({ outDir: '/out', targets: [{ platform: 'linux', arch: 'x64' }, { platform: 'linux', arch: 'arm64' }], fs }), { message: 'b ships no prebuild for every requested target: linux-x64, linux-arm64' });
    assert.deepEqual(effects(fs), []);
  });
});

describe('stagePayloadFiles', () => {
  const base = { repoRoot: '/repo', outDir: '/out' };
  for (const relative of ['', '/abs/file', '../up', 'a/../../up', './a', 'a/./b', `a${BACKSLASH}..${BACKSLASH}up`]) {
    test(`an unsafe payload path ${JSON.stringify(relative)} is refused before any copy`, () => {
      const fs = memoryFs({ files: { '/repo/ok': '' } });
      assert.throws(() => stagePayloadFiles({ ...base, relativePaths: ['ok', relative], fs }), { message: `Unsafe payload path: ${relative}` });
      assert.deepEqual(effects(fs), []);
    });
  }
  test('a missing payload input is refused before any copy', () => {
    const fs = memoryFs({ files: { '/repo/ok': '' } });
    assert.throws(() => stagePayloadFiles({ ...base, relativePaths: ['ok', 'gone'], fs }), { message: 'Missing payload input: gone' });
    assert.deepEqual(effects(fs), []);
  });
  test('each payload is copied to the same relative path under outDir', () => {
    const fs = memoryFs({ files: { '/repo/a/b.js': '', '/repo/c': '' } });
    stagePayloadFiles({ ...base, relativePaths: ['a/b.js', 'c'], fs });
    assert.deepEqual(effects(fs), [{ op: 'copy', from: '/repo/a/b.js', to: '/out/a/b.js', dropNestedModules: undefined, excluding: false }, { op: 'copy', from: '/repo/c', to: '/out/c', dropNestedModules: undefined, excluding: false }]);
  });
});

describe('stageBundledNpm', () => {
  const base = { npmSource: '/npm', outDir: '/stage/npm', marker: 'bin/npx-cli.js', droppedDirectoryNames: new Set(['docs']), droppedFileSuffixes: ['.ps1'] };
  for (const marker of ['', '/abs', '../x', 'bin/../x', './x', `bin${BACKSLASH}..${BACKSLASH}x`]) {
    test(`an unsafe marker ${JSON.stringify(marker)} is refused`, () => {
      assert.throws(() => stageBundledNpm({ ...base, marker, fs: memoryFs({ files: {} }) }), { message: 'Invalid npm marker' });
    });
  }
  test('a missing marker names the marker and source', () => {
    assert.throws(() => stageBundledNpm({ ...base, fs: memoryFs({ files: {} }) }), { message: 'stageBundledNpm: no bin/npx-cli.js under /npm' });
  });
  for (const [label, outDir] of [['the same directory', '/real/npm'], ['inside the source', '/real/npm/out'], ['an ancestor of the source', '/real']] as const) {
    test(`a destination that is ${label} is refused using the source's real path`, () => {
      const fs = memoryFs({ files: { '/npm/bin/npx-cli.js': '' } }, { realpaths: { '/npm': '/real/npm' } });
      assert.throws(() => stageBundledNpm({ ...base, outDir, fs }), { message: 'npm source and staging destination must be disjoint' });
      assert.deepEqual(effects(fs), []);
    });
  }
  test('the filesystem root as destination is not detected as an ancestor of the source (reported, not fixed)', () => {
    // Bug: `source.startsWith(target + path.sep)` becomes `startsWith('//')` when target is '/', so
    // the disjointness check passes and the staging step goes on to remove the destination '/'.
    const fs = memoryFs({ files: { '/npm/bin/npx-cli.js': 'js' } });
    // The fake cannot stat '/' once it has been emptied, so the run ends there; the pinned point is
    // that the disjointness refusal never fired and the root was removed.
    assert.throws(() => stageBundledNpm({ ...base, outDir: '/', fs }), { message: 'ENOENT: /' });
    assert.deepEqual(effects(fs).find(call => call.op === 'remove'), { op: 'remove', path: '/' });
  });
  test('a sibling whose name only shares a prefix is not overlapping', () => {
    const fs = memoryFs({ files: { '/npm/bin/npx-cli.js': 'js' } });
    assert.equal(stageBundledNpm({ ...base, outDir: '/npm-out', fs }).fileCount, 1);
  });
  test('a missing prefix-read port is refused before reading', () => {
    const fs = memoryFs({ files: { '/npm/bin/npx-cli.js': '' } }, { withoutPrefix: true });
    assert.throws(() => stageBundledNpm({ ...base, fs }), { message: 'stageBundledNpm: bounded prefix-read port is required' });
    assert.deepEqual(effects(fs), []);
  });
  test('a non-regular input is refused by full path', () => {
    const fs = memoryFs({ files: { '/npm/bin/npx-cli.js': '' } }, { others: ['/npm/bin/link'] });
    assert.throws(() => stageBundledNpm({ ...base, fs }), { message: 'stageBundledNpm: nonregular input /npm/bin/link' });
  });
  test('native magic in a nested file is refused by relative path before any removal', () => {
    const fs = memoryFs({ files: { '/npm/bin/npx-cli.js': '', '/npm/node_modules/x/bin': Buffer.from('cafebabe00', 'hex') } });
    assert.throws(() => stageBundledNpm({ ...base, fs }), { message: 'stageBundledNpm: node_modules/x/bin starts with native-binary magic bytes' });
    assert.ok(!effects(fs).some(call => call.op === 'remove' || call.op === 'copy'));
  });
  test('dropped directories and suffixes are not inspected, not copied and not counted', () => {
    const native = Buffer.from('7f454c46', 'hex');
    const fs = memoryFs({ files: { '/npm/bin/npx-cli.js': 'js', '/npm/bin/npm.ps1': native, '/npm/docs/help.md': native, '/npm/lib/a.js': 'js', '/stage/npm/stale': '' } }, { diskBytes: 5 });
    assert.deepEqual(stageBundledNpm({ ...base, fs }), { fileCount: 2, bytes: 10 });
    assert.deepEqual(fs.calls.map(call => call.op === 'readPrefix' && call.path).filter(Boolean), ['/npm/bin/npx-cli.js', '/npm/lib/a.js']);
    assert.deepEqual(effects(fs), [{ op: 'remove', path: '/stage/npm' }, { op: 'copy', from: '/npm', to: '/stage/npm', dropNestedModules: undefined, excluding: true }]);
    assert.deepEqual([...fs.files.keys()].filter(file => file.startsWith('/stage/')).sort(), ['/stage/npm/bin/npx-cli.js', '/stage/npm/lib/a.js']);
  });
  test('the destination overlap check ignores symlinked destination ancestors (reported, not fixed)', () => {
    // TOCTOU/containment weakness: outDir is compared with path.resolve, never realpath, so an
    // outDir under a symlink pointing into the npm source passes and is then removed. Pinned only.
    const fs = memoryFs({ files: { '/npm/bin/npx-cli.js': 'js' } }, { realpaths: { '/link-into-npm': '/npm' } });
    stageBundledNpm({ ...base, outDir: '/link-into-npm/sub', fs });
    assert.deepEqual(effects(fs).find(call => call.op === 'remove'), { op: 'remove', path: '/link-into-npm/sub' });
  });
});

test('stripping follows a symlinked staged package and deletes outside the staged tree (reported, not fixed)', () => {
  // Containment weakness: stagedPackageDirs accepts a node_modules entry that is a symlink (exists()
  // follows it), so its coverage/ directory is removed in the link TARGET, outside outDir. The
  // doc comment asks callers to stage real copies; nothing enforces it. Pinned only.
  const root = nodeFs.realpathSync(nodeFs.mkdtempSync(path.join(os.tmpdir(), 'strip-link-')));
  try {
    const outside = path.join(root, 'source-pkg');
    nodeFs.mkdirSync(path.join(outside, 'coverage'), { recursive: true });
    nodeFs.writeFileSync(path.join(outside, 'package.json'), '{}');
    nodeFs.writeFileSync(path.join(outside, 'coverage/index.html'), 'x');
    nodeFs.mkdirSync(path.join(root, 'out/node_modules'), { recursive: true });
    nodeFs.symlinkSync(outside, path.join(root, 'out/node_modules/linked'), 'dir');
    assert.equal(stripNonRuntimeFiles({ outDir: path.join(root, 'out'), keepScopes: new Set(), fs: createNodePackagingFilesystem({}) }).coverage, 1);
    assert.equal(nodeFs.existsSync(path.join(outside, 'coverage')), false);
  } finally { nodeFs.rmSync(root, { recursive: true, force: true }); }
});

test('packaged siblings keep the dependency version they resolved before a later sibling is staged', () => {
  const fs = memoryFs({ files: {
    '/app/package.json': manifestOf('app', '1', { b: '1', shared: '1' }),
    '/store/shared/package.json': manifestOf('shared', '1'),
    '/store/b/package.json': manifestOf('b', '1', { inner: '1', a: '1', c: '1' }),
    // Force b's children to stay nested, as in an ordinary npm tree with version conflicts.
    '/out/node_modules/inner/package.json': manifestOf('inner', '2'),
    '/out/node_modules/a/package.json': manifestOf('a', '2'),
    '/out/node_modules/c/package.json': manifestOf('c', '2'),
    '/store/b/node_modules/inner/package.json': manifestOf('inner', '1', { shared: '1' }),
    '/store/b/node_modules/a/package.json': manifestOf('a', '1', { shared: '1' }),
    '/store/b/node_modules/c/package.json': manifestOf('c', '1', { shared: '2' }),
    '/store/b/node_modules/shared/package.json': manifestOf('shared', '2'),
  } });
  const resolver = resolverOf({
    '/store/b -> inner': '/store/b/node_modules/inner',
    '/store/b -> a': '/store/b/node_modules/a',
    '/store/b -> c': '/store/b/node_modules/c',
    '/store/b/node_modules/inner -> shared': '/store/shared',
    '/store/b/node_modules/a -> shared': '/store/shared',
    '/store/b/node_modules/c -> shared': '/store/b/node_modules/shared',
  });
  stageTransitiveDependencies({ roots: ['/app'], outDir: '/out', excluded: new Set(), fs, resolver });
  // Resolve the shipped tree by Node's ancestor rule, not just its planned copy inventory.
  const versionSeenFrom = (directory: string): string | undefined => {
    for (let current = directory; current.startsWith('/out'); current = path.dirname(current)) {
      const file = path.join(current, 'node_modules/shared/package.json');
      if (fs.exists({ path: file })) return (JSON.parse(Buffer.from(fs.read({ path: file })).toString('utf8')) as { version: string }).version;
    }
    return undefined;
  };
  assert.equal(versionSeenFrom('/out/node_modules/b/node_modules/inner'), '1');
  assert.equal(versionSeenFrom('/out/node_modules/b/node_modules/a'), '1');
  assert.equal(versionSeenFrom('/out/node_modules/b/node_modules/c'), '2');
});
