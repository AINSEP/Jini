import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  cpSync: vi.fn(), mkdirSync: vi.fn(), mkdtempSync: vi.fn(), readFileSync: vi.fn(), rmSync: vi.fn(), writeFileSync: vi.fn(), execFileSync: vi.fn(),
}));
vi.mock('node:fs', () => fake);
vi.mock('node:child_process', () => ({ execFileSync: fake.execFileSync }));
const smokeScript = '../../../scripts/headless-smoke.mjs';
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.resetModules(); });

function setup() {
  const root = '/tmp/jini-headless-fixture';
  const manifest = { name: '@jini-ai/ui-kit', exports: { '.': './dist/index.js' } };
  fake.mkdtempSync.mockReturnValue(root); fake.readFileSync.mockReturnValue(JSON.stringify(manifest));
  return { root, manifest };
}

it('requests a physical package copy in the isolated fixture and forwards the smoke output', async () => {
  const { root, manifest } = setup();
  fake.execFileSync.mockReturnValue('headless root smoke passed\n');
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  await import(smokeScript);
  const target = join(root, 'node_modules/@jini-ai/ui-kit');
  expect(fake.mkdirSync).toHaveBeenCalledWith(target, { recursive: true });
  expect(fake.cpSync).toHaveBeenCalledWith(expect.stringMatching(/ui-kit\/dist$/), join(target, 'dist'), { recursive: true });
  expect(fake.writeFileSync).toHaveBeenCalledWith(join(target, 'package.json'), JSON.stringify(manifest));
  expect(fake.writeFileSync.mock.calls.map(([path]) => path)).toEqual([join(target, 'package.json'), join(root, 'smoke.mjs')]);
  expect(fake.execFileSync).toHaveBeenCalledTimes(1);
  expect(fake.execFileSync).toHaveBeenCalledWith(process.execPath, [join(root, 'smoke.mjs')], { cwd: root, encoding: 'utf8' });
  expect(stdout).toHaveBeenCalledWith('headless root smoke passed\n');
  expect(fake.rmSync).toHaveBeenCalledTimes(1);
  expect(fake.rmSync).toHaveBeenCalledWith(root, { recursive: true, force: true });
});

it.each(['copy', 'child'] as const)('cleans up and propagates a %s failure', async phase => {
  const { root } = setup(), failure = new Error('smoke failed');
  const operation = phase === 'copy' ? fake.cpSync : fake.execFileSync;
  operation.mockImplementation(() => { throw failure; });
  await expect(import(smokeScript)).rejects.toBe(failure);
  expect(fake.rmSync).toHaveBeenCalledTimes(1);
  expect(fake.rmSync).toHaveBeenCalledWith(root, { recursive: true, force: true });
});
