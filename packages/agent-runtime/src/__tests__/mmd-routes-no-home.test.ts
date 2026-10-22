import { describe, expect, it, vi } from 'vitest';

// Isolated in its own file: mocking os.homedir() to be falsy exercises the
// "no home directory resolvable at all" branch in resolveHome() /
// resolveMmdRoutesFile() / the loaders' early-return guards — a real
// machine's homedir() is always truthy, so this branch is otherwise
// unreachable. Kept out of mmd-routes.test.ts so the module-wide mock
// doesn't affect that file's other (real-homedir) assertions.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => '' };
});

import { loadMmdRouteLaunchEnv, loadMmdRouteModels, resolveMmdRoutesFile } from '../mmd-routes.js';

describe('mmd-routes when no home directory can be resolved at all', () => {
  it('resolveMmdRoutesFile returns null with no HOME env and a falsy os.homedir()', () => {
    expect(resolveMmdRoutesFile({ env: {} })).toBeNull();
  });

  it('resolveMmdRoutesFile returns the (falsy) resolveHome() result unchecked for a bare "~" override', () => {
    // Unlike the "~/" branch, the bare "~" branch in expandRoutesFileOverride
    // returns resolveHome(env) directly with no truthiness guard — so an
    // empty-string home (this test's simulated no-homedir case) comes back
    // as '' rather than null. Verbatim upstream behavior, not a bug.
    expect(resolveMmdRoutesFile({ env: { MMD_MODEL_ROUTES_FILE: '~' } })).toBe('');
  });

  it('resolveMmdRoutesFile returns null for a "~/" override with no resolvable home', () => {
    expect(resolveMmdRoutesFile({ env: { MMD_MODEL_ROUTES_FILE: '~/routes.json' } })).toBeNull();
  });

  it('loadMmdRouteModels returns null when the routes file path cannot be resolved', async () => {
    expect(await loadMmdRouteModels({ env: {}, fallbackModels: [] })).toBeNull();
  });

  it('loadMmdRouteLaunchEnv returns null when the routes file path cannot be resolved', async () => {
    expect(await loadMmdRouteLaunchEnv({ env: {}, modelId: 'model-1' })).toBeNull();
  });
});
