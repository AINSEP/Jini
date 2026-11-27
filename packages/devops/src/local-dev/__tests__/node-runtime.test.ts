import { spawnSync } from 'node:child_process';
import { expect, test, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
import { selectNodeRuntime } from '../node-runtime.js';

test('dev API uses the installed desktop runtime as Node, including Windows executable paths', () => {
  const command = 'C:\\repo with spaces\\electron.exe';
  expect(selectNodeRuntime({ searchFrom: ['/repo'], nodePath: '/node', env: {} }, {
    resolveBinary: () => command, usable: () => true,
  })).toEqual({ command, env: { ELECTRON_RUN_AS_NODE: '1' }, fallback: false });
});

test('a missing or unusable desktop runtime falls back to the supplied stock Node', () => {
  for (const resolveBinary of [() => { throw new Error('missing'); }, () => '/broken']) {
    expect(selectNodeRuntime({ searchFrom: ['/repo'], nodePath: '/node', env: {} }, {
      resolveBinary, usable: () => false,
    })).toEqual({ command: '/node', env: {}, fallback: true });
  }
});

test('runtime discovery tries the desktop workspace after the root installation', () => {
  const seen: string[] = [];
  const result = selectNodeRuntime({ searchFrom: ['/root', '/desktop'], nodePath: '/node', env: {} }, {
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
  const result = selectNodeRuntime({ searchFrom: ['/repo'], nodePath: '/node', env }, {
    resolveBinary: () => '/electron',
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

test('both candidate probes receive the supplied env object by identity', () => {
  const env = { PATH: '/isolated/bin' };
  const seen: NodeJS.ProcessEnv[] = [];
  const result = selectNodeRuntime({ searchFrom: ['/root', '/desktop'], nodePath: '/node', env }, {
    resolveBinary: ({ directory }) => directory,
    usable: ({ command, env: candidateEnv }) => { seen.push(candidateEnv); return command === '/desktop'; },
  });
  expect(result.command).toBe('/desktop');
  expect(seen).toHaveLength(2);
  expect(seen[0]).toBe(env);
  expect(seen[1]).toBe(env);
});

test('default Electron discovery skips a non-binary export and resolves the next workspace', async () => {
  const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'jini-runtime-'));
  try {
    const broken = join(root, 'root');
    const desktop = join(root, 'desktop');
    const command = join(desktop, 'runtime with spaces');
    for (const [directory, exported] of [[broken, { path: command }], [desktop, command]] as const) {
      const moduleDir = join(directory, 'node_modules', 'electron');
      await mkdir(moduleDir, { recursive: true });
      await writeFile(join(moduleDir, 'package.json'), '{"name":"electron","main":"index.cjs"}');
      await writeFile(join(moduleDir, 'index.cjs'), `module.exports = ${JSON.stringify(exported)};`);
    }
    const env = { PROBE_MARKER: 'desktop' };
    const usable = vi.fn(() => true);
    expect(selectNodeRuntime({ searchFrom: [broken, desktop], nodePath: '/fallback', env }, { usable }))
      .toEqual({ command, env: { ELECTRON_RUN_AS_NODE: '1' }, fallback: false });
    expect(usable.mock.calls).toEqual([[{ command, env }]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
