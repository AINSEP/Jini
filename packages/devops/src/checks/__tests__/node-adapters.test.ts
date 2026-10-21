import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeFilesystem, createNodeProcessRunner, createNpmInstaller } from '../node.js';

const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test('npm adapter uses the supplied executable, scratch cwd and script-free default flags', async () => {
  const result = { exitCode: 0, stdout: 'installed', stderr: '' };
  const run = vi.fn().mockResolvedValue(result);
  const installer = createNpmInstaller({ runner: { run }, command: 'npm-fixture' });
  expect(await installer.install({ directory: '/scratch' })).toBe(result);
  expect(run).toHaveBeenCalledWith({ command: 'npm-fixture', cwd: '/scratch', args: [
    'install', '--no-audit', '--no-fund', '--no-package-lock', '--workspaces=false', '--ignore-scripts',
  ] });
  const custom = createNpmInstaller({ runner: { run }, command: 'custom-installer' }, { args: ['install', '--offline'] });
  await custom.install({ directory: '/other-scratch' });
  expect(run).toHaveBeenLastCalledWith({ command: 'custom-installer', cwd: '/other-scratch', args: ['install', '--offline'] });
});

test('Node runner captures stdout, stderr and a nonzero numeric exit code without a shell', async () => {
  const runner = createNodeProcessRunner({});
  const result = await runner.run({ command: process.execPath, cwd: process.cwd(), args: ['-e',
    'process.stdout.write("fixture stdout"); process.stderr.write("fixture stderr"); process.exitCode = 7;',
  ] });
  expect(result).toEqual({ exitCode: 7, stdout: 'fixture stdout', stderr: 'fixture stderr' });
});

test('Node runner reports an executable that cannot spawn as a null exit', async () => {
  const result = await createNodeProcessRunner({}).run({ command: '/missing-executable-for-devops-fixture', cwd: process.cwd(), args: [] });
  expect(result.exitCode).toBeNull();
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/ENOENT/);
});

test('Node runner reports a clean exit as 0 with empty stderr rather than an error message', async () => {
  const result = await createNodeProcessRunner({}).run({ command: process.execPath, cwd: process.cwd(), args: ['-e',
    'process.stdout.write("clean stdout");',
  ] });
  expect(result).toEqual({ exitCode: 0, stdout: 'clean stdout', stderr: '' });
});

test('Node runner kills a child that outlives the caller-supplied timeout and reports it as a null exit', async () => {
  const runner = createNodeProcessRunner({}, { timeoutMs: 100 });
  const result = await runner.run({ command: process.execPath, cwd: process.cwd(), args: ['-e', 'setTimeout(() => {}, 30000);'] });
  expect(result.exitCode).toBeNull();
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/Command failed/);
});

test('Node filesystem ensureDirectory creates missing parents and tolerates an existing directory, unlike createDirectory', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devops-fs-'));
  scratch.push(root);
  const fs = createNodeFilesystem({});
  const nested = path.join(root, 'a', 'b', 'c');
  expect(() => fs.createDirectory({ path: nested })).toThrow(/ENOENT/);
  fs.ensureDirectory({ path: nested });
  expect(statSync(nested).isDirectory()).toBe(true);
  expect(() => fs.ensureDirectory({ path: nested })).not.toThrow();
  expect(fs.exists({ path: nested })).toBe(true);
  expect(() => fs.createDirectory({ path: nested })).toThrow(/EEXIST/);
});
