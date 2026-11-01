import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { loadOptionalPeer } from '../optional-peer.js';

const message = 'Example feature could not load jini-test-absent-peer. Install jini-test-absent-peer to enable this feature, or check its installed version and native binaries.';
it('returns a synchronous library without changing its identity', () => {
  const library = {};
  expect(loadOptionalPeer({ feature: 'Example feature', dependency: 'jini-test-absent-peer', load: () => library })).toBe(library);
});
it('returns an asynchronously loaded library', async () => {
  const library = {};
  await expect(loadOptionalPeer({ feature: 'Example feature', dependency: 'jini-test-absent-peer', load: async () => library })).resolves.toBe(library);
});
it('reports a real failed require with the original error as cause', () => {
  const require = createRequire(import.meta.url);
  try {
    loadOptionalPeer({ feature: 'Example feature', dependency: 'jini-test-absent-peer', load: () => require('jini-test-absent-peer') });
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(message);
    expect((error as Error).cause).toMatchObject({ code: 'MODULE_NOT_FOUND' });
  }
});
it('reports a real failed import with the original error as cause', () => {
  // Vite's VM has no native dynamic-import callback; exercise the real loader in Node.
  const script = `import { loadOptionalPeer } from ${JSON.stringify(new URL('../optional-peer.ts', import.meta.url).href)};
    try { await loadOptionalPeer({ feature: 'Example feature', dependency: 'jini-test-absent-peer', load: () => import('jini-test-absent-peer') }); process.exitCode = 2; }
    catch (error) { console.log(JSON.stringify({ message: error.message, code: error.cause?.code })); }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 15_000 });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ message, code: 'ERR_MODULE_NOT_FOUND' });
});
it('preserves a broken installed native binary as the cause, rather than claiming only absence', () => {
  const cause = Object.assign(new Error('wrong architecture'), { code: 'ERR_DLOPEN_FAILED' });
  expect(() => loadOptionalPeer({ feature: 'Example feature', dependency: 'jini-test-absent-peer', load: () => { throw cause; } })).toThrow(message);
  try { loadOptionalPeer({ feature: 'Example feature', dependency: 'jini-test-absent-peer', load: () => { throw cause; } }); }
  catch (error) { expect((error as Error).cause).toBe(cause); }
});

it('preserves a feature-owned error type without losing its load cause', () => {
  class FeatureUnavailable extends Error {}
  const cause = new Error('bad native binary');
  try {
    loadOptionalPeer({ feature: 'Example feature', dependency: 'jini-test-absent-peer', load: () => { throw cause; } }, {
      createError: ({ message, cause }) => new FeatureUnavailable(message, { cause }),
    });
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(FeatureUnavailable);
    expect((error as Error).message).toBe(message);
    expect((error as Error).cause).toBe(cause);
  }
});
