import { expect, test, vi } from 'vitest';
import { ToolInputError, type ToolExecutionContext } from '@jini-ai/core';
import { createHash } from 'node:crypto';
import { InMemoryMediaRepo, InMemoryAssetBlobRepo } from '../../repo.memory.js';
import { InMemoryBlobStore } from '../../blob-store.memory.js';
import type { ImageCodecPort } from '../../image-codec.js';
import type { MediaRecord } from '../../types.js';
import { isoBmffVideoBytes } from '../../__tests__/iso-bmff-fixture.js';
import { buildMediaViewImageAgentToolCatalog, contributeMediaViewImageTools, type MediaViewImageToolDeps } from '../view-image-tool.js';

test('uses the injected metadata write id for read-only image guidance', () => {
  const [tool] = buildMediaViewImageAgentToolCatalog({
    mediaAssetReadToolId: 'assets.read', mediaMetadataWriteToolId: 'assets.save_metadata',
  });
  expect(tool!.sideEffects).toBe('none');
  expect(tool!.description).toContain('Read-only: it changes nothing');
  expect(tool!.description).toContain('to save new alt text afterwards, use assets.save_metadata.');
  expect(tool!.description).toContain("When asked to save what you see, call assets.save_metadata with a short factual description of the picture and the asset's current version.");
  expect(tool!.description).not.toContain('media_update_metadata');
});

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function fixture(bytes: Uint8Array = png) {
  const workspaceId = 'west';
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const asset: MediaRecord = {
    id: 'photo', workspaceId, slug: 'garden', title: 'Garden photo', alt: 'A path', caption: 'June', credit: '',
    source: { sha256, contentType: 'image/png' }, status: 'active', version: 5, createdAt: '2026-11-12', updatedAt: '2026-11-12',
    width: null, height: null, cssClass: null, htmlAttributes: null,
  };
  const mediaRepo = new InMemoryMediaRepo({}, { initialRows: [asset] });
  const assetBlobRepo = new InMemoryAssetBlobRepo({});
  const blobStore = new InMemoryBlobStore();
  const { storageKey } = await blobStore.put({ workspaceId, sha256, bytes });
  await assetBlobRepo.save({ id: 'blob', workspaceId, sha256, storageKey, status: 'active', createdAt: asset.createdAt, createdByPrincipal: 'owner' });
  const imageCodec = {
    inspect: vi.fn<ImageCodecPort['inspect']>(async () => ({ width: 2400, height: 1200, orientation: 6, hasAlpha: true, autoOrient: { width: 1200, height: 2400 } })),
    encode: vi.fn<ImageCodecPort['encode']>(async () => ({ bytes: Uint8Array.from([7, 8, 9]), width: 784, height: 1568 })),
    encodeTiles: async () => { throw new Error('unexpected tiling'); },
  };
  const authorize = vi.fn<MediaViewImageToolDeps['authorize']>(async () => ({ allowed: true, reason: 'matched' }));
  const deps = { workspaceId, authorize, mediaRepo, assetBlobRepo, blobStore, imageCodec };
  const [registration] = contributeMediaViewImageTools({ mediaAssetReadToolId: 'assets.read', mediaMetadataWriteToolId: 'assets.edit' }).build(deps, {});
  const context = (mediaId: string): ToolExecutionContext => ({
    executionId: 'view', input: { mediaId }, principal: { id: 'editor' }, run: { id: 'run' }, signal: new AbortController().signal,
  });
  const read = (id = asset.id) => registration!.handler(context(id));
  return { read, asset, mediaRepo, imageCodec, authorize, storageKey, blobStore };
}

test('returns the oriented bounded WebP and read-only metadata through the registered tool', async () => {
  const f = await fixture();
  expect(await f.read()).toEqual({ content: [
    { type: 'text', text: JSON.stringify({ id: 'photo', slug: 'garden', title: 'Garden photo', alt: 'A path', caption: 'June', status: 'active',
      original: { contentType: 'image/png', width: 1200, height: 2400 },
      returned: { mimeType: 'image/webp', width: 784, height: 1568, downscaled: true },
    }) },
    { type: 'image', mimeType: 'image/webp', data: 'BwgJ' },
  ] });
  expect(f.imageCodec.inspect.mock.calls).toEqual([[{ source: Buffer.from(png) }]]);
  expect(f.imageCodec.encode.mock.calls).toEqual([[{ source: Buffer.from(png), autoOrient: true, format: 'webp', quality: 80,
    resize: { width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true } }]]);
  expect(f.authorize.mock.calls).toEqual([[{ principalId: 'editor', permission: 'media.read', workspaceId: 'west', entityType: 'media' }]]);
  expect(await f.mediaRepo.findById({ workspaceId: 'west', id: 'photo' })).toEqual(f.asset);
});

test('missing or non-raster media never reach the codec, and a decode fault becomes a caller refusal', async () => {
  const video = await fixture(isoBmffVideoBytes('qt  '));
  const svg = await fixture(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
  await expect(video.read()).rejects.toThrow(/is a video \(video\/quicktime\).*Use media_view_video/);
  await expect(svg.read()).rejects.toThrow("is not a viewable image (its stored bytes are image/svg+xml)");
  expect(video.imageCodec.inspect.mock.calls).toEqual([]);
  expect(svg.imageCodec.inspect.mock.calls).toEqual([]);
  const raster = await fixture();
  await expect(raster.read('missing')).rejects.toThrow("no media asset with id or slug 'missing'. Use assets.read");
  expect(raster.imageCodec.inspect.mock.calls).toEqual([]);
  raster.imageCodec.inspect.mockRejectedValueOnce(new Error('private codec diagnostic'));
  const failure = raster.read();
  await expect(failure).rejects.toBeInstanceOf(ToolInputError);
  await expect(failure).rejects.toThrow("media asset 'photo' could not be decoded as an image (image/png) — its stored file may be damaged.");
  expect(raster.imageCodec.encode.mock.calls).toEqual([]);
});

test('an unrotated or mirrored source keeps its dimensions, and a height-only downscale is still reported', async () => {
  const metadataOf = async (f: Awaited<ReturnType<typeof fixture>>) =>
    JSON.parse((await f.read() as { content: [{ text: string }] }).content[0].text) as { original: object; returned: object };
  const tall = await fixture();
  tall.imageCodec.inspect.mockResolvedValueOnce({ width: 800, height: 2000, hasAlpha: false, autoOrient: { width: 800, height: 2000 } });
  tall.imageCodec.encode.mockResolvedValueOnce({ bytes: Uint8Array.from([1]), width: 800, height: 1568 });
  const tallMeta = await metadataOf(tall);
  expect([tallMeta.original, tallMeta.returned]).toEqual([
    { contentType: 'image/png', width: 800, height: 2000 },
    { mimeType: 'image/webp', width: 800, height: 1568, downscaled: true },
  ]);
  const mirrored = await fixture();
  mirrored.imageCodec.inspect.mockResolvedValueOnce({ width: 600, height: 400, orientation: 4, hasAlpha: false, autoOrient: { width: 600, height: 400 } });
  mirrored.imageCodec.encode.mockResolvedValueOnce({ bytes: Uint8Array.from([2]), width: 600, height: 400 });
  const mirroredMeta = await metadataOf(mirrored);
  expect([mirroredMeta.original, mirroredMeta.returned]).toEqual([
    { contentType: 'image/png', width: 600, height: 400 },
    { mimeType: 'image/webp', width: 600, height: 400, downscaled: false },
  ]);
});
