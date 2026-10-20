import { describe, expect, it } from 'vitest';
import { galleryMediaReferences, MAX_GALLERY_IMAGES, mediaHtmlSlugs, parseGalleryConfig } from '../markers/gallery.js';

/** Boundary pins for both gallery config shapes: legacy `images` and slug-first `items`/`html`. */

const legacy = { images: [{ mediaId: 'one', alt: '' }], layout: 'grid' };
const many = (count: number, make: (index: number) => unknown) => Array.from({ length: count }, (_, index) => make(index));

describe('parseGalleryConfig legacy images', () => {
  it('accepts a valid gallery and returns the authored object', () => {
    const config = { ...legacy, columns: 6, aspectRatio: '4 / 3', lightbox: false, extra: 1 };
    expect(parseGalleryConfig({ config })).toEqual({ config, errors: [], warnings: [] });
  });
  it('rejects an empty image list unless allowEmpty is set', () => {
    expect(parseGalleryConfig({ config: { images: [], layout: 'grid' } }).errors).toEqual([`images must contain between 1 and ${MAX_GALLERY_IMAGES} images`]);
    expect(parseGalleryConfig({ config: { images: [], layout: 'grid' } }, { allowEmpty: true }).errors).toEqual([]);
  });
  it('accepts exactly the image cap and rejects one more', () => {
    const image = () => ({ mediaId: 'm', alt: '' });
    expect(parseGalleryConfig({ config: { images: many(MAX_GALLERY_IMAGES, image), layout: 'grid' } }).errors).toEqual([]);
    expect(parseGalleryConfig({ config: { images: many(MAX_GALLERY_IMAGES + 1, image), layout: 'grid' } }).errors).toEqual(['images must contain between 1 and 50 images']);
  });
  it('rejects a non-array images value', () => {
    expect(parseGalleryConfig({ config: { images: 'x', layout: 'grid' } })).toEqual({ errors: ['images must contain between 1 and 50 images'], warnings: [] });
  });
  it('reports every image error in order before option errors, keeping warnings', () => {
    const config = { images: [{ mediaId: 'a', src: 'https://e.com/x', alt: 1, caption: 2 }, { mediaId: 'a/b' }, 7], layout: 'single', columns: 1, aspectRatio: '0', lightbox: 'yes' };
    expect(parseGalleryConfig({ config })).toEqual({
      errors: [
        'images[0] requires exactly one of mediaId or src',
        'images[0].alt must be a string',
        'images[0].caption must be a string',
        'images[1].mediaId must be a nonempty media id of at most 200 characters, without slashes or whitespace',
        'images[2] must be an object',
        'layout must be grid, carousel or masonry',
        'columns must be an integer between 2 and 6',
        'aspectRatio must be a positive number or ratio such as 16/9',
        'lightbox must be a boolean',
      ],
      warnings: ['images[1].alt is missing; supply alt text or an explicit empty string for a decorative image'],
    });
  });
  it('rejects an image with neither mediaId nor src', () => {
    expect(parseGalleryConfig({ config: { images: [{ alt: '' }], layout: 'grid' } }).errors).toEqual(['images[0] requires exactly one of mediaId or src']);
  });
  it('rejects a src that is not http(s)', () => {
    expect(parseGalleryConfig({ config: { images: [{ src: 'ftp://e.com/x', alt: '' }], layout: 'grid' } }).errors).toEqual(['images[0].src must be an HTTP(S) image URL without credentials, at most 2048 characters']);
  });
  it('rejects unparseable, oversized and non-string sources', () => {
    for (const src of ['not a URL', `https://e.com/${'a'.repeat(2048)}`, '', 5]) {
      expect(parseGalleryConfig({ config: { images: [{ src, alt: '' }], layout: 'grid' } }).errors).toEqual(['images[0].src must be an HTTP(S) image URL without credentials, at most 2048 characters']);
    }
  });
  it('rejects columns above 6 and fractional columns', () => {
    expect(parseGalleryConfig({ config: { ...legacy, columns: 7 } }).errors).toEqual(['columns must be an integer between 2 and 6']);
    expect(parseGalleryConfig({ config: { ...legacy, columns: 2.5 } }).errors).toEqual(['columns must be an integer between 2 and 6']);
  });
  it('accepts columns of 2', () => {
    expect(parseGalleryConfig({ config: { ...legacy, columns: 2 } }).errors).toEqual([]);
  });
  it('rejects a non-string layout', () => {
    expect(parseGalleryConfig({ config: { ...legacy, layout: undefined } }).errors).toEqual(['layout must be grid, carousel or masonry']);
  });
});

describe('parseGalleryConfig media items', () => {
  it('normalizes items into images with the default single layout', () => {
    const items = [{ slug: 'one', alt: 'A', caption: 'C' }];
    const config = { items, cssClass: 'c', htmlAttributes: 'data-x="1"', columns: 1, aspectRatio: '16/9' };
    const parsed = parseGalleryConfig({ config });
    expect(parsed).toEqual({ config: { ...config, mode: 'media', images: items, layout: 'single' }, errors: [], warnings: [] });
    expect(parsed.config!.images).not.toBe(items);
  });
  it('keeps an explicit layout and ignores lightbox validation', () => {
    for (const layout of ['single', 'grid', 'carousel', 'masonry']) {
      expect(parseGalleryConfig({ config: { mode: 'media', items: [], layout, lightbox: 'not validated' } }).config?.layout).toBe(layout);
    }
  });
  it('accepts exactly the item cap and rejects one more', () => {
    expect(parseGalleryConfig({ config: { items: many(MAX_GALLERY_IMAGES, () => ({ slug: 's' })) } }).errors).toEqual([]);
    expect(parseGalleryConfig({ config: { items: many(MAX_GALLERY_IMAGES + 1, () => ({ slug: 's' })) } })).toEqual({ errors: ['items must be an array of at most 50 slug items'], warnings: [] });
  });
  it('reports mode, string option, item and option errors in order', () => {
    const config = { mode: 'other', htmlAttributes: 1, cssClass: 2, items: [3, { slug: '', src: 'x', alt: 1, caption: 2 }, { slug: 's', mediaId: 'm' }], layout: 'slider', columns: 0, aspectRatio: 'x' };
    expect(parseGalleryConfig({ config })).toEqual({
      errors: [
        'mode must be media or html',
        'htmlAttributes must be a string',
        'cssClass must be a string',
        'items[0] must be an object',
        'items[1].slug must be a nonempty slug of at most 200 characters without slashes or whitespace',
        'items[1] uses slug, never src or mediaId',
        'items[1].alt must be a string',
        'items[1].caption must be a string',
        'items[2] uses slug, never src or mediaId',
        'layout must be single, grid, carousel or masonry',
        'columns must be an integer between 1 and 6',
        'aspectRatio must be a positive number or ratio such as 16/9',
      ],
      warnings: [],
    });
  });
  it('rejects columns above 6', () => {
    expect(parseGalleryConfig({ config: { items: [], columns: 7 } }).errors).toEqual(['columns must be an integer between 1 and 6']);
  });
  it('drops mode and string option errors when items is not an array (reported, not fixed)', () => {
    expect(parseGalleryConfig({ config: { mode: 'other', cssClass: 1 } })).toEqual({ errors: ['items must be an array of at most 50 slug items'], warnings: [] });
  });
});

describe('parseGalleryConfig html mode', () => {
  it('infers html mode from an html field', () => {
    const config = { html: '<p></p>', cssClass: 'c' };
    expect(parseGalleryConfig({ config })).toEqual({ config: { ...config, mode: 'html', images: [], layout: 'single' }, errors: [], warnings: [] });
  });
  it('accepts html of exactly 65536 characters', () => {
    expect(parseGalleryConfig({ config: { html: 'a'.repeat(65536) } }).errors).toEqual([]);
  });
  it('rejects oversized html with the string option errors first', () => {
    expect(parseGalleryConfig({ config: { html: 'a'.repeat(65537), htmlAttributes: 1 } })).toEqual({ errors: ['htmlAttributes must be a string', 'html must be a string of at most 65536 characters'], warnings: [] });
  });
  it('rejects an explicit html mode without html text', () => {
    expect(parseGalleryConfig({ config: { mode: 'html' } }).errors).toEqual(['html must be a string of at most 65536 characters']);
  });
});

describe('galleryMediaReferences', () => {
  it('prefers items over images and reads slug before mediaId', () => {
    const config = { items: [{ slug: 's', mediaId: 'm' }, { mediaId: 'm2' }, null, { slug: 'a/b' }], images: [{ mediaId: 'ignored' }] };
    expect(galleryMediaReferences({ config })).toEqual([{ mediaId: 's', index: 0 }, { mediaId: 'm2', index: 1 }]);
  });
  it('falls back to images, then to no list', () => {
    expect(galleryMediaReferences({ config: { images: [{ mediaId: 'i' }] } })).toEqual([{ mediaId: 'i', index: 0 }]);
    expect(galleryMediaReferences({ config: { items: 'x', images: 'y' } })).toEqual([]);
  });
  it('indexes only the first image-cap items', () => {
    const refs = galleryMediaReferences({ config: { items: many(MAX_GALLERY_IMAGES + 1, index => ({ slug: `s${index}` })) } });
    expect(refs).toHaveLength(MAX_GALLERY_IMAGES);
    expect(refs.at(-1)).toEqual({ mediaId: 's49', index: 49 });
  });
  it('appends html slugs indexed by running count, then nested content with its own indexes', () => {
    const config = { items: [{ slug: 'a' }], html: '{{media:b}}', content: { items: [{ slug: 'c' }] } };
    expect(galleryMediaReferences({ config })).toEqual([{ mediaId: 'a', index: 0 }, { mediaId: 'b', index: 1 }, { mediaId: 'c', index: 0 }]);
  });
  it('ignores non-string html and non-record content', () => {
    expect(galleryMediaReferences({ config: { html: 1, content: [] } })).toEqual([]);
  });
});

describe('mediaHtmlSlugs', () => {
  it('reads tokens then every data-media-slug quoting style, decoding and filtering keys', () => {
    const html = `{{media:a&amp;b}}{{media:x y}}<i data-media-slug="d"></i><i DATA-MEDIA-SLUG = 's'></i><i data-media-slug=bare></i><i data-media-slug=""></i>`;
    expect(mediaHtmlSlugs({ html })).toEqual(['a&b', 'd', 's', 'bare']);
  });
});
