import assert from 'node:assert/strict';
import type { Stats } from 'node:fs';
import type * as FsPromises from 'node:fs/promises';
import type * as Http from 'node:http';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test, vi } from 'vitest';
import { ExportPathError } from '../contracts.js';
import { createNodeAppFactory, createNodeArtifactWriter } from '../node-adapters.js';

/**
 * Faults the real filesystem and socket layer cannot produce on demand: a macOS symlinked
 * /tmp or /var, a file swapped between lstat and open, and a loopback listen failure.
 * Each hook defaults to the real implementation and is reset after every test.
 */
const hooks = vi.hoisted(() => ({
  lstat: undefined as ((target: string) => Promise<Stats> | undefined) | undefined,
  realpath: undefined as ((target: string) => Promise<string> | undefined) | undefined,
  openIsFile: undefined as boolean | undefined,
  listenError: undefined as Error | undefined,
  serverClosed: 0,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    lstat: (async (target: string) => (await hooks.lstat?.(target)) ?? actual.lstat(target)) as typeof actual.lstat,
    realpath: (async (target: string) => (await hooks.realpath?.(target)) ?? actual.realpath(target)) as typeof actual.realpath,
    open: (async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const forced = hooks.openIsFile;
      if (forced === undefined) return handle;
      const realStat = handle.stat.bind(handle);
      handle.stat = (async () => Object.assign(await realStat(), { isFile: () => forced })) as typeof handle.stat;
      return handle;
    }) as typeof actual.open,
  };
});

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof Http>();
  return {
    ...actual,
    createServer: ((listener: Http.RequestListener) => {
      const server = actual.createServer(listener);
      const error = hooks.listenError;
      if (error) server.listen = (() => { process.nextTick(() => server.emit('error', error)); return server; }) as typeof server.listen;
      const close = server.close.bind(server);
      server.close = ((callback?: (err?: Error) => void) => { hooks.serverClosed++; return close(callback); }) as typeof server.close;
      return server;
    }) as typeof actual.createServer,
  };
});

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform): void { Object.defineProperty(process, 'platform', { value: platform, configurable: true }); }
/** A Stats fake reporting a symbolic link, as lstat reports macOS's /tmp and /var. */
function symlinkStats(): Stats { return Object.assign(Object.create(null) as Stats, { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false }); }

afterEach(() => {
  setPlatform(realPlatform);
  hooks.lstat = undefined; hooks.realpath = undefined; hooks.openIsFile = undefined; hooks.listenError = undefined; hooks.serverClosed = 0;
});

/** Pretends `alias` is a symlink resolving to `resolved`, and pretends `/private/<alias>` holds the remaining path. */
function fakeAlias(alias: '/tmp' | '/var', resolved: string): void {
  hooks.lstat = (target) => (target === alias ? Promise.resolve(symlinkStats()) : undefined);
  hooks.realpath = (target) => (target === alias ? Promise.resolve(resolved) : undefined);
}

for (const alias of ['/tmp', '/var'] as const) {
  test(`on darwin, ${alias} as a symlink to /private${alias} is accepted as an ancestor`, async () => {
    setPlatform('darwin');
    fakeAlias(alias, '/private' + alias);
    await createNodeArtifactWriter({}).prepare({ outputDir: alias });
  });

  test(`on darwin, ${alias} as a symlink elsewhere is refused`, async () => {
    setPlatform('darwin');
    fakeAlias(alias, '/elsewhere' + alias);
    await assert.rejects(createNodeArtifactWriter({}).prepare({ outputDir: alias }), (error: unknown) => error instanceof ExportPathError && error.message === 'Output path must be a regular directory.');
  });

  test(`on linux, ${alias} as a symlink to /private${alias} is refused`, async () => {
    setPlatform('linux');
    fakeAlias(alias, '/private' + alias);
    await assert.rejects(createNodeArtifactWriter({}).prepare({ outputDir: alias }), (error: unknown) => error instanceof ExportPathError && error.message === 'Output path must be a regular directory.');
  });
}

test('on darwin, other symlinked ancestors are refused without resolving them', async () => {
  setPlatform('darwin');
  let resolved = 0;
  hooks.lstat = (target) => (target === '/opt' ? Promise.resolve(symlinkStats()) : undefined);
  hooks.realpath = () => { resolved++; return Promise.resolve('/private/opt'); };
  await assert.rejects(createNodeArtifactWriter({}).prepare({ outputDir: '/opt' }), (error: unknown) => error instanceof ExportPathError && error.message === 'Output path must be a regular directory.');
  assert.equal(resolved, 0);
});

test('on darwin, a real /tmp directory is accepted without resolving it', async () => {
  setPlatform('darwin');
  let resolved = 0;
  hooks.realpath = () => { resolved++; return undefined; };
  await createNodeArtifactWriter({}).prepare({ outputDir: '/tmp' });
  assert.equal(resolved, 0);
});

test('an artifact swapped for a non-file between lstat and open is refused and left unwritten', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'static-export-faults-')));
  try {
    hooks.openIsFile = false;
    await assert.rejects(createNodeArtifactWriter({}).write({ outputDir: root, outputFile: 'a.txt', data: 'x' }), (error: unknown) => error instanceof ExportPathError && error.message === 'Artifact output must be a regular file.');
    hooks.openIsFile = undefined;
    assert.equal((await (await import('node:fs/promises')).readFile(path.join(root, 'a.txt'), 'utf8')), '');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a loopback listen failure closes the server and propagates the error', async () => {
  hooks.listenError = new Error('listen canary');
  const factory = createNodeAppFactory({ createApp: () => (_request, response) => { response.end(); } });
  await assert.rejects(factory.open({}), { message: 'listen canary' });
  assert.equal(hooks.serverClosed, 1);
});

test('the host app factory may be async', async () => {
  const factory = createNodeAppFactory({ createApp: async () => (_request, response) => { response.end('async app'); } });
  const session = await factory.open({});
  try { assert.equal(await (await fetch(session.baseUrl)).text(), 'async app'); } finally { await session.close({}); }
  assert.equal(hooks.serverClosed, 1);
});
