import { describe, expect, it, vi } from 'vitest';

// Separate from mmd-routes-no-home.test.ts: os.homedir() is typed to always
// return a string, so the final `?? null` in resolveHome()'s
// `stringEnv(env, 'HOME') ?? homedir() ?? null` chain is only reachable if
// homedir() itself returns a nullish value — impossible in real Node, but
// worth covering defensively since the source guards for it explicitly.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => undefined as unknown as string };
});

import { resolveMmdRoutesFile } from '../mmd-routes.js';

describe('mmd-routes when os.homedir() itself returns a nullish value', () => {
  it('resolveMmdRoutesFile returns null rather than throwing', () => {
    expect(resolveMmdRoutesFile({ env: {} })).toBeNull();
  });
});
