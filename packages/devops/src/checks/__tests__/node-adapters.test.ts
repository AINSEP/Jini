import { expect, test, vi } from 'vitest';
import { createNodeProcessRunner, createNpmInstaller } from '../node.js';

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
