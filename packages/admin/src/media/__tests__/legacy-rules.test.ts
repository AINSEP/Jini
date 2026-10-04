import { describe, expect, it } from 'vitest';
import type { MediaAsset } from '../models.js';
import {
  countMediaTabs, diffMediaMetadata, filterMediaByTab, formatByteSize,
  mediaEmbedSnippet, parseOptionalPixelSize, queryMedia, resolveActiveTab,
} from '../rules.js';
import {
  describeMediaHtmlAttributeError, isAllowedMediaHtmlAttributeName,
  parseMediaHtmlAttributes,
} from '../html-attributes.js';

// Portable guards from the legacy byte-size, type/count, order, tab and HTML-attribute suites.
// These test outcomes rather than executing lines: rejection reasons and surviving tokens matter.
function asset(required: Partial<MediaAsset>, _optional: Record<string, never> = {}): MediaAsset {
  return {
    id: 'asset-1', title: 'Photo', slug: 'photo', alt: 'Accessible photo',
    publicUrl: '/media/photo', contentType: 'image/png', status: 'active',
    sha256: 'hash', caption: '', credit: '', createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', version: 1,
    width: null, height: null, cssClass: null, htmlAttributes: null,
    ...required,
  };
}

describe('legacy byte-size formatting', () => {
  // 1024-based units must agree with upload caps; MB/GB keep precision so different clips
  // do not misleadingly collapse to the same whole-number size.
  it.each([
    [0, '0 B'], [823, '823 B'], [823.6, '824 B'], [1023, '1023 B'],
    [1024, '1 KB'], [839_680, '820 KB'], [1023 * 1024, '1023 KB'],
    [1024 * 1024, '1.0 MB'], [9_961_472, '9.5 MB'],
    [10 * 1024 * 1024, '10.0 MB'], [1024 ** 3, '1.0 GB'],
    [1_288_490_189, '1.2 GB'],
  ])('formats %s bytes as %s', (bytes, expected) => {
    expect(formatByteSize({ bytes: bytes as number })).toBe(expected);
  });
  it('uses locale decimal separators and defaults to en-US', () => {
    expect(formatByteSize({ bytes: 9_961_472 }, { locale: 'de-DE' })).toBe('9,5 MB');
    expect(formatByteSize({ bytes: 9_961_472 })).toBe(
      formatByteSize({ bytes: 9_961_472 }, { locale: 'en-US' }),
    );
  });
});

describe('legacy attribute-name allowlist', () => {
  it.each([
    'data-motion', 'data-anything-at-all', 'data-x-1', 'aria-hidden', 'aria-label',
    'DATA-FOO', 'ARIA-LABEL', 'LOADING', 'loading', 'decoding', 'playsinline',
    'muted', 'loop', 'autoplay', 'poster', 'class', 'id', 'style', 'title', 'role',
    'tabindex', 'lang', 'dir', 'hidden', 'translate', 'draggable',
  ])('accepts well-formed allowed name %s', (name) => {
    expect(isAllowedMediaHtmlAttributeName({ name })).toBe(true);
  });
  // Prefix acceptance alone once admitted names that closed the tag. Escaping the VALUE
  // cannot protect a renderer that interpolates an unconstrained NAME.
  it.each([
    'href', 'srcdoc', 'formaction', 'x-data-foo', 'onerror', 'onclick',
    'data-x><svg/onload', 'data-a/onerror', 'aria-x<img', 'data-x`y', 'data-x>', 'aria-]',
  ])('rejects disallowed or tag-breaking name %s', (name) => {
    expect(isAllowedMediaHtmlAttributeName({ name })).toBe(false);
  });
});

describe('legacy HTML-attribute parsing', () => {
  it.each(['', '   '])('returns no attributes or errors for an empty draft %j', (text) => {
    expect(parseMediaHtmlAttributes({ text })).toEqual({ attributes: {}, errors: [], error: null });
  });
  it('parses quoted, single-quoted, unquoted and boolean tokens without changing values', () => {
    expect(parseMediaHtmlAttributes({ text: `DATA-Motion="Fade" aria-label='hello' loading=lazy muted` })).toEqual({
      attributes: { 'data-motion': 'Fade', 'aria-label': 'hello', loading: 'lazy', muted: '' },
      errors: [], error: null,
    });
  });
  it('accepts safe global styling/a11y attributes, including ordinary CSS url()', () => {
    expect(parseMediaHtmlAttributes({ text: `style="color:red;background:url(/hero.png)" id="hero" role=img tabindex=0` })).toEqual({
      attributes: { style: 'color:red;background:url(/hero.png)', id: 'hero', role: 'img', tabindex: '0' },
      errors: [], error: null,
    });
  });
  it.each([
    ['onerror="alert(1)"', 'event-handler', 'onerror'],
    ['OnClick="doThing()"', 'event-handler', 'onclick'],
    ['onerror="javascript:x"', 'event-handler', 'onerror'],
    ['poster="javascript:alert(1)"', 'unsafe-url', 'poster'],
    ['poster="  JavaScript:alert(1)"', 'unsafe-url', 'poster'],
    ['poster="java\tscript:alert(1)"', 'unsafe-url', 'poster'],
    ['poster="java\nscript:x"', 'unsafe-url', 'poster'],
    ['poster="vbscript:x"', 'unsafe-url', 'poster'],
    ['poster="data:text/html,x"', 'unsafe-url', 'poster'],
    ['data-hook="java\u0000script:x"', 'unsafe-url', 'data-hook'],
    ['formaction="javascript:x"', 'unsafe-url', 'formaction'],
    ['formaction="/x"', 'disallowed-name', 'formaction'],
    ['data-x><svg/onload=alert(1)', 'disallowed-name', 'data-x><svg/onload'],
  ] as const)('rejects %s with its specific reason', (text, reason, attribute) => {
    const error = { reason, attribute };
    expect(parseMediaHtmlAttributes({ text })).toEqual({ attributes: {}, errors: [error], error });
  });
  // Browsers strip interior ASCII whitespace from URL schemes. CSS escape sequences can
  // respell dangerous words, so a backslash is itself rejected rather than trusted.
  it.each([
    'expression(alert(1))', 'background:url(javascript:x)', 'background:url(vbscript:x)',
    '-moz-binding:url(x)', 'behavior:url(x)', '@import url(x)', 'color:\\65xpression(x)',
  ])('rejects CSS injection/escape vector %s despite allowing style itself', (value) => {
    const error = { reason: 'unsafe-style', attribute: 'style' };
    expect(parseMediaHtmlAttributes({ text: `style="${value}"` })).toEqual({
      attributes: {}, errors: [error], error,
    });
  });
  it('keeps good tokens around rejected tokens and records every rejection in order', () => {
    // A per-token rejection drops only that token. All-or-nothing rejection here would
    // silently remove independent, valid attributes from the operator's draft.
    expect(parseMediaHtmlAttributes({ text: 'data-motion="fade-in" formaction="/x" loading="lazy" onerror="alert(1)" aria-label="hello"' })).toEqual({
      attributes: { 'data-motion': 'fade-in', loading: 'lazy', 'aria-label': 'hello' },
      errors: [
        { reason: 'disallowed-name', attribute: 'formaction' },
        { reason: 'event-handler', attribute: 'onerror' },
      ],
      error: { reason: 'disallowed-name', attribute: 'formaction' },
    });
  });
  it.each(['loading="lazy" "stray-quote"', 'loading="lazy" "', '" loading="lazy"'])('fails the whole map closed when tokenization loses sync: %s', (text) => {
    // Malformed is different: downstream boundaries cannot be trusted because value
    // text might be misread as a new attribute name. Even already-accepted tokens are discarded.
    const parsed = parseMediaHtmlAttributes({ text });
    expect(parsed.attributes).toEqual({});
    expect(parsed.error?.reason).toBe('malformed');
    expect(parsed.errors).toEqual([parsed.error]);
  });
  it('retains prior rejection diagnostics while a malformed fragment clears accepted tokens', () => {
    const parsed = parseMediaHtmlAttributes({ text: 'onerror=x loading=lazy "' });
    expect(parsed.attributes).toEqual({});
    expect(parsed.errors).toEqual([
      { reason: 'event-handler', attribute: 'onerror' }, { reason: 'malformed', attribute: '"' },
    ]);
    expect(parsed.error).toEqual({ reason: 'malformed', attribute: '"' });
  });
  it.each([
    ['event-handler', 'onerror', "Event handler attributes like 'onerror' are not allowed."],
    ['unsafe-url', 'poster', "'poster' cannot use a javascript: value."],
    ['unsafe-style', 'style', "'style' cannot use an unsafe style value."],
    ['disallowed-name', 'formaction', "'formaction' is not an allowed HTML attribute."],
    ['malformed', 'stray-quote', "Could not parse HTML attributes near 'stray-quote'."],
  ] as const)('names the rejected token in the %s message', (reason, attribute, expected) => {
    expect(describeMediaHtmlAttributeError({ error: { reason, attribute } })).toBe(expected);
  });
});

describe('legacy type tabs and counts', () => {
  const images = [asset({ id: 'png' }), asset({ id: 'svg', contentType: 'image/svg+xml' })];
  const video = asset({ id: 'video', contentType: 'video/webm' });
  const untyped = asset({ id: 'untyped', contentType: null });
  const unknown = asset({ id: 'unknown', contentType: 'application/octet-stream' });
  const media = [...images, video, untyped, unknown];
  it('keeps untyped and unknown assets in All without guessing their type', () => {
    expect(filterMediaByTab({ media, tab: 'all' })).toEqual(media);
    expect(filterMediaByTab({ media, tab: 'images' })).toEqual(images);
    expect(filterMediaByTab({ media, tab: 'videos' })).toEqual([video]);
  });
  it('accepts new codecs through MIME family prefixes', () => {
    const futureImage = asset({ contentType: 'image/future-codec' });
    const futureVideo = asset({ contentType: 'video/future-codec' });
    expect(filterMediaByTab({ media: [futureImage, futureVideo], tab: 'images' })).toEqual([futureImage]);
    expect(filterMediaByTab({ media: [futureImage, futureVideo], tab: 'videos' })).toEqual([futureVideo]);
  });
  it('uses exactly the filter counts and updates after adding or removing an asset', () => {
    expect(countMediaTabs({ media })).toEqual({ all: 5, images: 2, videos: 1 });
    expect(countMediaTabs({ media: [...media, asset({ id: 'new' })] })).toEqual({ all: 6, images: 3, videos: 1 });
    expect(countMediaTabs({ media: media.filter((item) => item.id !== 'video') })).toEqual({ all: 4, images: 2, videos: 0 });
  });
  it('retains known zero counts instead of treating them as loading absence', () => {
    // Loading belongs to the controller; this helper receives a resolved array.
    expect(countMediaTabs({ media: [] })).toEqual({ all: 0, images: 0, videos: 0 });
    expect(countMediaTabs({ media: images })).toEqual({ all: 2, images: 2, videos: 0 });
  });
});

describe('legacy query order and tab resolution', () => {
  const zebra = asset({ id: 'zebra', title: 'Zebra Zoo', createdAt: '2026-08-01' });
  const apple = asset({ id: 'apple', title: ' apple pie ', createdAt: '2026-08-02' });
  const mango = asset({ id: 'mango', title: 'Mango Tart', createdAt: '2026-08-03' });
  const media = [zebra, apple, mango];
  it('defaults to newest-first and can change to alphabetical and back', () => {
    expect(queryMedia({ media, query: {} })).toEqual([mango, apple, zebra]);
    expect(queryMedia({ media, query: { orderBy: 'alphabetical' } })).toEqual([apple, mango, zebra]);
    expect(queryMedia({ media, query: { orderBy: 'created' } })).toEqual([mango, apple, zebra]);
    expect(media).toEqual([zebra, apple, mango]);
  });
  it('breaks timestamp ties by descending ID regardless of insertion order', () => {
    const a = asset({ id: 'a-tie' });
    const b = asset({ id: 'b-tie' });
    expect(queryMedia({ media: [a, b], query: { orderBy: 'created' } })).toEqual([b, a]);
    expect(queryMedia({ media: [b, a], query: { orderBy: 'created' } })).toEqual([b, a]);
  });
  it('treats title case and edge whitespace as equal, ties by ascending ID, and sorts empty first', () => {
    const a = asset({ id: 'a-tie', title: 'Apple' });
    const b = asset({ id: 'b-tie', title: ' apple ' });
    const empty = asset({ id: 'empty', title: '' });
    expect(queryMedia({ media: [b, a, empty], query: { orderBy: 'alphabetical' } })).toEqual([empty, a, b]);
  });
  it('combines type filtering with trimmed case-insensitive title/alt search', () => {
    const photo = asset({ id: 'photo', title: 'Coast', alt: 'Rocky shore' });
    const video = asset({ id: 'clip', title: 'Rocky clip', contentType: 'video/mp4' });
    expect(queryMedia({ media: [photo, video], query: { filter: 'images', search: ' ROCKY ' } })).toEqual([photo]);
    expect(queryMedia({ media: [photo, video], query: { search: 'clip' } })).toEqual([video]);
    expect(queryMedia({ media: [photo, video], query: { search: 'absent' } })).toEqual([]);
  });
  it.each(['all', 'images', 'videos', 'external-providers'] as const)('accepts tab %s', (tabId) => {
    expect(resolveActiveTab({ tabId })).toBe(tabId);
  });
  it.each([undefined, null, '', 'bogus', 'Images', 'videos ', '__proto__'])('falls back to All for stale/raw tab %j', (tabId) => {
    // A typo or stale link must not blank the whole panel.
    expect(resolveActiveTab({ tabId })).toBe('all');
  });
});

describe('legacy metadata and public embed rules', () => {
  it('keeps slug independent of title and sends only genuinely changed metadata', () => {
    const item = asset({});
    expect(diffMediaMetadata({ item, draft: { title: 'Renamed', slug: 'photo', alt: item.alt } })).toEqual({ title: 'Renamed' });
    expect(diffMediaMetadata({ item, draft: { slug: 'new-slug', title: item.title } })).toEqual({ slug: 'new-slug' });
    expect(diffMediaMetadata({ item, draft: { title: item.title } })).toEqual({});
  });
  it('represents native-size clearing as null and leaves unprovided fields alone', () => {
    expect(parseOptionalPixelSize({ value: '' })).toBeNull();
    expect(parseOptionalPixelSize({ value: '  ' })).toBeNull();
    expect(parseOptionalPixelSize({ value: '320' })).toBe(320);
    expect(diffMediaMetadata({ item: asset({ width: 320, height: 240 }), draft: { width: null, height: null } })).toEqual({ width: null, height: null });
  });
  it('diffs without validating HTML hints so dirty invalid attributes still reach server validation', () => {
    // The old early return on the live hint silently prevented independent title/alt saves.
    // The diff has no opinion on validity; only the server decides whether the atomic patch lands.
    expect(diffMediaMetadata({ item: asset({}), draft: { title: 'Renamed', htmlAttributes: 'onerror=x' } })).toEqual({
      title: 'Renamed', htmlAttributes: 'onerror=x',
    });
  });
  it('emits the exact saved-slug embed marker and no marker without a CMS slug', () => {
    expect(mediaEmbedSnippet({ slug: 'photo' })).toBe(`<div data-embed-config='{"type":"media","slug":"photo"}'></div>`);
    expect(mediaEmbedSnippet({})).toBeNull();
    expect(mediaEmbedSnippet({ slug: '' })).toBeNull();
  });
  it('escapes attribute delimiters for slugs supplied by an untrusted adapter', () => {
    // Real hosts validate slugs, but the generic helper must not let a third-party
    // adapter terminate the quoted configuration attribute and inject markup.
    expect(mediaEmbedSnippet({ slug: "a'&<>" })).toBe(`<div data-embed-config='{"type":"media","slug":"a&#39;&amp;&lt;&gt;"}'></div>`);
  });
});
