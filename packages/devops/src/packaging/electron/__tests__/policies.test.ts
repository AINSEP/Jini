import assert from 'node:assert/strict';
import { test } from 'vitest';
import { treeQuietProblems, isBundleInput, shellStalenessFailure, parseNpmLsPaths, prebuildTarget, resolveTargets, resolveNpmLsCommand, strippableReason } from '../policies.js';
test('quiet, watcher, dirty and moving signals remain distinct; fresh checkout mtimes are irrelevant', () => {
  assert.deepEqual(treeQuietProblems({ watcherRunning: false, surface: 'shell' }), []);
  const problems = treeQuietProblems({ watcherRunning: true, surface: 'shell', gitDirtyPaths: ['src/foo.js'], movingPaths: ['dist'] });
  assert.equal(problems.length, 3); assert.match(problems[0]!, /watch/); assert.match(problems[1]!, /src\/foo.js/); assert.match(problems[2]!, /dist/);
});
test('each signal alone is exactly one problem naming its paths; empty lists are quiet', () => {
  assert.deepEqual(treeQuietProblems({ watcherRunning: false, surface: 'shell', gitDirtyPaths: [], movingPaths: [] }), []);
  const watcher = treeQuietProblems({ watcherRunning: true, surface: 'shell' });
  assert.deepEqual(watcher, ['a build watch process is rewriting shell; stop it before packaging.']);
  assert.deepEqual(treeQuietProblems({ watcherRunning: false, surface: 'shell', gitDirtyPaths: ['src/a.ts', 'bin/b.ts'] }), ['shell has uncommitted changes: src/a.ts, bin/b.ts.']);
});
test('a path that changed during the observation window refuses packaging on its own, naming the surface and every moving path', () => {
  const problems = treeQuietProblems({ watcherRunning: false, surface: 'shell', gitDirtyPaths: [], movingPaths: ['shell/dist', 'shell/bin'] });
  assert.deepEqual(problems, ['shell is still being written to: shell/dist, shell/bin changed during this check.']);
});
test('host formatters replace each default message verbatim and receive the surface and the paths', () => {
  const seen: unknown[] = [];
  const formatters = {
    watcherRunning: (args: { surface: string }) => { seen.push(['watch', args]); return `W:${args.surface}`; },
    gitDirty: (args: { surface: string; paths: readonly string[] }) => { seen.push(['dirty', args]); return `D:${args.paths.join('|')}`; },
    moving: (args: { surface: string; paths: readonly string[] }) => { seen.push(['moving', args]); return `M:${args.paths.join('|')}`; },
  };
  const problems = treeQuietProblems({ watcherRunning: true, surface: 'host/app', gitDirtyPaths: ['a'], movingPaths: ['b', 'c'] }, { formatters });
  assert.deepEqual(problems, ['W:host/app', 'D:a', 'M:b|c']);
  assert.deepEqual(seen, [['watch', { surface: 'host/app' }], ['dirty', { surface: 'host/app', paths: ['a'] }], ['moving', { surface: 'host/app', paths: ['b', 'c'] }]]);
  // Formatters only word a problem; they are never consulted for a quiet signal.
  seen.length = 0;
  assert.deepEqual(treeQuietProblems({ watcherRunning: false, surface: 'host/app', movingPaths: [] }, { formatters }), []);
  assert.deepEqual(seen, []);
});
test('a partial formatter set falls back to the default wording for the signals it omits', () => {
  const problems = treeQuietProblems({ watcherRunning: true, surface: 'shell', movingPaths: ['dist'] }, { formatters: { moving: ({ paths }) => `moving ${paths.join(',')}` } });
  assert.deepEqual(problems, ['a build watch process is rewriting shell; stop it before packaging.', 'moving dist']);});
test('twelve-day-stale bundle is refused with the caller remedy; zero/newer/equal timestamps defer or pass', () => {
  const shell = { relative: 'shell/dist', marker: 'index.html', buildWith: 'build shell' };
  const sourceAt = 12 * 86_400_000;
  const failure = shellStalenessFailure({ builtAt: 1, sourceAt: sourceAt + 1, shell });
  assert.match(failure!, /STALE/); assert.match(failure!, /12\.0 day\(s\)/); assert.match(failure!, /build shell/);
  for (const [builtAt, sourceAt] of [[0, 100], [100, 0], [100, 100], [200, 100]]) assert.equal(shellStalenessFailure({ builtAt: builtAt!, sourceAt: sourceAt!, shell }), null);
});
test('an injected consequence sits between the age and the remedy; one second is still stale and age is whole-day rounded', () => {
  const shell = { relative: 'shell/dist', marker: 'index.html', buildWith: 'build shell' };
  const failure = shellStalenessFailure({ builtAt: 1, sourceAt: 3 * 86_400_000 + 1, shell }, { consequence: 'Packaging this ships stale code.' });
  assert.match(failure!, /3\.0 day\(s\) older than its own source\. Packaging this ships stale code\. Rebuild it with: build shell$/);
  assert.doesNotMatch(shellStalenessFailure({ builtAt: 1, sourceAt: 2, shell })!, /Packaging/);
  assert.ok(shellStalenessFailure({ builtAt: 1_000, sourceAt: 2_000, shell }), 'no tolerance window');
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
test('prebuild tags without a platform-architecture split or with an empty architecture are left unclassified', () => {
  // No dash at all, and a dash in first position, both mean there is no platform segment to read.
  assert.equal(prebuildTarget({ entryName: 'linux.node' }), undefined);
  assert.equal(prebuildTarget({ entryName: '-x64.node' }), undefined);
  // A trailing or doubled '+' yields an empty architecture, which is not guessed at.
  assert.equal(prebuildTarget({ entryName: 'linux-x64+.node' }), undefined);
  assert.equal(prebuildTarget({ entryName: 'win32-x64++arm64' }), undefined);
  // Directory-style tags (no .node suffix) classify the same way as file tags.
  assert.deepEqual(prebuildTarget({ entryName: 'linuxmusl-arm64' }), { platform: 'linuxmusl', architectures: ['arm64'] });
});
test('explicit platform/arch options override the host target; an empty override falls back to the host', () => {
  assert.deepEqual(resolveTargets({ host: { platform: 'darwin', arch: 'x64' } }, { platform: 'linux', arch: 'arm64' }), [{ platform: 'linux', arch: 'arm64' }]);
  assert.deepEqual(resolveTargets({ host: { platform: 'darwin', arch: 'x64' } }, { platform: '', arch: '' }), [{ platform: 'darwin', arch: 'x64' }]);
  assert.deepEqual(resolveNpmLsCommand({ platform: 'linux', execPath: 'node' }), { command: 'npm', args: ['ls', '--omit=dev', '--parseable', '--all'], shell: false });
});
