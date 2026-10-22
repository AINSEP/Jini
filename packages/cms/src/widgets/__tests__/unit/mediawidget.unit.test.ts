/** Owner-approved mediawidget brief, 2026-10-10/11: slug-first media with gallery compatibility. */
import assert from 'node:assert/strict';
import test from '../support/test-runner.js';
import { parseGalleryConfig, galleryMediaReferences } from '../../markers/gallery.js';
import { resolveGalleryEmbeds } from '../../gallery-resolver.js';
import { scanHtmlEmbeds } from '../../html/html-embeds.js';
import { validateWidgetConfig } from '../../config-validation.js';
import type { WidgetRenderIR } from '../../types.js';
import { getWidgetTypeRegistration } from '../../registry.js';

test('media config validates both modes, rejects URL items and unsafe shapes, and reads legacy gallery', () => {
  const schema = getWidgetTypeRegistration({ typeKey: 'media' }).configSchema;
  for (const config of [{ mode: 'media', items: [{ slug: 'photo' }], layout: 'single', columns: 1 }, { mode: 'html', html: '<img data-media-slug="photo">' }]) {
    assert.equal(validateWidgetConfig({ schema, config }).valid, true);
    assert.ok(parseGalleryConfig({ config }).config);
  }
  for (const config of [{ items: [{ src: 'https://example.com/image.jpg' }] }, { mode: 'html', html: 3 }, { items: [{ slug: 'bad/slug' }] }, { items: [{ slug: 'ok' }], layout: 'slider' }]) assert.equal(validateWidgetConfig({ schema, config }).valid, false);
  assert.ok(parseGalleryConfig({ config: { images: [{ mediaId: 'old-id' }], layout: 'grid' } }).config);
});

test('media layouts remain literal enums rather than accepting coercible objects or arrays', () => {
  for (const layout of [{ toString: () => 'grid' }, ['grid']]) {
    const result = parseGalleryConfig({ config: { mode: 'media', items: [{ slug: 'photo' }], layout } });
    assert.equal(result.config, undefined);
    assert.deepEqual(result.errors, ['layout must be single, grid, carousel or masonry']);
  }
  for (const layout of ['single', 'grid', 'carousel', 'masonry']) {
    assert.equal(parseGalleryConfig({ config: { mode: 'media', items: [{ slug: 'photo' }], layout } }).config?.layout, layout);
  }
  assert.equal(parseGalleryConfig({ config: { mode: 'media', items: [] } }).config?.layout, 'single');
});

test('media batches slugs through the media owner, keeps found canonical metadata, omits unknown and accepts video/audio', async () => {
  const refs = scanHtmlEmbeds({ html: `<div data-embed-config='{"type":"media","content":{"items":[{"slug":"photo"},{"slug":"missing"},{"slug":"audio"}],"layout":"grid"}}'></div>` });
  const calls: string[][] = [];
  const issues: string[] = [];
  const results = await resolveGalleryEmbeds({ refs, resolveMedia: async ({ refs: media }) => {
    calls.push(media.map(ref => ref.slug ?? ref.id!));
    return new Map<string, WidgetRenderIR>([['photo', { componentId: 'media-image', props: { assetId: 'canonical', slug: 'photo', alt: 'Stored' } }], ['audio', { componentId: 'media-image', props: { assetId: 'sound-id', slug: 'audio', contentType: 'audio/mpeg' } }]]);
  } }, { reportIssue: ({ messages }) => issues.push(...messages) });
  assert.deepEqual(calls, [['photo', 'missing', 'audio']]);
  const result = [...results.values()][0]!;
  assert.equal(result.componentId, 'media');
  assert.equal((result.props.media as Record<string, Record<string, unknown>>).photo!.assetId, 'canonical');
  assert.ok(!Object.hasOwn(result.props.media as object, 'missing'));
  assert.ok(issues.some(issue => issue.includes('missing')));
});

test('reference extraction sees slug items, raw tokens, data-media-slug and partial placement content despite invalid layout', () => {
  const config = { layout: 'invalid', items: [{ slug: 'one' }, { slug: 'two' }], html: '<img data-media-slug="three"><audio src="{{media:four}}"></audio>', content: { items: [{ slug: 'five' }] } };
  assert.deepEqual(galleryMediaReferences({ config }).map(ref => ref.mediaId), ['one', 'two', 'four', 'three', 'five']);
});

test('same widget markers with different content receive distinct occurrence lookup keys', () => {
  const refs = scanHtmlEmbeds({ html: `<div data-embed-config='{"type":"widget","slug":"photos","content":{"items":[{"slug":"one"}]}}'></div><div data-embed-config='{"type":"widget","slug":"photos","content":{"items":[{"slug":"two"}]}}'></div>` });
  assert.notEqual(refs[0]!.placementKey, refs[1]!.placementKey);
  assert.deepEqual(refs[0]!.config?.content, { items: [{ slug: 'one' }] });
});

test('raw references use the marker entity-decoding policy used by browser attributes', () => {
  assert.deepEqual(galleryMediaReferences({ config: { html: '<img data-media-slug="ph&#111;to"><img src="{{media:photo&#45;two}}">' } }).map(ref => ref.mediaId), ['photo-two', 'photo']);
});
