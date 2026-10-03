import { describe, expect, it } from 'vitest';
import {
  ArtifactManifestInvalidError,
  ArtifactManifestRequiredError,
  createInMemoryArtifactStore,
  resolveArtifactManifest,
} from '../store.js';
import type { ArtifactManifestTaxonomy, ManifestInferrer } from '../manifest.js';

const taxonomy: ArtifactManifestTaxonomy = {
  allowedKinds: new Set(['html']),
  allowedRenderers: new Set(['html']),
  allowedExports: new Set(['html']),
};

const validInput = {
  name: 'index.html',
  content: '<html></html>',
  artifactManifest: { kind: 'html', renderer: 'html', exports: ['html'] },
};

describe('resolveArtifactManifest', () => {
  it('validates and returns an explicitly-supplied manifest', () => {
    const manifest = resolveArtifactManifest({ input: validInput, taxonomy: taxonomy, inferManifest: () => null });
    expect(manifest.kind).toBe('html');
    expect(manifest.entry).toBe('index.html');
  });

  it('falls back to the inferrer when no manifest is supplied', () => {
    const inferrer: ManifestInferrer = () => ({ kind: 'html', renderer: 'html', exports: ['html'] });
    const manifest = resolveArtifactManifest({ input: { name: 'a.html', content: 'x' }, taxonomy: taxonomy, inferManifest: inferrer });
    expect(manifest.kind).toBe('html');
  });

  it('treats an explicit null manifest the same as undefined (falls back to the inferrer)', () => {
    const inferrer: ManifestInferrer = () => ({ kind: 'html', renderer: 'html', exports: ['html'] });
    const manifest = resolveArtifactManifest({ input: { name: 'a.html', content: 'x', artifactManifest: null }, taxonomy: taxonomy, inferManifest: inferrer });
    expect(manifest.kind).toBe('html');
  });

  it('throws ArtifactManifestRequiredError when neither an explicit manifest nor the inferrer produces one', () => {
    expect(() => resolveArtifactManifest({ input: { name: 'a.html', content: 'x' }, taxonomy: taxonomy, inferManifest: () => null })).toThrow(
      ArtifactManifestRequiredError,
    );
  });

  it('throws ArtifactManifestInvalidError when the resolved manifest fails taxonomy validation', () => {
    expect(() =>
      resolveArtifactManifest({ input: { name: 'a.html', content: 'x', artifactManifest: { kind: 'not-allowed', renderer: 'html', exports: ['html'] } }, taxonomy: taxonomy, inferManifest: () => null }),
    ).toThrow(ArtifactManifestInvalidError);
  });

  it('validates an inferred (not explicit) manifest too', () => {
    const badInferrer: ManifestInferrer = () => ({ kind: 'not-allowed', renderer: 'html', exports: ['html'] });
    expect(() => resolveArtifactManifest({ input: { name: 'a.html', content: 'x' }, taxonomy: taxonomy, inferManifest: badInferrer })).toThrow(
      ArtifactManifestInvalidError,
    );
  });
});

describe('createInMemoryArtifactStore', () => {
  it('creates an artifact and stores utf8 content by default', async () => {
    const store = createInMemoryArtifactStore({}, { taxonomy });
    const record = await store.create(validInput);
    expect(record.name).toBe('index.html');
    expect(new TextDecoder().decode(record.content)).toBe('<html></html>');
    expect(record.manifest.kind).toBe('html');
  });

  it('decodes base64-encoded content', async () => {
    const store = createInMemoryArtifactStore({}, { taxonomy });
    const b64 = Buffer.from('hello').toString('base64');
    const record = await store.create({ ...validInput, content: b64, encoding: 'base64' });
    expect(new TextDecoder().decode(record.content)).toBe('hello');
  });

  it('get() returns null for a missing artifact and the record for an existing one', async () => {
    const store = createInMemoryArtifactStore({}, { taxonomy });
    expect(await store.get({ name: 'missing.html' })).toBeNull();
    await store.create(validInput);
    const got = await store.get({ name: 'index.html' });
    expect(got?.name).toBe('index.html');
  });

  it('create() overwrites an existing artifact with the same name', async () => {
    const store = createInMemoryArtifactStore({}, { taxonomy });
    await store.create(validInput);
    await store.create({ ...validInput, content: '<html>v2</html>' });
    const got = await store.get({ name: 'index.html' });
    expect(new TextDecoder().decode(got?.content)).toBe('<html>v2</html>');
  });

  it('list() returns every stored artifact, most-recently-updated first', async () => {
    const store = createInMemoryArtifactStore({}, { taxonomy });
    await store.create({ ...validInput, name: 'a.html' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.create({ ...validInput, name: 'b.html' });
    const all = await store.list();
    expect(all.map((r) => r.name)).toEqual(['b.html', 'a.html']);
  });

  it('list() returns an empty array for an empty store', async () => {
    const store = createInMemoryArtifactStore({}, { taxonomy });
    expect(await store.list()).toEqual([]);
  });

  it('defaults to the empty taxonomy and noop inferrer when no options are supplied', async () => {
    const store = createInMemoryArtifactStore({});
    await expect(store.create({ name: 'a.html', content: 'x' })).rejects.toThrow(ArtifactManifestRequiredError);
  });

  it('uses a supplied inferManifest option', async () => {
    const inferrer: ManifestInferrer = () => ({ kind: 'html', renderer: 'html', exports: ['html'] });
    const store = createInMemoryArtifactStore({}, { taxonomy, inferManifest: inferrer });
    const record = await store.create({ name: 'a.html', content: 'x' });
    expect(record.manifest.kind).toBe('html');
  });
});

describe('error classes', () => {
  it('ArtifactManifestRequiredError carries the artifact name in its message and code', () => {
    const err = new ArtifactManifestRequiredError({ name: 'a.html' });
    expect(err.code).toBe('ARTIFACT_MANIFEST_REQUIRED');
    expect(err.message).toContain('a.html');
    expect(err.name).toBe('ArtifactManifestRequiredError');
  });

  it('ArtifactManifestInvalidError carries the validation message and code', () => {
    const err = new ArtifactManifestInvalidError({ message: 'kind is not allowed' });
    expect(err.code).toBe('ARTIFACT_MANIFEST_INVALID');
    expect(err.message).toContain('kind is not allowed');
  });
});
