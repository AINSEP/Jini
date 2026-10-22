import { describe, it, expect } from 'vitest';
import { getWidgetTypeRegistration } from '../registry.js';
import { validateWidgetConfig } from '../config-validation.js';
import { createGalleryWidgetResolver } from '../resolvers/gallery.js';
import { resolveGalleryEmbeds } from '../gallery-resolver.js';
import { parseGalleryConfig } from '../markers/gallery.js';
import { renderGallery } from '../html/gallery-render.js';
import { parseEmbedHtmlAttributes } from '../markers/html-attributes.js';

const config = { images: [{ mediaId: 'one', alt: 'First', caption: 'Caption' }], layout: 'grid', columns: 3, aspectRatio: '16/9' };
const context = { workspaceId: 'ws', preview: false };
describe('gallery widget', () => {
  it('registers inline/region gallery and validates the same gallery contract at write time', () => {
    const registration = getWidgetTypeRegistration({ typeKey: 'gallery' });
    expect(registration.placementContexts).toEqual(['region', 'inline']);
    for (const layout of ['grid', 'carousel', 'masonry']) expect(validateWidgetConfig({ schema: registration.configSchema, config: { ...config, layout } }).valid).toBe(true);
    expect(validateWidgetConfig({ schema: registration.configSchema, config: { images: [], layout: 'grid' } }).valid).toBe(true);
    for (const invalid of [{ ...config, layout: 'bad' }, { ...config, columns: 8 }, { ...config, aspectRatio: '1; color:red' }, { ...config, images: [{ src: 'https://example.com/image' }] }, { ...config, images: [{ mediaId: 'bad/id' }] }, { ...config, images: [{ mediaId: 'one', alt: 4 }] }, { ...config, images: Array.from({ length: 51 }, () => ({ mediaId: 'one' })) }]) expect(validateWidgetConfig({ schema: registration.configSchema, config: invalid }).valid).toBe(false);
  });
  it('reuses embed resolution and rendering byte for byte and deduplicates assets across widgets', async () => {
    const calls: string[][] = [];
    const resolveMedia = async ({ refs }: { refs: readonly { id: string | null }[] }) => {
      calls.push(refs.map(ref => ref.id!));
      return new Map([['one', { componentId: 'media-image', props: { assetId: 'one' } }]]);
    };
    const resolver = createGalleryWidgetResolver({ resolveMedia });
    const results = await resolver.resolveMany([{ id: 'w1', widgetType: 'gallery', config }, { id: 'w2', widgetType: 'gallery', config }], context as Parameters<typeof resolver.resolveMany>[1]);
    expect(calls).toEqual([['one']]);
    const embed = await resolveGalleryEmbeds({ refs: [{ type: 'gallery', id: 'g', slug: null, name: null, variant: null, header: true, config }], resolveMedia });
    const render = (props: Record<string, unknown>) => renderGallery({ config: props.config, media: props.media, renderImage: ({ image }) => `<img alt="${image.alt}">` });
    const result = results.get('w1')!;
    expect(result.ok).toBe(true);
    if (result.ok) expect(render(result.ir.props)).toBe(render(embed.get('g')!.props));
  });
  it('renders an empty default without calling media and isolates invalid instances', async () => {
    const resolver = createGalleryWidgetResolver({ resolveMedia: async () => { throw new Error('no media work'); } });
    const results = await resolver.resolveMany([{ id: 'empty', widgetType: 'gallery', config: { images: [], layout: 'grid' } }, { id: 'bad', widgetType: 'gallery', config: { images: [], layout: 'invalid' } }], context as Parameters<typeof resolver.resolveMany>[1]);
    expect(results.get('bad')?.ok).toBe(false);
    expect(renderGallery({ config: { images: [], layout: 'grid' }, renderImage: () => '' })).toContain('Choose images');
    expect(renderGallery({ config: { mode: 'media', items: [], layout: 'grid' }, renderImage: () => '' })).toContain('Choose media in the Media widget editor.');
    expect(results.get('empty')?.ok).toBe(true);
    expect(parseGalleryConfig({ config: { images: [], layout: 'grid' } }).config).toBeUndefined();
  });
  it('keeps data-kui and safe sibling attributes while stripping event handlers and script URLs', () => {
    const parsed = parseEmbedHtmlAttributes({ text: 'data-kui="carousel target photos" data-id="photos" onclick="alert(1)" poster="javascript:alert(1)"' });
    expect(parsed.attributes).toEqual({ 'data-kui': 'carousel target photos', 'data-id': 'photos' });
    expect(parsed.errors.map(error => error.reason)).toEqual(['event-handler', 'unsafe-url']);
  });
});
