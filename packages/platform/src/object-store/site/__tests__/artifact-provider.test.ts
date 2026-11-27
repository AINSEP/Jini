import { expect, it, vi } from 'vitest';
import { createObjectStoreRegistry } from '@jini-ai/core/object-store';
import { artifactStoreBinding, selectArtifactStoreProvider } from '../artifact-provider.js';

it('revoke never looks up a different registered provider', async () => {
  const provider = { create: vi.fn(), createArtifactStore: vi.fn() };
  const registry = createObjectStoreRegistry({}, { seed: [{ id: 'new_store', provider }, { id: 'saved_store', provider }] });
  const resolveCredential = vi.fn(async () => undefined);
  const selected = await selectArtifactStoreProvider({ loaded: { registry, refusals: [] }, preferredId: 'new_store', resolveCredential }, { savedProvider: 'saved-store' });
  expect(selected).toBeUndefined();
  expect(resolveCredential).toHaveBeenCalledTimes(1);
  expect(resolveCredential).toHaveBeenCalledWith({ id: 'saved_store' });
});

it('rotation keeps the same non-secret storage binding', () => {
  const credential = { bucket: 'bucket', region: 'region', endpoint: 'https://endpoint', publicUrl: 'https://public', token: 'old-secret' };
  const original = artifactStoreBinding({ store: {}, credential });
  expect(original).toBe('["bucket","region","https://endpoint","https://public"]');
  expect(artifactStoreBinding({ store: {}, credential: { ...credential, token: 'new-secret' } })).toBe(original);
  expect(artifactStoreBinding({ store: { binding: 'provider-owned' }, credential })).toBe('provider-owned');
});

it('falls back from a connected but artifact-ineligible preferred provider to the first eligible provider', async () => {
  const preferred = { create: vi.fn(), createArtifactStore: vi.fn(), acceptsArtifactCredential: vi.fn(() => false) };
  const fallback = { create: vi.fn(), createArtifactStore: vi.fn() };
  const unusable = { create: vi.fn() };
  const registry = createObjectStoreRegistry({}, { seed: [
    { id: 'media_only', provider: unusable }, { id: 'fallback', provider: fallback }, { id: 'preferred', provider: preferred },
  ] });
  const saved = { preferred: { bucket: 'preferred-bucket' }, fallback: { bucket: 'fallback-bucket' } };
  const resolveCredential = vi.fn(async ({ id }: { id: string }) => {
    if (id === 'fallback' || id === 'preferred') return saved[id];
    throw new Error(`Unexpected credential lookup for ${id}`);
  });
  expect(await selectArtifactStoreProvider({ loaded: { registry, refusals: [] }, preferredId: 'preferred', resolveCredential }))
    .toEqual({ id: 'fallback', provider: fallback, credential: saved.fallback });
  expect(resolveCredential.mock.calls).toEqual([[{ id: 'preferred' }], [{ id: 'fallback' }]]);
  expect(preferred.acceptsArtifactCredential).toHaveBeenCalledWith({ credential: saved.preferred });
  expect(artifactStoreBinding({ store: {}, credential: { bucket: 'b', region: 'r', publicUrl: 'https://store.example.test' } }))
    .toBe('["b","r","","https://store.example.test"]');
});

it('returns no provider when every connected candidate refuses its artifact credential', async () => {
  const provider = { create: vi.fn(), createArtifactStore: vi.fn(), acceptsArtifactCredential: vi.fn(() => false) };
  const registry = createObjectStoreRegistry({}, { seed: [{ id: 'first', provider }] });
  const resolveCredential = vi.fn(async () => ({ bucket: 'not-an-artifact-credential' }));
  expect(await selectArtifactStoreProvider({ loaded: { registry, refusals: [] }, preferredId: 'first', resolveCredential })).toBeUndefined();
  expect(provider.acceptsArtifactCredential).toHaveBeenCalledWith({ credential: { bucket: 'not-an-artifact-credential' } });
});
