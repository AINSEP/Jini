/** registerPluginSdkResolver from its source module, inside this test file's own worker process
 * (vitest isolates each file in a fresh fork, so the process-global hook stays here). The
 * child-process suite (`sdk-resolver.test.ts`) covers the built module; this one covers the source. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { PluginSdkResolverAlreadyRegisteredError, registerPluginSdkResolver } from '../sdk-resolver.js';

const roots: string[] = [];
afterAll(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

// The redirect itself is asserted end-to-end by the child-process suite: the test runner's module
// loader does not route a dynamic import through Node's customization hooks.
it('registers once (process-wide marker set), then refuses a second registration loudly', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jini-sdk-inproc-'));
  roots.push(root);
  await writeFile(path.join(root, 'host-sdk.mjs'), 'export const marker = "HOST";');

  const marker = Symbol.for('@jini-ai/plugins/runtime/sdk-resolver:registered');
  expect((globalThis as unknown as Record<symbol, unknown>)[marker]).toBeUndefined();
  registerPluginSdkResolver({ sdkModulePath: path.join(root, 'host-sdk.mjs'), sdkSpecifiers: ['@resolver-probe/sdk'] });
  expect((globalThis as unknown as Record<symbol, unknown>)[marker]).toBe(true);

  const second = (() => { try { registerPluginSdkResolver({ sdkModulePath: path.join(root, 'host-sdk.mjs'), sdkSpecifiers: ['@resolver-probe/sdk'] }); return null; } catch (error) { return error; } })();
  expect(second).toBeInstanceOf(PluginSdkResolverAlreadyRegisteredError);
  expect(second).toMatchObject({
    name: 'PluginSdkResolverAlreadyRegisteredError',
    message: 'registerPluginSdkResolver: already registered for this process — a second call is a boot-sequencing bug',
  });
});
