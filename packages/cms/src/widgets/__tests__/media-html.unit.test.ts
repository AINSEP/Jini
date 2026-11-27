import { describe, expect, it } from 'vitest';
import { renderMediaRawHtml, sanitizePageHtml, type MediaHtmlEvent } from '../html/media-html.js';

const renderPhoto = ({ props }: { props: Record<string, unknown> }): string => props.slug === 'photo' ? '<img src="/photo" alt="Library">' : '';
const media = { photo: { slug: 'photo' } };

describe('media-html diagnostics reach the injected report, never a console', () => {
  it('reports the sanitizer drops, then each kind mismatch and unknown slug, in visit order', () => {
    const events: MediaHtmlEvent[] = [];
    const html = '<script>x()</script><p>{{media:ghost}}</p><video data-media-slug="photo"></video><b>kept</b>';
    const output = renderMediaRawHtml({ html, media, renderMedia: renderPhoto }, { report: event => events.push(event) });
    expect(output).toBe('<b>kept</b>');
    expect(events.map(event => [event.code, JSON.parse(event.detail)])).toEqual([
      ['raw-html-dropped', { script: 1 }],
      ['media-kind-mismatch', { slug: 'photo', tag: 'video', mediaTag: 'img' }],
      ['unknown-media-slug', { slug: 'ghost' }],
    ]);
  });

  it('is silent without a report and returns the same markup', () => {
    const html = '<script>x()</script><p>{{media:ghost}}</p><video data-media-slug="photo"></video><b>kept</b>';
    expect(renderMediaRawHtml({ html, media, renderMedia: renderPhoto })).toBe('<b>kept</b>');
  });

  it('reports one drop event per sanitizing call and none when nothing is dropped', () => {
    const events: MediaHtmlEvent[] = [];
    const report = (event: MediaHtmlEvent): void => { events.push(event); };
    expect(sanitizePageHtml({ html: '<iframe src="https://x.example/"></iframe><i>ok</i>' }, { report })).toBe('<i>ok</i>');
    expect(sanitizePageHtml({ html: '<i>ok</i><!-- note -->' }, { report })).toBe('<i>ok</i>');
    expect(events).toEqual([{ code: 'raw-html-dropped', detail: '{"iframe":1}' }]);
  });

  it('a custom reportDrops replaces the event for drops', () => {
    const events: MediaHtmlEvent[] = [];
    const drops: Record<string, number>[] = [];
    sanitizePageHtml({ html: '<script>a()</script>' }, { report: event => events.push(event), reportDrops: ({ dropped }) => drops.push(dropped) });
    expect(drops).toEqual([{ script: 1 }]);
    expect(events).toEqual([]);
  });

  it('parses a malformed fragment and resolves the media in it', () => {
    const html = '<p>open <b>bold <img data-media-slug="photo"></i> tail';
    expect(renderMediaRawHtml({ html, media, renderMedia: renderPhoto })).toBe('<p>open <b>bold <img data-media-slug="photo" src="/photo" alt="Library"> tail</b></p>');
  });

  it('keeps valid responsive sources and drops the entire srcset when a candidate is empty, malformed, or not HTTP(S)', () => {
    const html = '<img alt="valid" srcset="/small.jpg 1x, https://example.test/large.jpg 2x">' +
      '<img alt="empty" srcset="">' +
      '<img alt="malformed" srcset="https://[bad]/photo.jpg 1x">' +
      '<img alt="unsupported" srcset="/small.jpg 1x, ftp://example.test/large.jpg 2x">';
    const events: MediaHtmlEvent[] = [];
    expect(sanitizePageHtml({ html }, { report: event => events.push(event) })).toBe(
      '<img alt="valid" srcset="/small.jpg 1x, https://example.test/large.jpg 2x">' +
      '<img alt="empty"><img alt="malformed"><img alt="unsupported">',
    );
    expect(events).toEqual([{ code: 'raw-html-dropped', detail: '{"img@srcset":3}' }]);
  });

  it('bounds nesting inside templates while preserving markup which fits the limit', () => {
    const admitted = '<template>' + '<div>'.repeat(126);
    const closing = '</div>'.repeat(126) + '</template>';
    const html = admitted + '<b>retained<em>over depth</em></b>' + closing;
    const events: MediaHtmlEvent[] = [];
    expect(sanitizePageHtml({ html }, { report: event => events.push(event) })).toBe(admitted + '<b>retained</b>' + closing);
    expect(events).toEqual([{ code: 'raw-html-dropped', detail: '{"em":1}' }]);
  });

  it('preserves SVG geometry and removes namespaced links', () => {
    const html = '<svg viewBox="0 0 8 8"><path d="M 0 0 L 8 8" xlink:href="/unused.svg" /></svg>';
    const events: MediaHtmlEvent[] = [];
    expect(sanitizePageHtml({ html }, { report: event => events.push(event) })).toBe('<svg viewBox="0 0 8 8"><path d="M 0 0 L 8 8"></path></svg>');
    expect(events).toEqual([{ code: 'raw-html-dropped', detail: '{"path@xlink:href":1}' }]);
  });
});
