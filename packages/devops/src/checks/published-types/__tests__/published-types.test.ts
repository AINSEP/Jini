import { afterEach, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { check, diagnosePublishedTypes, parseDiagnosticBlocks, registryDependencies } from '../index.js';
import type { CompileProject } from '../index.js';
import type { ProcessRequest, ProcessResult } from '../../ports.js';
import { createNodeFilesystem } from '../../node.js';

const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const pass: ProcessResult = { exitCode: 0, stdout: '', stderr: '' };
const diagnostic = (message: string): ProcessResult => ({ exitCode: 1, stdout: `src/main.ts(1,2): error TS2305: ${message}\n`, stderr: '' });

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'published-types-'));
  roots.push(directory);
  const fs = createNodeFilesystem({});
  const shadowAnchor = path.join(directory, 'source');
  mkdirSync(shadowAnchor);
  const manifestPath = path.join(directory, 'package.json');
  writeFileSync(manifestPath, JSON.stringify({ dependencies: { '@example/core': '^1.0.0' }, overrides: { '@example/core': '$@example/core', unrelated: '1' } }));
  const project: CompileProject = {
    key: 'example', directory, manifestPath, mode: 'drift', scratchParent: directory,
    shadowAnchor, prerequisites: [], compiler: { command: 'compiler', args: ['--noEmit', '-p', 'tsconfig.json'], cwd: directory },
  };
  const installer = { install: vi.fn(async ({ directory: scratch }: { directory: string }) => {
    for (const name of ['core', 'transitive']) {
      const dir = path.join(scratch, 'node_modules', '@example', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    }
    return pass;
  }) };
  const runner = { run: vi.fn(async (_request: ProcessRequest): Promise<ProcessResult> => pass) };
  return { directory, project, fs, installer, runner, args: { projects: [project], scope: '@example', fs, installer, runner } };
}

test('filters scoped registry dependencies, exempting all explicit local spec forms', () => {
  expect(registryDependencies({ scope: '@example', manifest: {
    dependencies: { '@example/a': '^1', '@example/b': 'file:../b', '@example/c': 'link:../c', '@example/d': 'workspace:*', elsewhere: '1' },
    devDependencies: { '@example/e': '~2' },
  } })).toEqual({ '@example/a': '^1', '@example/e': '~2' });
});

test('preserves multiline diagnostics while normalizing CRLF', () => {
  expect(parseDiagnosticBlocks({ output: 'banner\r\na.ts(1,2): error TS1: first\r\n  detail\r\nb.ts(3,4): error TS2: second\r\n' })).toEqual([
    'a.ts(1,2): error TS1: first\n  detail', 'b.ts(3,4): error TS2: second',
  ]);
});

test('isolates new registry diagnostics, shadows transitive scoped packages, and cleans up', async () => {
  const f = fixture();
  const old = diagnostic('old error');
  f.runner.run.mockImplementationOnce(async () => {
    expect(f.fs.exists({ path: path.join(f.project.shadowAnchor, 'node_modules', '@example') })).toBe(false);
    return old;
  }).mockImplementationOnce(async () => {
    expect(f.fs.exists({ path: path.join(f.project.shadowAnchor, 'node_modules', '@example', 'transitive', 'package.json') })).toBe(true);
    return { ...diagnostic('new error'), stdout: old.stdout + diagnostic('new error').stdout };
  });
  const result = await check(f.args);
  expect(result.ok).toBe(false);
  expect(result.projects[0]?.status).toBe('drift');
  expect(result.projects[0]?.diagnostics).toEqual(['src/main.ts(1,2): error TS2305: new error']);
  expect([...f.fs.readDirectory({ path: f.directory })].sort()).toEqual(['package.json', 'source']);
  expect(f.fs.readDirectory({ path: f.project.shadowAnchor })).toEqual([]);
});

test('identical local errors pass the drift comparison and remain reported', async () => {
  const f = fixture();
  f.runner.run.mockResolvedValue(diagnostic('old error'));
  const result = await check(f.args);
  expect(result.ok).toBe(true);
  expect(result.projects[0]?.baselineDiagnostics).toEqual(['src/main.ts(1,2): error TS2305: old error']);
});

test('published mode fails on identical errors instead of using a baseline', async () => {
  const f = fixture();
  f.project.mode = 'published';
  f.runner.run.mockResolvedValue(diagnostic('old error'));
  const result = await check(f.args);
  expect(result.ok).toBe(false);
  expect(result.projects[0]?.status).toBe('typecheck-error');
  expect(f.runner.run).toHaveBeenCalledTimes(1);
});

test.each([null, 1])('non-diagnostic compiler failure %s never passes by subtracting an empty set', async (exitCode) => {
  const f = fixture();
  f.runner.run.mockResolvedValueOnce(pass).mockResolvedValueOnce({ exitCode, stdout: '', stderr: 'compiler crashed' });
  expect((await check(f.args)).projects[0]?.status).toBe('typecheck-error');
});

test('refuses to replace an existing shadow scope and leaves it untouched', async () => {
  const f = fixture();
  const scopeDir = path.join(f.project.shadowAnchor, 'node_modules', '@example');
  mkdirSync(scopeDir, { recursive: true });
  writeFileSync(path.join(scopeDir, 'owned.txt'), 'keep');
  const result = await check(f.args);
  expect(result.projects[0]?.status).toBe('operation-error');
  expect(readFileSync(path.join(scopeDir, 'owned.txt'), 'utf8')).toBe('keep');
});

test('partial shadow copy is cleaned even when the filesystem throws', async () => {
  const f = fixture();
  const fs = { ...f.fs, copyDirectory: vi.fn(({ destination }: { source: string; destination: string }) => {
    writeFileSync(path.join(destination, 'partial'), 'partial');
    throw new Error('copy failed');
  }) };
  const result = await check({ ...f.args, fs });
  expect(result.projects[0]?.status).toBe('operation-error');
  expect(f.fs.readDirectory({ path: f.project.shadowAnchor })).toEqual([]);
});

test('installation errors clean scratch and do not run the compiler', async () => {
  const f = fixture();
  f.installer.install.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'install failed' });
  const result = await check(f.args);
  expect(result.projects[0]?.status).toBe('install-error');
  expect(f.runner.run).not.toHaveBeenCalled();
  expect([...f.fs.readDirectory({ path: f.directory })].sort()).toEqual(['package.json', 'source']);
});

test('an installed transitive scoped link cannot masquerade as a registry package', async () => {
  const f = fixture();
  f.installer.install.mockImplementation(async ({ directory }) => {
    const scopeDir = path.join(directory, 'node_modules', '@example');
    mkdirSync(scopeDir, { recursive: true });
    symlinkSync(f.directory, path.join(scopeDir, 'transitive'), 'dir');
    return pass;
  });
  const result = await check(f.args);
  expect(result.ok).toBe(false);
  expect(result.projects[0]?.status).toBe('operation-error');
  expect(result.projects[0]?.output).toMatch(/linked: transitive/);
  expect(f.runner.run).not.toHaveBeenCalled();
});

test('prerequisites precede compilation, and scoped overrides reach the scratch manifest', async () => {
  const f = fixture();
  const prerequisite = { command: 'prepare', args: [], cwd: f.directory };
  f.project.prerequisites = [prerequisite];
  f.installer.install.mockImplementation(async ({ directory }) => {
    const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
    expect(manifest.overrides).toEqual({ '@example/core': '$@example/core' });
    const dir = path.join(directory, 'node_modules', '@example', 'core');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), '{"version":"1.2.3"}');
    return pass;
  });
  expect((await check(f.args)).ok).toBe(true);
  expect(f.runner.run.mock.calls[0]?.[0]).toEqual(prerequisite);
});

test('missing manifests fail, while explicit local dependencies skip registry compilation', async () => {
  const f = fixture();
  writeFileSync(f.project.manifestPath, '{"dependencies":{"@example/core":"workspace:*"}}');
  expect((await check(f.args)).projects[0]?.status).toBe('skipped');
  expect(f.installer.install).not.toHaveBeenCalled();
  rmSync(f.project.manifestPath);
  expect((await check(f.args)).projects[0]?.status).toBe('operation-error');
});

test('links mode flags only symlinks for registry-declared scoped dependencies', async () => {
  const f = fixture();
  const fs = { ...f.fs, exists: () => true, isSymbolicLink: () => true };
  const result = await check({ ...f.args, fs, projects: [{ key: 'links', mode: 'links', directory: f.directory, manifestPath: f.project.manifestPath }] });
  expect(result.projects[0]?.linkedPackages).toEqual(['@example/core']);
  expect(result.projects[0]?.status).toBe('linked');
  expect(f.installer.install).not.toHaveBeenCalled();
});

test('diagnoses missing scoped exports/modules but retains unrelated failures', () => {
  const logs = [{ projectKey: 'a', ...diagnostic(`Module '\"@example/core\"' has no exported member 'Thing'.`) },
    { projectKey: 'b', ...diagnostic(`Cannot find module '@example/core/new' or its corresponding type declarations.`) },
    { projectKey: 'c', ...diagnostic('unrelated') }];
  expect(diagnosePublishedTypes({ scope: '@example', logs })).toEqual({ ok: false, failures: [
    { ...logs[0], hits: ["missing export 'Thing'"] },
    { ...logs[1], hits: ["missing module '@example/core/new'"] },
    { ...logs[2], hits: [] },
  ] });
});
