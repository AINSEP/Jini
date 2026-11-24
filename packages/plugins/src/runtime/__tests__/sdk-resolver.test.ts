import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// `module.register()` is process-global and cannot be unregistered, so every case runs in its own
// child process against the built module (`pnpm --filter @jini-ai/plugins build` first).
const resolverUrl = pathToFileURL(path.resolve(__dirname, '../../../dist/runtime/sdk-resolver.js')).href;
let root = '';

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'jini-sdk-resolver-'));
  await writeFile(path.join(root, 'host-sdk.mjs'), 'export const marker = "HOST";');
  for (const specifier of ['@jini-ai/plugin-sdk', '@tovu/sdk']) {
    const shadow = path.join(root, 'node_modules', specifier);
    await mkdir(shadow, { recursive: true });
    await writeFile(path.join(shadow, 'package.json'), JSON.stringify({ type: 'module', exports: { '.': './index.mjs' } }));
    await writeFile(path.join(shadow, 'index.mjs'), 'export const marker = "SHADOW";');
  }
  await writeFile(path.join(root, 'plugin.mjs'), `
    import * as canonical from "@jini-ai/plugin-sdk";
    import * as legacy from "@tovu/sdk";
    export { canonical, legacy };
    export const deepImport = (specifier) => import(specifier);
  `);
});
afterAll(() => rm(root, { recursive: true, force: true }));

function run(script: string) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
  return { status: result.status, out: result.stdout.trim(), err: result.stderr };
}

describe('registerPluginSdkResolver', () => {
  it('redirects both exact SDK specifiers to the host module despite plugin-local shadow packages, leaving deep imports to package exports', () => {
    const { status, out, err } = run(`
      import { registerPluginSdkResolver } from ${JSON.stringify(resolverUrl)};
      import { sep } from 'node:path';
      registerPluginSdkResolver({ sdkModulePath: ${JSON.stringify(path.join(root, 'host-sdk.mjs'))} });
      const plugin = await import(${JSON.stringify(pathToFileURL(path.join(root, 'plugin.mjs')).href)});
      let deep = 'no-error';
      try { await plugin.deepImport('@jini-ai/plugin-sdk/private'); } catch (error) { deep = error.code; }
      console.log(JSON.stringify({ canonical: plugin.canonical.marker, same: plugin.canonical === plugin.legacy, sep, deep }));
    `);
    expect(err).toBe('');
    expect(status).toBe(0);
    expect(JSON.parse(out)).toEqual({ canonical: 'HOST', same: true, sep: path.sep, deep: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  });

  it('throws PluginSdkResolverAlreadyRegisteredError on a second call in the same process', () => {
    const { status, out } = run(`
      import { registerPluginSdkResolver, PluginSdkResolverAlreadyRegisteredError } from ${JSON.stringify(resolverUrl)};
      const sdkModulePath = ${JSON.stringify(path.join(root, 'host-sdk.mjs'))};
      registerPluginSdkResolver({ sdkModulePath });
      try { registerPluginSdkResolver({ sdkModulePath }); console.log('no-throw'); }
      catch (error) { console.log(error instanceof PluginSdkResolverAlreadyRegisteredError ? error.name : 'other:' + error.message); }
    `);
    expect(status).toBe(0);
    expect(out).toBe('PluginSdkResolverAlreadyRegisteredError');
  });
});
