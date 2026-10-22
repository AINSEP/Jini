import { expect, it, vi } from 'vitest';
import { createMemorySourceControlApi } from '../adapters/memory.js';
import { runSourceControlApiConformance } from '../conformance/source-control-api.conformance.js';
import type { SourceControlApiPort } from '../ports.js';
import type { SourceControlProvider } from '../models.js';

const git: readonly SourceControlProvider[] = [{ id: 'git', label: 'Git' }];
const memory = (): SourceControlApiPort => createMemorySourceControlApi({ providers: git });

it('returns every check name in order when the API honours the contract', async () => {
  expect(await runSourceControlApiConformance({ api: memory(), providerId: 'git' })).toEqual([
    'provider is listed', 'create returns configured summary', 'saved secrets never read back', 'list contains created row', 'duplicate label rejects',
    'server owns unique default slot', 'metadata-only update preserves configured credential', 'prior snapshots remain immutable', 'replacement retains identity and label',
    'blank replacement rejects', 'aborted list rejects', 'aborted write rejects', 'aborted write has no effects', 'remove is idempotent', 'missing update rejects',
  ]);
});

it('passes connectionFields through to every created connection', async () => {
  const api = memory(); const create = vi.spyOn(api, 'create');
  await runSourceControlApiConformance({ api, providerId: 'git' }, { connectionFields: { host: 'git.example' } });
  expect(create).toHaveBeenCalledWith({ label: 'conformance-first', connection: { host: 'git.example', providerId: 'git', token: 'conformance-only-token' } });
});

it('fails the listing check when the provider is absent from the catalog', async () => {
  await expect(runSourceControlApiConformance({ api: memory(), providerId: 'missing' })).rejects.toThrow('Source control conformance failed for provider "missing": provider is listed');
});

const lenientDuplicates = (api: SourceControlApiPort): SourceControlApiPort => {
  const create = api.create.bind(api);
  return { ...api, create: async (input, options) => create(input.label === 'conformance-first' && (await api.list({})).length > 0 ? { ...input, label: 'conformance-dup' } : input, options) };
};

it('fails a rejection check when the API accepts what it must refuse', async () => {
  await expect(runSourceControlApiConformance({ api: lenientDuplicates(memory()), providerId: 'git' })).rejects.toThrow('Source control conformance failed for provider "git": duplicate label rejects');
});

it('leaves behind a row the API wrongly accepted inside a rejection check (reported, not fixed)', async () => {
  const api = memory();
  await runSourceControlApiConformance({ api: lenientDuplicates(api), providerId: 'git' }).catch(() => undefined);
  expect((await api.list({})).map(r => r.label)).toEqual(['conformance-dup']);
});

it('fails the secrets check when a summary echoes the token back', async () => {
  const api = memory(); const create = api.create.bind(api);
  const leaky: SourceControlApiPort = { ...api, create: async (input, options) => ({ ...(await create(input, options)), token: input.connection.token }) };
  await expect(runSourceControlApiConformance({ api: leaky, providerId: 'git' })).rejects.toThrow('Source control conformance failed for provider "git": saved secrets never read back');
  expect(await api.list({})).toEqual([]);
});

it('removes every row it created once a passing run finishes', async () => {
  const api = memory();
  await runSourceControlApiConformance({ api, providerId: 'git' });
  expect(await api.list({})).toEqual([]);
});

it('fails the default-slot check when the API ignores an explicit default request', async () => {
  const api = memory(); const create = api.create.bind(api);
  const stubborn: SourceControlApiPort = { ...api, create: async ({ isDefault: _ignored, ...input }, options) => create(input, options) };
  await expect(runSourceControlApiConformance({ api: stubborn, providerId: 'git' })).rejects.toThrow('Source control conformance failed for provider "git": server owns unique default slot');
});

it('fails the default-slot check when two rows of the provider both claim the default', async () => {
  const api = memory(); const list = api.list.bind(api);
  const doubled: SourceControlApiPort = { ...api, list: async (required, options) => (await list(required, options)).map(r => ({ ...r, isDefault: true })) };
  await expect(runSourceControlApiConformance({ api: doubled, providerId: 'git' })).rejects.toThrow('Source control conformance failed for provider "git": server owns unique default slot');
});
