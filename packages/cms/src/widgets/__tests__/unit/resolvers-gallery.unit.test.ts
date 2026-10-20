import { describe, expect, it } from 'vitest';

import type { GalleryMediaResolver } from '../../gallery-resolver.js';
import { createGalleryWidgetResolver } from '../../resolvers/gallery.js';
import type { WidgetInstanceView, WidgetRenderIR, WidgetResolveContext } from '../../types.js';

/**
 * @file `gallery`/`media` widget resolver — direct unit coverage of `createGalleryWidgetResolver`'s
 * own branches: per-instance config rejection (parse vs registered schema, chosen by widget type),
 * the empty-starter short-circuit, the shared embed batch, and per-instance degrade when the embed
 * pipeline drops an instance (page media budget).
 */

const CTX: WidgetResolveContext = { workspaceId: 'ws-1', preview: false };
type MediaCall = Parameters<Parameters<typeof createGalleryWidgetResolver>[0]['resolveMedia']>[0];

/** Records each media batch and resolves every requested legacy id to an image IR for that id. */
function recordingMedia(): { calls: MediaCall[]; resolveMedia: (required: MediaCall) => ReturnType<GalleryMediaResolver> } {
  const calls: MediaCall[] = [];
  return {
    calls,
    resolveMedia: async (required) => {
      calls.push(required);
      return new Map<string, WidgetRenderIR>(required.refs.map(ref => [ref.id ?? ref.slug!, { componentId: 'media-image', props: { assetId: ref.id ?? ref.slug! } }]));
    },
  };
}

function gallery(id: string, config: WidgetInstanceView['config'], widgetType: WidgetInstanceView['widgetType'] = 'gallery'): WidgetInstanceView {
  return { id, widgetType, config };
}

describe('createGalleryWidgetResolver', () => {
  it('rejects a config the gallery parser refuses as resolver-error without calling media', async () => {
    const media = recordingMedia();
    const results = await createGalleryWidgetResolver(media).resolveMany([gallery('w', { images: [{ mediaId: 'one' }], layout: 'bad' })], CTX);
    expect(results.get('w')).toEqual({ ok: false, reason: 'resolver-error' });
    expect(media.calls).toEqual([]);
  });

  it('rejects a parser-valid config the registered gallery schema refuses (unknown key) as resolver-error', async () => {
    const results = await createGalleryWidgetResolver(recordingMedia()).resolveMany([gallery('w', { images: [{ mediaId: 'one' }], layout: 'grid', extra: true })], CTX);
    expect(results.get('w')).toEqual({ ok: false, reason: 'resolver-error' });
  });

  it('validates a media widget against the media schema, which has no legacy images key', async () => {
    const results = await createGalleryWidgetResolver(recordingMedia()).resolveMany([gallery('w', { images: [{ mediaId: 'one' }], layout: 'grid' }, 'media')], CTX);
    expect(results.get('w')).toEqual({ ok: false, reason: 'resolver-error' });
  });

  it('resolves an empty gallery starter to the gallery component with no media and no media call', async () => {
    const media = recordingMedia();
    const config = { images: [], layout: 'grid' };
    const results = await createGalleryWidgetResolver(media).resolveMany([gallery('w', config)], CTX);
    expect(results.get('w')).toEqual({ ok: true, ir: { componentId: 'gallery', props: { config, media: {} } }, dependencyKeys: ['w'] });
    expect(media.calls).toEqual([]);
  });

  it('resolves an empty media starter to the media component', async () => {
    const config = { mode: 'media', items: [], layout: 'grid' };
    const results = await createGalleryWidgetResolver(recordingMedia()).resolveMany([gallery('w', config, 'media')], CTX);
    expect(results.get('w')).toEqual({ ok: true, ir: { componentId: 'media', props: { config, media: {} } }, dependencyKeys: ['w'] });
  });

  it('sends html-mode content through the embed pipeline even though it has no images', async () => {
    const config = { mode: 'html', html: '<p>Hello</p>' };
    const results = await createGalleryWidgetResolver(recordingMedia()).resolveMany([gallery('w', config, 'media')], CTX);
    const result = results.get('w');
    expect(result?.ok).toBe(true);
    if (result?.ok) expect(result.ir.componentId).toBe('media');
  });

  it('resolves images with the widget id then each referenced media id as dependency keys', async () => {
    const config = { images: [{ mediaId: 'one', alt: 'One' }, { mediaId: 'two', alt: 'Two' }], layout: 'grid' };
    const results = await createGalleryWidgetResolver(recordingMedia()).resolveMany([gallery('w', config)], CTX);
    const result = results.get('w');
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.dependencyKeys).toEqual(['w', 'one', 'two']);
    expect(result.ir).toEqual({ componentId: 'gallery', props: { config, media: { one: { assetId: 'one' }, two: { assetId: 'two' } } } });
  });

  it('passes the resolve context to the media port alongside the batched refs', async () => {
    const media = recordingMedia();
    await createGalleryWidgetResolver(media).resolveMany([gallery('w', { images: [{ mediaId: 'one' }], layout: 'grid' })], CTX);
    expect(media.calls.map(call => call.context)).toEqual([CTX]);
    expect(media.calls[0]!.refs.map(ref => ref.id)).toEqual(['one']);
  });

  it('degrades only the gallery the embed pipeline drops at the page media budget', async () => {
    const images = (prefix: string) => Array.from({ length: 30 }, (_, index) => ({ mediaId: `${prefix}${index}` }));
    const results = await createGalleryWidgetResolver(recordingMedia()).resolveMany([
      gallery('first', { images: images('a'), layout: 'grid' }),
      gallery('second', { images: images('b'), layout: 'grid' }),
    ], CTX);
    expect(results.get('first')?.ok).toBe(true);
    expect(results.get('second')).toEqual({ ok: false, reason: 'resolver-error' });
  });

  it('keys every instance by id: pre-media outcomes first in input order, then the embedded ones', async () => {
    const results = await createGalleryWidgetResolver(recordingMedia()).resolveMany([
      gallery('bad', { images: [], layout: 'nope' }),
      gallery('full', { images: [{ mediaId: 'one' }], layout: 'grid' }),
      gallery('empty', { images: [], layout: 'grid' }),
    ], CTX);
    expect([...results.keys()]).toEqual(['bad', 'empty', 'full']);
    expect(results.get('bad')?.ok).toBe(false);
    expect(results.get('full')?.ok).toBe(true);
    expect(results.get('empty')?.ok).toBe(true);
  });
});
