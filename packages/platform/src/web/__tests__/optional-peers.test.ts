/** Published subpaths must work in a physical install without the optional adapter peers.
 * The coordinator builds platform before running this test; no workspace symlink can hide a peer.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('root imports without adapter peers; only the default dispatcher and web entry require them', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'jini-platform-nohtml-'));
  const installed = join(fixture, 'node_modules/@jini-ai/platform');
  try {
    mkdirSync(installed, { recursive: true });
    cpSync(join(packageRoot, 'dist'), join(installed, 'dist'), { recursive: true });
    cpSync(join(packageRoot, 'package.json'), join(installed, 'package.json'));
    // Core remains required; all optional adapter peers are absent from this install.
    const coreRoot = fileURLToPath(new URL('../core/', new URL('../../../', import.meta.url)));
    const installedCore = join(fixture, 'node_modules/@jini-ai/core');
    mkdirSync(installedCore, { recursive: true });
    cpSync(join(coreRoot, 'dist'), join(installedCore, 'dist'), { recursive: true });
    cpSync(join(coreRoot, 'package.json'), join(installedCore, 'package.json'));
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
      const root = await import('@jini-ai/platform');
      const leaf = await import('@jini-ai/platform/asset-cache');
      const { FetchTimeoutError } = await import('@jini-ai/platform/fetch-with-timeout');
      const timeout = new FetchTimeoutError('https://example.com', 10);
      let dispatcherError;
      try { root.createAssetCacheDispatcher({}); }
      catch (error) { dispatcherError = { name: error.name, status: error.status, message: error.message }; }
      let hostCloses = 0;
      const dispatcher = { close: async () => { hostCloses++; } };
      const cache = root.createAssetCache({ cacheDir: 'unused' }, { dispatcher });
      await cache.close();
      let missing;
      try { await import('@jini-ai/platform/web'); }
      catch (error) { missing = { code: error.code, peer: error.message.includes("Cannot find package 'parse5'") }; }
      process.stdout.write(JSON.stringify({ message: timeout.message, missing, dispatcherError,
        sameFactory: root.createAssetCacheDispatcher === leaf.createAssetCacheDispatcher, hostCloses }));
    // pnpm's vitest bin sets NODE_PATH to the hoisted store, which CJS require (unlike ESM import) honours.
    `], { cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_PATH: '' } });
    expect(JSON.parse(result)).toEqual({
      message: 'fetch timed out after 10ms: https://example.com',
      missing: { code: 'ERR_MODULE_NOT_FOUND', peer: true },
      dispatcherError: {
        name: 'AssetCacheError', status: 500,
        message: 'Asset cache dispatcher requires the optional peer "undici"; install undici@^7.25.0 or supply a guarded dispatcher.',
      },
      sameFactory: true,
      hostCloses: 0,
    });
    // Reuse the real installed peer; the first child proves its absence cannot be hidden by a workspace link.
    const require = createRequire(import.meta.url);
    symlinkSync(dirname(require.resolve('undici/package.json')), join(fixture, 'node_modules/undici'), 'dir');
    const installedResult = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { createAssetCacheDispatcher } from '@jini-ai/platform/asset-cache';
      import { Agent } from 'undici';
      const dispatcher = createAssetCacheDispatcher({});
      const synchronous = dispatcher instanceof Agent;
      await dispatcher.close();
      process.stdout.write(JSON.stringify({ synchronous, closed: dispatcher.closed }));
    `], { cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(JSON.parse(installedResult)).toEqual({ synchronous: true, closed: true });
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
