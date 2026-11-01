import { mkdtempSync, copyFileSync, mkdirSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('a real terminal opt-in without node-pty reports an actionable feature error', () => {
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'jini-terminal-opt-in-'));
  try {
    copyFileSync(resolve(repo, 'packages/daemon/src/terminal.adapter.ts'), join(root, 'terminal.adapter.ts'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    mkdirSync(join(root, 'node_modules', '@jini-ai'), { recursive: true });
    // Use the real platform dependency; only the optional native addon is absent from this install.
    symlinkSync(resolve(repo, 'packages/daemon/node_modules/@jini-ai/platform'), join(root, 'node_modules', '@jini-ai/platform'), 'junction');
    // Resolve the new helper from source in this child and the real platform's imports;
    // an unrelated concurrent dist refresh must not require a core build for this test.
    const helper = pathToFileURL(resolve(repo, 'packages/core/src/optional-peer.ts')).href;
    const hook = join(root, 'source-helper.mjs');
    writeFileSync(hook, `import { registerHooks } from 'node:module';
      registerHooks({ resolve(specifier, context, next) {
        return next(specifier === '@jini-ai/core/optional-peer' ? ${JSON.stringify(helper)} : specifier, context);
      } });`);
    const source = `const { loadRealSpawnPty } = await import(${JSON.stringify(pathToFileURL(join(root, 'terminal.adapter.ts')).href)});\ntry { await loadRealSpawnPty({}); process.exitCode = 2; } catch (error) { console.log(JSON.stringify({ message: error.message, cause: error.cause?.code })); }`;
    const result = spawnSync(process.execPath, ['--import', hook, '--input-type=module', '--eval', source], { encoding: 'utf8', timeout: 30_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ message: 'Interactive terminals could not load node-pty. Install node-pty to enable this feature, or check its installed version and native binaries.', cause: 'ERR_MODULE_NOT_FOUND' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
