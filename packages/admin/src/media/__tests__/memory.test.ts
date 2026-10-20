import { describe, it, expect } from 'vitest';
import { createMemoryMediaApi, createMemoryMediaProviders } from '../adapters/memory.js';
import type { MediaAsset, MediaProvider } from '../models.js';

const NOW = '2026-01-01T00:00:00.000Z';
const png = { filename: 'a.png', contentType: 'image/png', dataBase64: 'AAAA' };

function seed(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'seed',
    title: 'Seed',
    alt: '',
    publicUrl: null,
    contentType: 'image/png',
    status: 'active',
    sha256: 'seed-sha',
    caption: '',
    credit: '',
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function aborted() {
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  return controller.signal;
}

describe('createMemoryMediaApi', () => {
  it('advertises replace and restore support', () => {
    const api = createMemoryMediaApi({});
    expect([api.replaceSupported, api.restoreSupported]).toEqual([true, true]);
  });

  it('lists seeded assets as frozen copies', async () => {
    const original = seed();
    const listed = await createMemoryMediaApi({ assets: [original] }).list({});
    expect(listed).toEqual([original]);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(listed[0])).toBe(true);
    expect(listed[0]).not.toBe(original);
  });

  it('upload with no options fills every default from the filename and generated id', async () => {
    const api = createMemoryMediaApi({}, { now: () => NOW });
    expect(await api.upload(png)).toEqual({
      id: 'memory-1',
      title: 'a.png',
      alt: '',
      caption: '',
      credit: '',
      slug: 'memory-1',
      width: null,
      height: null,
      cssClass: null,
      htmlAttributes: null,
      status: 'active',
      publicUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
      byteSize: 3,
      contentType: 'image/png',
      sha256: 'memory-content-2',
    });
  });

  it('upload keeps every provided metadata option and never stores the signal', async () => {
    const api = createMemoryMediaApi({}, { now: () => NOW });
    const asset = await api.upload(png, {
      signal: new AbortController().signal,
      title: 'T',
      alt: 'A',
      caption: 'C',
      credit: 'Cr',
      slug: 's',
      width: 10,
      height: 20,
      cssClass: 'c',
      htmlAttributes: 'data-x="1"',
    });
    expect(asset).toMatchObject({
      title: 'T',
      alt: 'A',
      caption: 'C',
      credit: 'Cr',
      slug: 's',
      width: 10,
      height: 20,
      cssClass: 'c',
      htmlAttributes: 'data-x="1"',
    });
    expect('signal' in asset).toBe(false);
  });

  it('upload treats an empty-string option as provided, not as missing', async () => {
    const asset = await createMemoryMediaApi({}).upload(png, { title: '', slug: '' });
    expect([asset.title, asset.slug]).toEqual(['', '']);
  });

  it('upload skips generated ids that collide with seeded assets', async () => {
    const api = createMemoryMediaApi({ assets: [seed({ id: 'memory-1' }), seed({ id: 'memory-2' })] });
    expect((await api.upload(png)).id).toBe('memory-3');
  });

  it('upload returns a frozen asset that list then includes', async () => {
    const api = createMemoryMediaApi({});
    const asset = await api.upload(png);
    expect(Object.isFrozen(asset)).toBe(true);
    expect(await api.list({})).toEqual([asset]);
  });

  it('upload computes byteSize from base64 length minus padding', async () => {
    const api = createMemoryMediaApi({});
    const sizes = await Promise.all(
      ['AAAA', 'AAA=', 'AA==', ''].map(async (dataBase64) => (await api.upload({ ...png, dataBase64 })).byteSize),
    );
    expect(sizes).toEqual([3, 2, 1, 0]);
  });

  it('upload clamps byteSize at zero for padding-only input', async () => {
    const asset = await createMemoryMediaApi({}).upload({ ...png, dataBase64: '==' });
    expect(asset.byteSize).toBe(0);
  });

  it('every method rejects with the abort reason when the signal is already aborted', async () => {
    const api = createMemoryMediaApi({ assets: [seed()] });
    const signal = aborted();
    const calls = [
      api.list({}, { signal }),
      api.upload(png, { signal }),
      api.update({ id: 'seed', patch: {} }, { signal }),
      api.replace!({ id: 'seed', upload: png }, { signal }),
      api.trash({ id: 'seed' }, { signal }),
      api.restore!({ id: 'seed' }, { signal }),
      api.delete({ id: 'seed' }, { signal }),
    ];
    for (const call of calls) await expect(call).rejects.toThrow('stop');
  });

  it('update applies only defined metadata keys, keeps null clears, and bumps version', async () => {
    const api = createMemoryMediaApi({ assets: [seed({ width: 5 })] }, { now: () => 'later' });
    // A non-literal patch may carry extra keys structurally; only metadata keys may land.
    const patch = { title: 'New', width: null, status: 'trashed' as const };
    // An untyped (JS) caller can still send an explicit undefined; it must not erase the field.
    Object.assign(patch, { alt: undefined });
    const next = await api.update({ id: 'seed', patch });
    expect(next).toEqual({ ...seed(), title: 'New', width: null, version: 2, updatedAt: 'later' });
  });

  it('update of an unknown id rejects naming the id', async () => {
    await expect(createMemoryMediaApi({}).update({ id: 'nope', patch: {} })).rejects.toThrow('Media not found: nope');
  });

  it('replace swaps content, keeps identity, and bumps version', async () => {
    const api = createMemoryMediaApi({ assets: [seed()] }, { now: () => 'later' });
    const next = await api.replace!({ id: 'seed', upload: { ...png, contentType: 'image/webp', dataBase64: 'AA==' } });
    expect(next).toEqual({
      ...seed(),
      byteSize: 1,
      contentType: 'image/webp',
      sha256: 'memory-content-1',
      version: 2,
      updatedAt: 'later',
    });
  });

  it('replace of a trashed asset rejects', async () => {
    const api = createMemoryMediaApi({ assets: [seed({ status: 'trashed' })] });
    await expect(api.replace!({ id: 'seed', upload: png })).rejects.toThrow('Cannot replace trashed media: seed (restore it first)');
  });

  it('trash marks the asset trashed, clears publicUrl, and bumps version', async () => {
    const api = createMemoryMediaApi({ assets: [seed({ publicUrl: 'https://x' })] }, { now: () => 'later' });
    expect(await api.trash({ id: 'seed' })).toEqual({ ...seed(), status: 'trashed', version: 2, updatedAt: 'later' });
  });

  it('restore marks the asset active and bumps version', async () => {
    const api = createMemoryMediaApi({ assets: [seed({ status: 'trashed' })] }, { now: () => 'later' });
    expect(await api.restore!({ id: 'seed' })).toEqual({ ...seed(), version: 2, updatedAt: 'later' });
  });

  it('delete purges a trashed asset', async () => {
    const api = createMemoryMediaApi({ assets: [seed({ status: 'trashed' })] });
    expect(await api.delete({ id: 'seed' })).toEqual({ purged: true });
    expect(await api.list({ status: 'trashed' })).toEqual([]);
  });

  it('delete of an active asset rejects and keeps it', async () => {
    const api = createMemoryMediaApi({ assets: [seed()] });
    await expect(api.delete({ id: 'seed' })).rejects.toThrow('Trash media before permanent deletion: seed');
    expect(await api.list({})).toHaveLength(1);
  });

  it('originalUrl uses the memory:// scheme with an encoded id', () => {
    expect(createMemoryMediaApi({}).originalUrl({ id: 'a/b' })).toBe('memory://media-original/a%2Fb');
  });
});

describe('createMemoryMediaProviders', () => {
  const provider: MediaProvider = { id: 'p', label: 'P', configured: false };

  it('lists seeded providers as a frozen array of frozen copies', async () => {
    const listed = await createMemoryMediaProviders({ providers: [provider] }).list({});
    expect(listed).toEqual([provider]);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(listed![0])).toBe(true);
  });

  it('lists nothing when no providers are seeded', async () => {
    expect(await createMemoryMediaProviders({}).list({})).toEqual([]);
  });

  it('saveSettings stores baseUrl and model', async () => {
    const port = createMemoryMediaProviders({ providers: [provider] });
    const next = await port.saveSettings!({ id: 'p', baseUrl: 'https://b', model: 'm' });
    expect(next).toEqual({ ...provider, baseUrl: 'https://b', model: 'm' });
    expect(await port.list({})).toEqual([next]);
  });

  it('saveSettings of an unknown provider rejects', async () => {
    const port = createMemoryMediaProviders({});
    await expect(port.saveSettings!({ id: 'x', baseUrl: '', model: '' })).rejects.toThrow('Unknown media provider: x');
  });

  it('saveCredential marks the provider configured without storing the credential', async () => {
    const next = await createMemoryMediaProviders({ providers: [provider] }).saveCredential({ id: 'p', credential: 'k' });
    expect(next).toEqual({ ...provider, configured: true });
  });

  it('saveCredential rejects a blank credential', async () => {
    const port = createMemoryMediaProviders({ providers: [provider] });
    await expect(port.saveCredential({ id: 'p', credential: '  ' })).rejects.toThrow('Credential is required for media provider: p');
  });

  it('saveCredential of an unknown provider rejects', async () => {
    const port = createMemoryMediaProviders({});
    await expect(port.saveCredential({ id: 'x', credential: 'k' })).rejects.toThrow('Unknown media provider: x');
  });

  it('removeCredential marks the provider unconfigured', async () => {
    const port = createMemoryMediaProviders({ providers: [{ ...provider, configured: true }] });
    expect(await port.removeCredential({ id: 'p' })).toEqual(provider);
  });

  it('every provider method rejects with the abort reason when the signal is already aborted', async () => {
    const port = createMemoryMediaProviders({ providers: [provider] });
    const signal = aborted();
    const calls = [
      port.list({}, { signal }),
      port.saveSettings!({ id: 'p', baseUrl: '', model: '' }, { signal }),
      port.saveCredential({ id: 'p', credential: 'k' }, { signal }),
      port.removeCredential({ id: 'p' }, { signal }),
    ];
    for (const call of calls) await expect(call).rejects.toThrow('stop');
  });
});
