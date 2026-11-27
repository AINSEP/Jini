import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bufferArchiveMedia, type ArchiveMediaHost, type ArchiveMediaSource } from '../archive-media.js';
import { SiteShareRefusal } from '../share-refusal.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const webp = Buffer.from('RIFF0000WEBPweb-copy');
const pdf = Buffer.from('%PDF-1.7\nbytes');
const svgDirty = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
type Params = { format: string };
type Ledger = { sizes: { path: string; bytes: number }[]; buffered: { path: string; content: Buffer }[] };
type Store = Map<string, Buffer>;

const sniff = ({ bytes }: { bytes: Uint8Array }) => {
  const buf = Buffer.from(bytes);
  if (buf.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71]))) return 'image/png';
  if (buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 4).toString() === '<svg') return 'image/svg+xml';
  if (buf.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  return 'application/octet-stream';
};
const host: ArchiveMediaHost<Ledger, Store> = {
  operations: {
    sniffContentType: sniff,
    sanitizeSvg: async ({ bytes }) => Buffer.from(Buffer.from(bytes).toString().replace(/<script>.*<\/script>/, '')),
    computeBlobStorageKey: ({ workspaceId, sha256 }) => `ws/${workspaceId}/blobs/${sha256}`,
    mimeForTransformFormat: ({ format }) => `image/${format}`,
  },
  paths: {
    validateSharePath: ({ path }) => { if (path.endsWith('.key')) throw new SiteShareRefusal({ code: 'UNSAFE_FILE', message: 'no key' }); },
    sharePathAlias: ({ path }) => path.toLowerCase(),
  },
  sharePolicy: {
    addBuffered: ({ ledger, file }) => { ledger.sizes.push({ path: file.path, bytes: file.content.length }); ledger.buffered.push(file); },
    reportedBlobSize: async ({ blobStore, storageKey }) => {
      const blob = blobStore.get(storageKey);
      if (!blob) throw new SiteShareRefusal({ code: 'MISSING_MEDIA', message: `missing ${storageKey}` });
      return blob.length;
    },
    fetchVerifiedBlob: async ({ blobStore, media, size }) => {
      const blob = blobStore.get(media.storageKey)!;
      if (blob.length !== size || (media.sha256 && hash(blob) !== media.sha256)) throw new SiteShareRefusal({ code: 'MEDIA_CHANGED', message: 'changed' });
      return blob;
    },
  },
};
const source = (id: string, slug: string, bytes = png): ArchiveMediaSource<Params> => ({ id, slug, kind: 'media', workspaceId: 'ws', originalFilename: null, storageKey: id, sha256: hash(bytes), public: { version: 3, params: { format: 'webp' } } });
const ledger = (): Ledger => ({ sizes: [], buffered: [] });
const transformer = (counter: { n: number }, bytes = webp) => ({ transform: async () => { counter.n++; return { bytes }; } });

describe('bufferArchiveMedia', () => {
  it('buffers one copy per item in id order, de-aliases case clashes and reuses a stored public copy', async () => {
    const counter = { n: 0 };
    const l = ledger();
    const store: Store = new Map([['a', png], ['b', png], ['public', webp]]);
    const copies = await bufferArchiveMedia({ sources: [source('b', 'PHOTO'), { ...source('a', 'Photo'), public: { version: 3, params: { format: 'webp' }, storageKey: 'public', sha256: hash(webp) } }], blobStore: store, imageTransformer: transformer(counter), ledger: l, host });
    expect(copies.map(copy => copy.path)).toEqual(['media/Photo.webp', 'media/PHOTO-2.webp']);
    expect(counter.n).toBe(1);
    expect(l.buffered).toHaveLength(2);
    expect(copies.every(copy => copy.sha256 === hash(webp) && copy.publicVersion === 3 && copy.contentType === 'image/webp')).toBe(true);
    expect(copies[0]!.storageKey).toBe(`ws/ws/blobs/${hash(webp)}`);
  });

  it('keeps document bytes, sanitizes SVG, keeps other types raw and falls back to .bin for a refused extension', async () => {
    const l = ledger();
    const mp4 = Buffer.from('....ftypmp4data');
    const sniffMp4: ArchiveMediaHost<Ledger, Store> = { ...host, operations: { ...host.operations, sniffContentType: ({ bytes }) => Buffer.from(bytes).toString().includes('ftypmp4') ? 'video/mp4' : sniff({ bytes }) } };
    const store: Store = new Map([['d', pdf], ['s', svgDirty], ['k', pdf], ['v', mp4], ['x', Buffer.from('plain')]]);
    const copies = await bufferArchiveMedia({
      sources: [
        { ...source('d', 'manual', pdf), kind: 'document', originalFilename: 'manual.pdf' },
        source('s', 'icon', svgDirty),
        { ...source('k', 'deck', pdf), kind: 'document', originalFilename: 'deck.KEY' },
        source('v', 'clip', mp4),
        { ...source('x', 'misc', Buffer.from('plain')), originalFilename: 'bad name.$$$' },
      ],
      blobStore: store, imageTransformer: transformer({ n: 0 }), ledger: l, host: sniffMp4,
    });
    expect(copies.map(c => c.path)).toEqual(['media/manual.pdf', 'media/deck.bin', 'media/icon.svg', 'media/clip.mp4', 'media/misc.bin']);
    expect(l.buffered[0]!.content).toEqual(pdf);
    expect(l.buffered[2]!.content.toString()).not.toMatch(/script|alert/);
  });

  it('keeps the .mov and .m4v extensions for QuickTime and M4V video instead of falling back to .bin', async () => {
    const mov = Buffer.from('....ftypqt  data');
    const m4v = Buffer.from('....ftypM4V data');
    const sniffVideo: ArchiveMediaHost<Ledger, Store> = { ...host, operations: { ...host.operations, sniffContentType: ({ bytes }) => {
      const text = Buffer.from(bytes).toString();
      return text.includes('ftypqt') ? 'video/quicktime' : text.includes('ftypM4V') ? 'video/x-m4v' : sniff({ bytes });
    } } };
    const copies = await bufferArchiveMedia({
      sources: [source('a', 'intro', mov), source('b', 'outro', m4v)],
      blobStore: new Map([['a', mov], ['b', m4v]]), imageTransformer: transformer({ n: 0 }), ledger: ledger(), host: sniffVideo,
    });
    expect(copies.map(c => [c.path, c.contentType])).toEqual([['media/intro.mov', 'video/quicktime'], ['media/outro.m4v', 'video/x-m4v']]);
  });

  it('names a slugless item by its id', async () => {
    const store: Store = new Map([['x', pdf]]);
    const copies = await bufferArchiveMedia({ sources: [{ ...source('x', '', pdf), kind: 'document', originalFilename: 'a.pdf' }], blobStore: store, imageTransformer: transformer({ n: 0 }), ledger: ledger(), host });
    expect(copies[0]!.path).toBe('media/x.pdf');
  });

  it('refuses a raster with no webp public transform, a non-webp rendition and a failing transform, never falling back to raw bytes', async () => {
    const store: Store = new Map([['p', png]]);
    const l = ledger();
    const run = (src: ArchiveMediaSource<Params>, t = transformer({ n: 0 })) => bufferArchiveMedia({ sources: [src], blobStore: store, imageTransformer: t, ledger: l, host });
    const { public: _omitted, ...noPublic } = source('p', 'a');
    await expect(run(noPublic)).rejects.toThrow("has no public webp transform");
    await expect(run({ ...source('p', 'a'), public: { version: 1, params: { format: 'jpeg' } } })).rejects.toThrow("has no public webp transform");
    await expect(run(source('p', 'a'), transformer({ n: 0 }, png))).rejects.toThrow("Cannot export media 'p' (a): public rendition is not webp");
    await expect(run(source('p', 'a'), { transform: async () => { throw new Error('decode failed'); } })).rejects.toThrow("decode failed");
    await expect(run(source('p', 'a'), { transform: async () => { throw 'boom'; } })).rejects.toThrow('image decode failed');
    await expect(run(source('p', 'a'), { transform: async () => { throw new Error('x'); } })).rejects.toBeInstanceOf(SiteShareRefusal);
    expect(l.buffered).toHaveLength(0);
  });

  it('propagates the host refusal for missing media and honours an aborted signal', async () => {
    await expect(bufferArchiveMedia({ sources: [source('gone', 'g')], blobStore: new Map(), imageTransformer: transformer({ n: 0 }), ledger: ledger(), host })).rejects.toMatchObject({ code: 'MISSING_MEDIA' });
    const abort = new AbortController(); abort.abort();
    await expect(bufferArchiveMedia({ sources: [source('p', 'a')], blobStore: new Map([['p', png]]), imageTransformer: transformer({ n: 0 }), ledger: ledger(), host }, { signal: abort.signal })).rejects.toThrow();
  });

  it('rethrows a non-refusal error from the path policy instead of renaming to .bin', async () => {
    const broken: ArchiveMediaHost<Ledger, Store> = { ...host, paths: { ...host.paths, validateSharePath: ({ path }) => { if (path.startsWith('media/')) throw new Error('policy crashed'); } } };
    await expect(bufferArchiveMedia({ sources: [{ ...source('d', 'm', pdf), kind: 'document', originalFilename: 'm.pdf' }], blobStore: new Map([['d', pdf]]), imageTransformer: transformer({ n: 0 }), ledger: ledger(), host: broken })).rejects.toThrow('policy crashed');
  });
});

it('uses an unhashed stored webp rendition without substituting the original hash', async () => {
  const counter = { n: 0 };
  const l = ledger();
  const photo: ArchiveMediaSource<Params> = {
    ...source('photo', 'cover'), public: { version: 9, params: { format: 'webp' }, storageKey: 'rendition' },
  };
  const copies = await bufferArchiveMedia({
    sources: [photo], blobStore: new Map([['photo', png], ['rendition', webp]]),
    imageTransformer: transformer(counter), ledger: l, host,
  });
  expect(copies).toEqual([{
    id: 'photo', slug: 'cover', path: 'media/cover.webp', sha256: hash(webp), workspaceId: 'ws',
    storageKey: `ws/ws/blobs/${hash(webp)}`, contentType: 'image/webp', publicVersion: 9, documentOwned: undefined,
  }]);
  expect(l.buffered).toEqual([{ path: 'media/cover.webp', content: webp }]);
  expect(counter.n).toBe(0);
});
