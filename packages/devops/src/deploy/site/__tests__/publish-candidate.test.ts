import { expect, it, vi } from 'vitest';
import { findCandidateDestination } from '../publish-candidate.js';

it('unsafe path never reaches the resolver or reader', async () => {
  const resolvePath = vi.fn(); const io = { read: vi.fn() };
  expect(await findCandidateDestination({ io, resolvePath, publicOriginKey: 'PUBLIC.URL' }, { candidatePaths: ['../private.json', '/absolute', 'safe/../private'] })).toBeNull();
  expect(resolvePath).not.toHaveBeenCalled(); expect(io.read).not.toHaveBeenCalled();
});

it('the first configured file containing the injected key wins', async () => {
  const io = { read: vi.fn(async ({ path }: { path: string }) => ({
    'one.json': 'PUBLICxURL=https://wrong.example', 'two.json': 'PUBLIC.URL: "https://first.example"',
    'three.json': 'PUBLIC.URL=https://later.example',
  })[path] ?? null) };
  const resolvePath = vi.fn(({ relative }: { relative: string }) => relative);
  expect(await findCandidateDestination({ io, resolvePath, publicOriginKey: 'PUBLIC.URL' }, { candidatePaths: ['one.json', 'two.json', 'three.json'] })).toBe('https://first.example');
  expect(io.read.mock.calls.map(([input]) => input.path)).toEqual(['one.json', 'two.json']);
});

it('empty candidates and no match return null', async () => {
  const io = { read: vi.fn(async () => 'unrelated=https://example.test') };
  const resolvePath = vi.fn(({ relative }: { relative: string }) => relative);
  const deps = { io, resolvePath, publicOriginKey: 'PUBLIC_URL' };
  expect(await findCandidateDestination(deps, { candidatePaths: [] })).toBeNull();
  expect(io.read).not.toHaveBeenCalled();
  expect(await findCandidateDestination(deps)).toBeNull();
  expect(io.read).toHaveBeenCalledWith({ path: 'app.json' });
});
