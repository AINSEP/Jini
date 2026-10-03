import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadRepoRootEnvFile, parseLsofListeners, listenersOn } from '../index.js';
import { createNodeFilesystem, createNodeEnvLoader } from '../../checks/node.js';

// Generalized from the environment-loader and listener-parser regression suites.
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test('a missing environment file is not loaded', () => {
  const loader = { load: vi.fn() };
  expect(loadRepoRootEnvFile({ environmentFile: '/repo/config/dev.env', fs: { exists: () => false }, loader })).toBe(false);
  expect(loader.load).not.toHaveBeenCalled();
});

test('loads exactly the caller-specified environment path', () => {
  const loader = { load: vi.fn() };
  expect(loadRepoRootEnvFile({ environmentFile: '/repo/config/dev.env', fs: { exists: () => true }, loader })).toBe(true);
  expect(loader.load).toHaveBeenCalledTimes(1);
  expect(loader.load).toHaveBeenCalledWith({ path: '/repo/config/dev.env' });
});

test('the Node adapter fills missing values and preserves shell exports', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devops-env-'));
  scratch.push(dir);
  const key = 'DEVOPS_ENV_FIXTURE_ONLY';
  const prior = process.env[key];
  writeFileSync(path.join(dir, 'dev.env'), `${key}=from-file\n`);
  try {
    delete process.env[key];
    const args = { environmentFile: path.join(dir, 'dev.env'), fs: createNodeFilesystem({}), loader: createNodeEnvLoader({}) };
    expect(loadRepoRootEnvFile(args)).toBe(true);
    expect(process.env[key]).toBe('from-file');
    process.env[key] = 'from-shell';
    loadRepoRootEnvFile(args);
    expect(process.env[key]).toBe('from-shell');
  } finally {
    if (prior === undefined) delete process.env[key]; else process.env[key] = prior;
  }
});

test.each<[string, { pid: string; command: string }[]]>([
  ['p41207\ncnode\np41310\ncvite\n', [{ pid: '41207', command: 'node' }, { pid: '41310', command: 'vite' }]],
  ['', []],
  ['cvite\np41310\ncnode\n', [{ pid: '41310', command: 'node' }]],
  ['p41207\np41310\ncvite\n', [{ pid: '41310', command: 'vite' }]],
])('parses complete pid/command pairs: %s', (stdout, expected) => {
  expect(parseLsofListeners({ stdout })).toEqual(expected);
});

test('uses the supplied listener command and treats an unavailable tool as no conflict', async () => {
  const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'p12\ncworker\n', stderr: '' });
  const listenerCommand = ({ port }: { port: number }) => ({ command: 'listener-tool', args: [String(port)], cwd: '/repo' });
  expect(await listenersOn({ port: 4000, runner: { run }, listenerCommand })).toEqual([{ pid: '12', command: 'worker' }]);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith({ command: 'listener-tool', args: ['4000'], cwd: '/repo' });
  run.mockResolvedValue({ exitCode: null, stdout: 'p12\ncworker\n', stderr: 'unavailable' });
  expect(await listenersOn({ port: 4000, runner: { run }, listenerCommand })).toEqual([]);
  run.mockRejectedValue(new Error('unavailable'));
  expect(await listenersOn({ port: 4000, runner: { run }, listenerCommand })).toEqual([]);
  await expect(listenersOn({ port: 0, runner: { run }, listenerCommand })).rejects.toThrow('port');
});
