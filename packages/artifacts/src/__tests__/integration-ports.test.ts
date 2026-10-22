import { describe, expect, it, vi } from 'vitest';
import { createInMemoryArtifactStore, type ManifestInferrer } from '../index.js';

const taxonomy = {
  allowedKinds: new Set(['text']), allowedRenderers: new Set(['text']), allowedExports: new Set(['text']),
};

describe('artifact-store reconciliation', () => {
  it('forwards object arguments to inference and stamps records with the supplied clock', async () => {
    const inferManifest = vi.fn<ManifestInferrer>(() => ({ kind: 'text', renderer: 'text', exports: ['text'] }));
    let time = '2026-01-01T00:00:00.000Z';
    const store = createInMemoryArtifactStore({}, { taxonomy, inferManifest, now: () => time });
    const first = await store.create({ name: 'a.txt', content: 'a' });
    time = '2026-01-02T00:00:00.000Z';
    const second = await store.create({ name: 'b.txt', content: 'b' });
    expect(inferManifest.mock.calls).toEqual([[{ entry: 'a.txt' }], [{ entry: 'b.txt' }]]);
    expect(first.manifest.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(await store.get({ name: 'b.txt' })).toBe(second);
    expect(await store.list()).toEqual([second, first]);
  });
});

it('stores UTF-8 and base64 bytes in a runtime without a Node Buffer global', async () => {
  vi.stubGlobal('Buffer', undefined);
  try {
    const store = createInMemoryArtifactStore({}, { taxonomy });
    const artifactManifest = { kind: 'text', renderer: 'text', exports: ['text'], metadata: { label: '☕' } };
    const utf8 = await store.create({ name: 'unicode.txt', content: '☕', artifactManifest });
    const base64 = await store.create({ name: 'base64.txt', content: 'aGVsbG8=', encoding: 'base64', artifactManifest });
    expect(Array.from(utf8.content)).toEqual([226, 152, 149]);
    expect(new TextDecoder().decode(base64.content)).toBe('hello');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('uses an injected content decoder only after validating the manifest', async () => {
  const decode = vi.fn(() => new Uint8Array([7]));
  const store = createInMemoryArtifactStore({}, { taxonomy, contentCodec: { decode } });
  await expect(store.create({ name: 'bad.txt', content: 'x', artifactManifest: { kind: 'unknown' } })).rejects.toThrow(/invalid artifactManifest/);
  expect(decode).not.toHaveBeenCalled();
  const record = await store.create({ name: 'good.txt', content: 'eA==', encoding: 'base64', artifactManifest: { kind: 'text', renderer: 'text', exports: ['text'] } });
  expect(decode).toHaveBeenCalledWith({ content: 'eA==' }, { encoding: 'base64' });
  expect(Array.from(record.content)).toEqual([7]);
});
