import { spawnSync } from 'node:child_process';
import { expect, test, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
import { selectNodeRuntime } from '../node-runtime.js';

test('dev API uses the installed desktop runtime as Node, including Windows executable paths', () => {
  const command = 'C:\\repo with spaces\\electron.exe';
  expect(selectNodeRuntime({ searchFrom: ['/repo'], nodePath: '/node' }, {
    resolveBinary: () => command, usable: () => true,
  })).toEqual({ command, env: { ELECTRON_RUN_AS_NODE: '1' }, fallback: false });
});

test('a missing or unusable desktop runtime falls back to the supplied stock Node', () => {
  for (const resolveBinary of [() => { throw new Error('missing'); }, () => '/broken']) {
    expect(selectNodeRuntime({ searchFrom: ['/repo'], nodePath: '/node' }, {
      resolveBinary, usable: () => false,
    })).toEqual({ command: '/node', env: {}, fallback: true });
  }
});

test('runtime discovery tries the desktop workspace after the root installation', () => {
  const seen: string[] = [];
  const result = selectNodeRuntime({ searchFrom: ['/root', '/desktop'], nodePath: '/node' }, {
    resolveBinary: ({ directory }) => { seen.push(directory); return directory; },
    usable: ({ command }) => command === '/desktop',
  });
  expect(seen).toEqual(['/root', '/desktop']);
  expect(result.command).toBe('/desktop');
});

// desktop 0.1.27: the packaged site server imports @jini-ai/devops/local-dev (listenServer,
// createDevServerRetirement), so the staged-closure audit reached node-runtime's require('electron')
// and refused the build. electron is an opt-in peer of this dev-only runtime picker; the manifest
// must say so in the contract the audit reads.
test('the package manifest declares electron as a classified opt-in peer for runtime selection', async () => {
  const { readFile } = await import('node:fs/promises');
  const { optionalPeerClassification } = await import('../../packaging/electron/optional-peers.js');
  const manifest = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  expect(optionalPeerClassification({ manifest, name: 'electron' })).toMatch(/^opt-in: desktop runtime selection/);
});


test('the native probe forwards the injected environment without mutating it', () => {
  vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
  const env = { PATH: '/isolated/bin', PROBE_MARKER: 'injected', ELECTRON_RUN_AS_NODE: '0' };
  const result = selectNodeRuntime({ searchFrom: ['/repo'], nodePath: '/node' }, {
    env, resolveBinary: () => '/electron',
  });
  expect(result).toEqual({ command: '/electron', env: { ELECTRON_RUN_AS_NODE: '1' }, fallback: false });
  const [command, args, options] = vi.mocked(spawnSync).mock.calls[0]!;
  expect(command).toBe('/electron');
  expect(args).toEqual(['-e', 'process.exit(process.versions.node ? 0 : 1)']);
  expect(Object.keys(options?.env ?? {}).sort()).toEqual(Object.keys(env).sort());
  expect(options?.env?.PROBE_MARKER).toBe('injected');
  expect(options?.env?.PATH).toBe('/isolated/bin');
  expect(options?.env?.ELECTRON_RUN_AS_NODE).toBe('1');
  expect({ stdio: options?.stdio, timeout: options?.timeout, windowsHide: options?.windowsHide })
    .toEqual({ stdio: 'ignore', timeout: 5000, windowsHide: true });
  expect(env).toEqual({ PATH: '/isolated/bin', PROBE_MARKER: 'injected', ELECTRON_RUN_AS_NODE: '0' });
});
