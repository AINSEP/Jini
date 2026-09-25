import { describe, expect, it } from 'vitest';

import { describeEmbedPlaceholder } from '../../components/InteractiveHtmlEditor/InteractiveHtmlEditor.js';

/**
 * @file `describeEmbedPlaceholder` is the consuming product's half of the Interactive tab's "explicit
 * placeholder card" feature (owner ask, 2026-08-24): it recognizes that product's `data-embed-config`
 * embed marker convention (its own `src/core/embeds/marker.ts`) on a live canvas element and turns it into the
 * label `@jini-ai/ui/html-editor`'s generic `applyCanvasEmbedPlaceholders` renders — that generic
 * primitive has zero knowledge of what an embed marker is, by design (see its own file header), so
 * this function is where the actual convention (attribute name, JSON shape, per-type friendly names)
 * lives, and is exported specifically for direct unit-testability without mounting GrapesJS at all —
 * same convention `isProtectedEmbedElement` beside it already documents.
 */

describe('describeEmbedPlaceholder', () => {
  it('returns undefined for an element with no data-embed-config at all', () => {
    const el = document.createElement('div');
    expect(describeEmbedPlaceholder(el)).toBeUndefined();
  });

  it('returns undefined when data-embed-config is not valid JSON — degrades quietly, same contract every render-time consumer of this marker uses', () => {
    const el = document.createElement('div');
    el.setAttribute('data-embed-config', '{not json');
    expect(describeEmbedPlaceholder(el)).toBeUndefined();
  });

  it('returns undefined when data-embed-config parses but is not an object', () => {
    const el = document.createElement('div');
    el.setAttribute('data-embed-config', '"just a string"');
    expect(describeEmbedPlaceholder(el)).toBeUndefined();
  });

  it('returns undefined when the config object has no type', () => {
    const el = document.createElement('div');
    el.setAttribute('data-embed-config', '{"id":"abc"}');
    expect(describeEmbedPlaceholder(el)).toBeUndefined();
  });

  it('labels a media marker with its friendly kind and a truncated id when no name is set', () => {
    const el = document.createElement('div');
    el.setAttribute('data-embed-config', '{"type":"media","id":"5da45f84-1803-4493-bfd6-ee08bd1dba2c"}');
    expect(describeEmbedPlaceholder(el)).toEqual({ kindLabel: 'Media', identityLabel: 'id 5da45f84…' });
  });

  it('prefers name over id when the marker config carries one', () => {
    const el = document.createElement('div');
    el.setAttribute('data-embed-config', '{"type":"widget","id":"w-1","name":"newsletter-signup"}');
    expect(describeEmbedPlaceholder(el)).toEqual({ kindLabel: 'Widget', identityLabel: 'newsletter-signup' });
  });

  it('shows "no id set" when neither name nor id is present', () => {
    const el = document.createElement('div');
    el.setAttribute('data-embed-config', '{"type":"content"}');
    expect(describeEmbedPlaceholder(el)).toEqual({ kindLabel: 'Content', identityLabel: 'no id set' });
  });

  it('does not truncate a short id', () => {
    const el = document.createElement('div');
    el.setAttribute('data-embed-config', '{"type":"post","id":"p1"}');
    expect(describeEmbedPlaceholder(el)).toEqual({ kindLabel: 'Post', identityLabel: 'id p1' });
  });

  // The complete set `isPageEmbedType` (the consuming product's `src/server/http/site/render.ts:1238`'s
  // `renderHtmlPageBody`) accepts — the only four types a Page's `body_html` can actually contain, so
  // the only four an operator can realistically hit in this editor. Owner-confirmed authoritative,
  // 2026-08-25.
  it.each([
    ['media', 'Media'],
    ['widget', 'Widget'],
    ['post', 'Post'],
    ['content', 'Content'],
  ])('labels the page-body-reachable type %s as %s', (type, expected) => {
    const el = document.createElement('div');
    el.setAttribute('data-embed-config', JSON.stringify({ type, id: 'x' }));
    expect(describeEmbedPlaceholder(el)?.kindLabel).toBe(expected);
  });

  // NOT reachable inside a Page body (they live in theme templates — header/nav/footer — authored
  // outside this editor) but still labeled with a real word rather than left to the generic fallback,
  // purely as a defensive case — see `EMBED_KIND_LABELS`'s own doc.
  it.each([
    ['partial', 'Partial'],
    ['menu', 'Menu'],
  ])('labels the theme-only type %s as %s, defensively, even though it cannot appear in a Page body today', (type, expected) => {
    const el = document.createElement('div');
    el.setAttribute('data-embed-config', JSON.stringify({ type, id: 'x' }));
    expect(describeEmbedPlaceholder(el)?.kindLabel).toBe(expected);
  });

  // `media` resolves to either an `<img>` or a `<video>` tag server-side, but that distinction is not
  // present in the marker's own `data-embed-config` (no mime/kind hint), and telling them apart here
  // would require either a new server endpoint or guessing from the id string — both explicitly ruled
  // out (owner ask, 2026-08-25). One label covers both, regardless of anything in `id`/`name` that
  // might look image- or video-flavored to a human reader.
  it('labels every media marker "Media" regardless of whether the asset is an image or a video — one type, one label, by design', () => {
    const imageish = document.createElement('div');
    imageish.setAttribute('data-embed-config', '{"type":"media","id":"hero-photo.jpg"}');
    const videoish = document.createElement('div');
    videoish.setAttribute('data-embed-config', '{"type":"media","id":"5da45f84-1803-4493-bfd6-ee08bd1dba2c"}');

    expect(describeEmbedPlaceholder(imageish)?.kindLabel).toBe('Media');
    expect(describeEmbedPlaceholder(videoish)?.kindLabel).toBe('Media');
  });

  it('title-cases an unrecognized future type rather than dropping it — the marker scanner treats type as a free string', () => {
    const el = document.createElement('div');
    el.setAttribute('data-embed-config', '{"type":"gallery","id":"g1"}');
    expect(describeEmbedPlaceholder(el)?.kindLabel).toBe('Gallery');
  });

  // The exact case the owner's follow-up question was about: a marketplace theme (or any future
  // change) introducing a type this table has never seen must still show SOMETHING explicit, never
  // throw, and never silently render nothing — silently rendering nothing is the original bug.
  it('never throws for a completely unrecognized type and still returns a full, renderable descriptor', () => {
    const el = document.createElement('div');
    el.setAttribute('data-embed-config', '{"type":"some-future-marketplace-type","id":"x1"}');
    expect(() => describeEmbedPlaceholder(el)).not.toThrow();
    expect(describeEmbedPlaceholder(el)).toEqual({
      kindLabel: 'Some-future-marketplace-type',
      identityLabel: 'id x1',
    });
  });

  it('matches type case-insensitively, same as the server-side scanner', () => {
    const el = document.createElement('div');
    el.setAttribute('data-embed-config', '{"type":"Media","id":"m1"}');
    expect(describeEmbedPlaceholder(el)?.kindLabel).toBe('Media');
  });
});
