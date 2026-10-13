/** Published subpaths must work in a physical install without the optional HTML peers.
 * The coordinator builds platform before running this test; no workspace symlink can hide a peer.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('timeout works without HTML peers; the documented web entry requires them', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'jini-platform-nohtml-'));
  const installed = join(fixture, 'node_modules/@jini-ai/platform');
  try {
    mkdirSync(installed, { recursive: true });
    cpSync(join(packageRoot, 'dist'), join(installed, 'dist'), { recursive: true });
    cpSync(join(packageRoot, 'package.json'), join(installed, 'package.json'));
    // Core remains required; HTML peers alone are absent from this install.
    const coreRoot = fileURLToPath(new URL('../core/', new URL('../../../', import.meta.url)));
    const installedCore = join(fixture, 'node_modules/@jini-ai/core');
    mkdirSync(installedCore, { recursive: true });
    cpSync(join(coreRoot, 'dist'), join(installedCore, 'dist'), { recursive: true });
    cpSync(join(coreRoot, 'package.json'), join(installedCore, 'package.json'));
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
      const { FetchTimeoutError } = await import('@jini-ai/platform/fetch-with-timeout');
      const timeout = new FetchTimeoutError('https://example.com', 10);
      let missing;
      try { await import('@jini-ai/platform/web'); }
      catch (error) { missing = { code: error.code, peer: error.message.includes("Cannot find package 'parse5'") }; }
      process.stdout.write(JSON.stringify({ message: timeout.message, missing }));
    `], { cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(JSON.parse(result)).toEqual({
      message: 'fetch timed out after 10ms: https://example.com',
      missing: { code: 'ERR_MODULE_NOT_FOUND', peer: true },
    });
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
