import assert from 'node:assert/strict';
import { test } from 'vitest';
import { treeQuietProblems, isBundleInput, shellStalenessFailure, parseNpmLsPaths, prebuildTarget, resolveTargets, resolveNpmLsCommand, strippableReason } from '../policies.js';
test('quiet, watcher, dirty and moving signals remain distinct; fresh checkout mtimes are irrelevant', () => {
  assert.deepEqual(treeQuietProblems({ watcherRunning: false, surface: 'shell' }), []);
  const problems = treeQuietProblems({ watcherRunning: true, surface: 'shell', gitDirtyPaths: ['src/foo.js'], movingPaths: ['dist'] });
  assert.equal(problems.length, 3); assert.match(problems[0]!, /watch/); assert.match(problems[1]!, /src\/foo.js/); assert.match(problems[2]!, /dist/);
});
test('twelve-day-stale bundle is refused with the caller remedy; zero/newer/equal timestamps defer or pass', () => {
  const shell = { relative: 'shell/dist', marker: 'index.html', buildWith: 'build shell' };
  const sourceAt = 12 * 86_400_000;
  const failure = shellStalenessFailure({ builtAt: 1, sourceAt: sourceAt + 1, shell });
  assert.match(failure!, /STALE/); assert.match(failure!, /12\.0 day\(s\)/); assert.match(failure!, /build shell/);
  for (const [builtAt, sourceAt] of [[0, 100], [100, 0], [100, 100], [200, 100]]) assert.equal(shellStalenessFailure({ builtAt: builtAt!, sourceAt: sourceAt!, shell }), null);
});
test('tests and measurements do not make a shell stale, conservative ordinary filenames do', () => {
  for (const relPath of ['src/__tests__/unit/a.tsx', '__tests__/a.ts', 'src/a.test.tsx', 'src/a.spec.mjs', 'src/__measurements__/perf.ts', String.raw`src\__tests__\a.ts`]) assert.equal(isBundleInput({ relPath }), false);
  for (const relPath of ['src/test-utils.ts', 'src/testing.ts', 'src/contest.ts', 'package.json', 'styles.css']) assert.equal(isBundleInput({ relPath }), true);
});
test('npm paths support CRLF and both separators; target options never read product env vars', () => {
  assert.deepEqual(parseNpmLsPaths({ stdout: '/modules/a\r\n/modules/a\r\n/modules/@scope/b\r\n/elsewhere', modulesDir: '/modules', separator: '/' }), ['@scope/b', 'a']);
  assert.deepEqual(parseNpmLsPaths({ stdout: String.raw`C:\modules\a` + '\r\n', modulesDir: String.raw`C:\modules`, separator: String.fromCharCode(92) }), ['a']);
  assert.deepEqual(resolveTargets({ host: { platform: 'darwin', arch: 'x64' } }, { arch: 'universal' }), [{ platform: 'darwin', arch: 'x64' }, { platform: 'darwin', arch: 'arm64' }]);
  assert.deepEqual(resolveNpmLsCommand({ platform: 'win32', execPath: 'node' }, { npmExecPath: 'npm-cli.js' }), { command: 'node', args: ['npm-cli.js', 'ls', '--omit=dev', '--parseable', '--all'], shell: false });
  assert.equal(resolveNpmLsCommand({ platform: 'win32', execPath: 'node' }).shell, true);
});
test('prebuilds retain multi-architecture tags and maps keep only explicitly supplied scopes', () => {
  assert.deepEqual(prebuildTarget({ entryName: 'darwin-x64+arm64.node' }), { platform: 'darwin', architectures: ['x64', 'arm64'] });
  assert.equal(prebuildTarget({ entryName: 'node-v127-darwin-x64' }), undefined);
  const keepScopes = new Set(['@vendor']);
  assert.equal(strippableReason({ relPath: '@vendor/core/dist/a.js.map', keepScopes }), undefined);
  assert.equal(strippableReason({ relPath: '@vendor/core/a.d.ts.map', keepScopes }), 'declaration');
  assert.equal(strippableReason({ relPath: 'third/a.js.map', keepScopes }), 'sourceMap');
});
