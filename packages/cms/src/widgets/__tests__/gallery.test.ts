import { describe, expect, it } from 'vitest';
import { parseGalleryConfig, galleryMediaReferences, MAX_GALLERY_IMAGES } from '../markers/gallery.js';
import { renderGallery } from '../html/gallery-render.js';
import { resolveGalleryEmbeds } from '../gallery-resolver.js';
import { scanHtmlEmbeds, substituteHtmlEmbeds } from '../html/html-embeds.js';
import { isPlausibleMediaRefId } from '../markers/media-reference.js';
import type { WidgetRenderIR } from '../types.js';

const config = { images: [{ mediaId: 'one', alt: 'First', caption: '<caption>' }, { src: 'https://example.com/two.jpg', alt: '' }], layout: 'grid', columns: 3 };

describe('gallery config', () => {
  it('shares the exact media reference bounds with the single-image resolver', () => {
    for (const value of ['a', 'a'.repeat(200), '__proto__']) expect(isPlausibleMediaRefId({ value })).toBe(true);
    for (const value of ['', 'a'.repeat(201), 'a/b', 'a b', 1, null]) expect(isPlausibleMediaRefId({ value })).toBe(false);
    expect(galleryMediaReferences({ config: null })).toEqual([]);
    expect(parseGalleryConfig({ config: null }).errors).toEqual(['gallery config must be an object']);
  });
  it('accepts all layouts, decorative alt and safe ratios', () => {
    for (const layout of ['grid', 'carousel', 'masonry']) {
      expect(parseGalleryConfig({ config: { ...config, layout, aspectRatio: '16/9', lightbox: true } }).errors).toEqual([]);
    }
    expect(parseGalleryConfig({ config: { images: [{ mediaId: 'one' }], layout: 'grid' } }).warnings).toEqual(['images[0].alt is missing; supply alt text or an explicit empty string for a decorative image']);
  });
  it.each([
    [{}, 'images'],
    [{ ...config, layout: 'slider' }, 'layout'],
    [{ ...config, layout: { toString: 'grid' } }, 'layout'],
    [{ ...config, images: [null] }, 'object'],
    [{ ...config, images: [{ src: 'not a URL' }] }, 'src'],
    [{ ...config, images: [{ src: 'https://user:pass@example.com/x' }] }, 'src'],
    [{ ...config, columns: 7 }, 'columns'],
    [{ ...config, columns: 2.5 }, 'columns'],
    [{ ...config, aspectRatio: '1; background:url(x)' }, 'aspectRatio'],
    [{ ...config, aspectRatio: '0/1' }, 'aspectRatio'],
    [{ ...config, lightbox: 'yes' }, 'lightbox'],
    [{ ...config, images: [{ mediaId: 'one', src: 'https://example.com/x' }] }, 'exactly one'],
    [{ ...config, images: [{ src: 'javascript:alert(1)' }] }, 'src'],
    [{ ...config, images: [{ mediaId: 'bad/id' }] }, 'mediaId'],
    [{ ...config, images: [{ mediaId: 'one', alt: 2 }] }, 'alt'],
    [{ ...config, images: [{ mediaId: 'one', caption: {} }] }, 'caption'],
    [{ ...config, images: Array.from({ length: MAX_GALLERY_IMAGES + 1 }, () => ({ mediaId: 'one' })) }, 'images'],
  ])('reports invalid config without throwing', (config, message) => {
    const result = parseGalleryConfig({ config });
    expect(result.config).toBeUndefined();
    expect(result.errors.join(' ')).toContain(message);
  });
  it('keeps references in a partially invalid gallery, including duplicate occurrences', () => {
    expect(galleryMediaReferences({ config: { images: [{ mediaId: 'one' }, null, { mediaId: 'one' }, { src: 'https://example.com/x' }, { mediaId: 'two' }], layout: 'bad' } })).toEqual([
      { mediaId: 'one', index: 0 }, { mediaId: 'one', index: 2 }, { mediaId: 'two', index: 4 },
    ]);
    expect(galleryMediaReferences({ config: { images: Array.from({ length: MAX_GALLERY_IMAGES + 1 }, () => ({ mediaId: 'one' })) } })).toHaveLength(MAX_GALLERY_IMAGES);
  });
});

describe('gallery resolution and rendering', () => {
  it('uses occurrence keys even for identical authored ids and preserves wrappers', () => {
    const html = `<div class="custom" data-embed-config='${JSON.stringify({ type: 'gallery', id: 'same', ...config })}'></div><div data-embed-config='${JSON.stringify({ type: 'gallery', id: 'same', ...config, layout: 'carousel' })}'></div>`;
    const refs = scanHtmlEmbeds({ html });
    expect(refs.map(ref => ref.id)).toEqual(['gallery:1', 'gallery:2']);
    expect(substituteHtmlEmbeds({ html, resolve: ref => ref.id! })).toBe('<div class="custom">gallery:1</div>gallery:2');
  });
  it('deduplicates media work while retaining order, captions and occurrence options', async () => {
    const html = `<div data-embed-config='${JSON.stringify({ type: 'gallery', ...config })}'></div><div data-embed-config='${JSON.stringify({ type: 'gallery', ...config, layout: 'carousel' })}'></div>`;
    const calls: string[][] = [];
    const resolved = await resolveGalleryEmbeds({ refs: scanHtmlEmbeds({ html }), resolveMedia: async ({ refs }) => {
      calls.push(refs.map(ref => ref.id!));
      return new Map([['one', { componentId: 'media-image', props: { assetId: 'one', alt: 'Stored alt' } }]]);
    } });
    expect(calls).toEqual([['one']]);
    expect(resolved.get('gallery:1')?.props.config).toMatchObject({ layout: 'grid' });
    expect(resolved.get('gallery:2')?.props.config).toMatchObject({ layout: 'carousel' });
    const output = renderGallery({ config, media: resolved.get('gallery:1')!.props.media, renderImage: ({ image }) => `<img alt="${image.alt}">` });
    expect(output).toContain('jini-gallery-grid');
    expect(output).toContain('<figure class="jini-gallery-item"');
    expect(output).toContain('<figcaption>&lt;caption&gt;</figcaption>');
    expect(output).toContain('<img alt="First">');
    expect(output).toContain('<img alt="">');
  });
  it('flags absent alt, exposes native keyboard scrolling, and leaves enhancement opt-in', () => {
    const output = renderGallery({ config: { images: [{ src: 'https://example.com/x' }], layout: 'carousel', lightbox: true }, renderImage: () => '<img alt="">' });
    expect(output).toContain('tabindex="0"');
    expect(output).toContain('scroll-snap-type:x mandatory');
    expect(output).toContain('data-jini-alt-missing');
    expect(output).toContain('data-jini-lightbox="true"');
    expect(output).not.toContain('<script');
  });
  it('does no media work for invalid config and degrades safely on invalid render input', async () => {
    const resolved = await resolveGalleryEmbeds({ refs: scanHtmlEmbeds({ html: `<div data-embed-config='{"type":"gallery","images":[],"layout":"grid"}'></div>` }), resolveMedia: async () => { throw new Error('must not run'); } });
    expect(resolved.size).toBe(0);
    expect(renderGallery({ config: {}, renderImage: () => { throw new Error('must not run'); } })).toBe('');
  });
  it('reports budget overflow without partially resolving the rejected gallery', async () => {
    const marker = (images: unknown[]) => `<div data-embed-config='${JSON.stringify({ type: 'gallery', layout: 'grid', images })}'></div>`;
    const reports: string[] = [];
    let requested: (string | null)[] = [];
    const result = await resolveGalleryEmbeds({
      refs: scanHtmlEmbeds({ html: marker([{ mediaId: 'one' }]) + marker([{ mediaId: 'one' }, { mediaId: 'two' }]) }),
      resolveMedia: async ({ refs }) => { requested = refs.map(ref => ref.id); return new Map(); },
    }, { maxMedia: 1, reportIssue: ({ messages }) => { reports.push(...messages); } });
    expect(requested).toEqual(['one']);
    expect([...result.keys()]).toEqual(['gallery:1']);
    expect(reports).toEqual(['gallery media exceeds the page budget of 1 distinct assets']);
  });
  it('bounds an unresolved media wait and reports timeout', async () => {
    const reports: string[] = [];
    const result = await resolveGalleryEmbeds({
      refs: scanHtmlEmbeds({ html: `<div data-embed-config='{"type":"gallery","layout":"grid","images":[{"mediaId":"one"}]}'></div>` }),
      resolveMedia: () => new Promise(() => {}),
    }, { timeoutMs: 1, reportIssue: ({ messages }) => { reports.push(...messages); } });
    expect(result.size).toBe(0);
    expect(reports).toEqual(['gallery media resolution timed out']);
  });
  it('retains prototype-shaped media keys, skips videos, and falls back to stored alt', async () => {
    const html = `<div data-embed-config='{"type":"gallery","layout":"grid","images":[{"mediaId":"__proto__"},{"mediaId":"video"}]}'></div>`;
    const result = await resolveGalleryEmbeds({ refs: scanHtmlEmbeds({ html }), resolveMedia: async () => new Map<string, WidgetRenderIR>([
      ['__proto__', { componentId: 'media-image', props: { alt: 'Stored', assetId: '__proto__' } }],
      ['video', { componentId: 'media-image', props: { contentType: 'video/mp4', assetId: 'video' } }],
    ]) });
    const props = result.get('gallery:1')!.props;
    const seen: string[] = [];
    const rendered = renderGallery({ config: props.config, media: props.media, renderImage: ({ image, media }) => { seen.push(image.alt); return media ? '<img>' : ''; } });
    expect(seen).toEqual(['Stored']);
    expect((rendered.match(/data-jini-alt-missing/g) ?? []).length).toBe(0);
    expect((rendered.match(/<figure/g) ?? []).length).toBe(1);
    expect(Object.hasOwn(props.media as object, 'video')).toBe(false);
  });
  it('requires canonical ids so a rendered asset is the same asset safe-delete indexes', async () => {
    const reports: string[] = [];
    const result = await resolveGalleryEmbeds({
      refs: scanHtmlEmbeds({ html: `<div data-embed-config='{"type":"gallery","layout":"grid","images":[{"mediaId":"photo-slug","alt":"Photo"}]}'></div>` }),
      resolveMedia: async () => new Map([['photo-slug', { componentId: 'media-image', props: { assetId: 'canonical-id' } }]]),
    }, { reportIssue: ({ messages }) => { reports.push(...messages); } });
    const props = result.get('gallery:1')!.props;
    expect(Object.hasOwn(props.media as object, 'photo-slug')).toBe(false);
    expect(reports).toEqual(['gallery mediaId must be the canonical media id, not a slug']);
  });
});
