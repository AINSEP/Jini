import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyCanvasEmbedPlaceholders, type CanvasEmbedPlaceholderDescriptor } from '../canvas-embed-placeholders.js';

/**
 * @file `applyCanvasEmbedPlaceholders` is what makes the Interactive tab show something explicit where
 * an unresolved embed marker sits, instead of an empty, unlabeled div an operator could delete without
 * noticing — see that function's own file header for the full "why a card, why wrapped rather than
 * written into" reasoning.
 *
 * These tests use a plain detached `<body>`, not a real GrapesJS instance or iframe — the function only
 * ever touches the `HTMLElement` it's handed, the same reasoning `canvas-content-wrapper.test.ts` gives
 * for testing its own sibling function the same way. `useInteractiveHtmlEditor.test.tsx` covers the
 * OTHER half of the export-safety claim: that this function is wired to run against the LIVE canvas
 * after `load`, never through `grapesjs.init`'s `components` string — which is the actual reason
 * anything built here can never leak into a saved document, independent of what this function does to
 * the DOM it's handed.
 */

function bodyWith(html: string): HTMLBodyElement {
  const body = document.createElement('body');
  body.innerHTML = html;
  return body;
}

/** A `describe` that only recognizes elements carrying `data-marker`, mirroring how a real host
 *  recognizes `data-embed-config` — kept deliberately simpler than the real host product's convention since this
 *  suite is about the DOM mechanics, not marker-config parsing (that belongs to
 *  `InteractiveHtmlEditor.test.tsx` in `@jini-ai/admin`). */
function describeMarked(el: Element): CanvasEmbedPlaceholderDescriptor | undefined {
  const kind = el.getAttribute('data-marker');
  return kind ? { kindLabel: kind, identityLabel: `id ${el.getAttribute('data-id') ?? 'none'}` } : undefined;
}

describe('applyCanvasEmbedPlaceholders', () => {
  it('does nothing when describe recognizes nothing in the body', () => {
    const body = bodyWith('<p>hello</p>');
    applyCanvasEmbedPlaceholders(body, describeMarked);
    expect(body.innerHTML).toBe('<p>hello</p>');
  });

  it('leaves an unmatched sibling element completely untouched', () => {
    const body = bodyWith('<p id="untouched">hello</p><div data-marker="media" data-id="m1"></div>');
    applyCanvasEmbedPlaceholders(body, describeMarked);
    expect(body.querySelector('#untouched')?.outerHTML).toBe('<p id="untouched">hello</p>');
  });

  it('wraps a matched marker in a card carrying the descriptor rather than leaving it bare', () => {
    const body = bodyWith('<div data-marker="Media" data-id="m1"></div>');
    applyCanvasEmbedPlaceholders(body, describeMarked);

    const card = body.querySelector('[data-tovu-embed-placeholder-root]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('Placeholder — Media');
    expect(card!.textContent).toContain('id m1');
  });

  it('never touches the marker\'s own attributes or content — only relocates it', () => {
    const body = bodyWith('<div data-marker="widget" data-id="w1" data-embed-config=\'{"type":"widget"}\'>fallback</div>');
    const before = body.querySelector('[data-marker]')!.outerHTML;

    applyCanvasEmbedPlaceholders(body, describeMarked);

    const marker = body.querySelector('[data-marker]')!;
    // Byte-identical to before decoration: same tag, same attributes (including the JSON config an
    // export would care about), same inner content — this function adds nothing to the marker itself,
    // which is the property that makes it safe regardless of what a later GrapesJS re-parse ever sees.
    expect(marker.outerHTML).toBe(before);
  });

  it('moves the SAME node object rather than cloning it, preserving identity', () => {
    const body = bodyWith('<div data-marker="media" data-id="m1" id="x"></div>');
    const original = body.querySelector('#x');

    applyCanvasEmbedPlaceholders(body, describeMarked);

    const afterMove = body.querySelector('#x');
    expect(afterMove).toBe(original);
  });

  it('inserts the card in the marker\'s original position, with the marker nested inside it', () => {
    const body = bodyWith('<p>before</p><div data-marker="post" data-id="p1"></div><p>after</p>');
    applyCanvasEmbedPlaceholders(body, describeMarked);

    const children = Array.from(body.children);
    expect(children.map((c) => c.tagName)).toEqual(['P', 'DIV', 'P']);
    expect(children[1]!.hasAttribute('data-tovu-embed-placeholder-root')).toBe(true);
    expect(children[1]!.querySelector('[data-marker]')).not.toBeNull();
  });

  it('carries the marker\'s own inline style onto the card so an authored box constraint is respected', () => {
    const body = bodyWith('<div data-marker="media" data-id="m1" style="max-width: 600px;"></div>');
    applyCanvasEmbedPlaceholders(body, describeMarked);

    const card = body.querySelector('[data-tovu-embed-placeholder-root]')!;
    expect(card.getAttribute('style')).toContain('max-width: 600px');
    // The card's own chrome still applies too — the authored style doesn't blot it out.
    expect(card.getAttribute('style')).toContain('border:2px dashed');
  });

  it('does not require a style attribute on the marker at all', () => {
    const body = bodyWith('<div data-marker="media" data-id="m1"></div>');
    applyCanvasEmbedPlaceholders(body, describeMarked);

    const card = body.querySelector('[data-tovu-embed-placeholder-root]')!;
    expect(card.getAttribute('style')).not.toMatch(/^;/);
    expect(card.getAttribute('style')).toContain('border:2px dashed');
  });

  // GrapesJS never actually leaves an authored `style="max-width:600px"` as a literal attribute on the
  // live canvas element — confirmed live in a real browser (`ADS-memory` report for this feature): its
  // own parser converts it into a scoped CSS rule (`#<componentId>{max-width:600px}`) in a canvas
  // `<style>` tag instead, so `el.getAttribute('style')` alone is a no-op for every REAL marker despite
  // working in this suite's own plain-attribute tests above. `document.body` (attached, not a detached
  // `bodyWith(...)` element) is used here specifically so jsdom's `getComputedStyle` resolves the CSS
  // rule the same way a real canvas iframe's would — the mechanism this second, complementary path
  // depends on.
  describe('respecting a computed (not just literal-attribute) box constraint', () => {
    afterEach(() => {
      document.body.innerHTML = '';
      document.head.querySelectorAll('style[data-test-only]').forEach((el) => el.remove());
    });

    it('carries a max-width the marker only has via a CSS rule (no literal style attribute) onto the card', () => {
      const style = document.createElement('style');
      style.setAttribute('data-test-only', '');
      style.textContent = '#ruled-marker { max-width: 480px; }';
      document.head.appendChild(style);
      document.body.innerHTML = '<div id="ruled-marker" data-marker="media" data-id="m1"></div>';

      applyCanvasEmbedPlaceholders(document.body, describeMarked);

      const card = document.body.querySelector('[data-tovu-embed-placeholder-root]') as HTMLElement;
      expect(card.style.maxWidth).toBe('480px');
      expect(card.hasAttribute('style')).toBe(true); // Still carries the card's own base chrome too.
    });

    it('does not add a max-width when the marker resolves to none', () => {
      document.body.innerHTML = '<div data-marker="media" data-id="m1"></div>';

      applyCanvasEmbedPlaceholders(document.body, describeMarked);

      const card = document.body.querySelector('[data-tovu-embed-placeholder-root]') as HTMLElement;
      expect(card.style.maxWidth).toBe('');
    });
  });

  it('decorates multiple independent markers in one pass, each with its own descriptor', () => {
    const body = bodyWith(
      '<div data-marker="media" data-id="m1"></div><div data-marker="widget" data-id="w1"></div>'
    );
    applyCanvasEmbedPlaceholders(body, describeMarked);

    const cards = body.querySelectorAll('[data-tovu-embed-placeholder-root]');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('Placeholder — media');
    expect(cards[0]!.textContent).toContain('id m1');
    expect(cards[1]!.textContent).toContain('Placeholder — widget');
    expect(cards[1]!.textContent).toContain('id w1');
  });

  it('is idempotent: a second call does not nest a second card around an already-decorated marker', () => {
    const body = bodyWith('<div data-marker="media" data-id="m1"></div>');
    applyCanvasEmbedPlaceholders(body, describeMarked);
    applyCanvasEmbedPlaceholders(body, describeMarked);

    expect(body.querySelectorAll('[data-tovu-embed-placeholder-root]')).toHaveLength(1);
    expect(body.querySelectorAll('[data-marker]')).toHaveLength(1);
  });

  it('does not call describe again for an element already inside a placeholder card on a later pass', () => {
    const body = bodyWith('<div data-marker="media" data-id="m1"></div>');
    const spy = vi.fn(describeMarked);
    applyCanvasEmbedPlaceholders(body, spy);
    const callsAfterFirstPass = spy.mock.calls.length;
    spy.mockClear();

    applyCanvasEmbedPlaceholders(body, spy);

    // The card's own children (icon, heading, identity, note) ARE walked by the second pass's
    // `querySelectorAll('*')`, but every one of them — including the relocated marker itself — sits
    // under `[data-tovu-embed-placeholder-root]` by then, so the re-entrancy guard skips them before
    // `describe` is ever called on any of them.
    expect(spy).not.toHaveBeenCalled();
    expect(callsAfterFirstPass).toBeGreaterThan(0);
  });

  it('escapes descriptor text safely — a label containing markup-like characters renders as text, not HTML', () => {
    const body = bodyWith('<div data-marker="&lt;script&gt;" data-id="m1"></div>');
    applyCanvasEmbedPlaceholders(body, describeMarked);

    const card = body.querySelector('[data-tovu-embed-placeholder-root]')!;
    expect(card.querySelector('script')).toBeNull();
    expect(card.textContent).toContain('Placeholder — <script>');
  });
});

// Embed protection (2026-09-23, Lane A): a click on the card must land on the MARKER element, so the
// editor selects the embed itself rather than whatever block wraps it (which Delete would then remove
// together with the embed). The card makes the marker a transparent overlay over its own box, and a
// later pass repairs cards a structural edit (delete, move, clone, undo) left stale.
describe('applyCanvasEmbedPlaceholders — the marker is the card\'s clickable surface', () => {
  const OVERLAY_STYLE = 'style[data-tovu-embed-placeholder-style]';

  afterEach(() => {
    document.head.querySelectorAll(OVERLAY_STYLE).forEach((el) => el.remove());
  });

  it('flags every card-owned child as chrome, leaving the marker the one unflagged child', () => {
    const body = bodyWith('<div data-marker="media" data-id="m1"></div>');
    applyCanvasEmbedPlaceholders(body, describeMarked);

    const card = body.querySelector('[data-tovu-embed-placeholder-root]')!;
    const unflagged = Array.from(card.children).filter((c) => !c.hasAttribute('data-tovu-embed-placeholder-chrome'));
    expect(unflagged).toEqual([body.querySelector('[data-marker]')]);
    expect(card.getAttribute('style')).toContain('position:relative');
  });

  it('adds one overlay rule to the canvas document head, however many passes run', () => {
    const body = bodyWith('<div data-marker="media" data-id="m1"></div>');
    applyCanvasEmbedPlaceholders(body, describeMarked);
    applyCanvasEmbedPlaceholders(body, describeMarked);

    const styles = document.head.querySelectorAll(OVERLAY_STYLE);
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(
      '[data-tovu-embed-placeholder-root] > :not([data-tovu-embed-placeholder-chrome])' +
        ' { position: absolute !important; inset: 0 !important; margin: 0 !important; width: auto !important;' +
        ' height: auto !important; min-width: 0 !important; max-width: none !important; min-height: 0 !important;' +
        ' display: block !important; background: transparent !important; }'
    );
  });

  it('does not add the overlay rule when no marker was decorated', () => {
    applyCanvasEmbedPlaceholders(bodyWith('<p>hello</p>'), describeMarked);
    expect(document.head.querySelectorAll(OVERLAY_STYLE)).toHaveLength(0);
  });

  it('removes a card whose marker is gone (the embed was deleted), so no ghost card stays behind', () => {
    const body = bodyWith('<p>before</p><div data-marker="media" data-id="m1"></div>');
    applyCanvasEmbedPlaceholders(body, describeMarked);
    body.querySelector('[data-marker]')!.remove();

    applyCanvasEmbedPlaceholders(body, describeMarked);

    expect(body.innerHTML).toBe('<p>before</p>');
  });

  it('re-wraps a marker moved out of its card, and drops the card it left', () => {
    const body = bodyWith('<div data-marker="media" data-id="m1"></div><p>after</p>');
    applyCanvasEmbedPlaceholders(body, describeMarked);
    const marker = body.querySelector('[data-marker]')!;
    body.appendChild(marker);

    applyCanvasEmbedPlaceholders(body, describeMarked);

    const cards = body.querySelectorAll('[data-tovu-embed-placeholder-root]');
    expect(cards).toHaveLength(1);
    expect(marker.parentElement).toBe(cards[0]);
    expect(Array.from(body.children).map((c) => c.tagName)).toEqual(['P', 'DIV']);
  });
});
