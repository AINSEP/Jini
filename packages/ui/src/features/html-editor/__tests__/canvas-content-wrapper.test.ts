import { describe, expect, it } from 'vitest';

import { applyCanvasContentWrapper } from '../canvas-content-wrapper.js';
import type { CanvasContentWrapperNode } from '../canvas-style.js';

/**
 * @file `applyCanvasContentWrapper` is the piece that makes the Interactive tab's canvas match a
 * published page's real layout (centered, padded content instead of full-bleed) — see
 * `canvas-content-wrapper.ts`'s own file header for why it operates on live canvas DOM rather than
 * folding the wrapper into GrapesJS's `components` config.
 *
 * These tests use a plain detached `<body>` element, not a real GrapesJS instance or iframe — the
 * function only ever touches the `HTMLElement` it's handed, so a real canvas is not required to prove
 * its DOM behavior. `useInteractiveHtmlEditor.test.ts` covers the OTHER half of the export-safety
 * claim: that this function is wired to run against the LIVE canvas after mount, never through
 * `grapesjs.init`'s `components` string.
 */

function bodyWith(childrenHtml: string): HTMLBodyElement {
  const body = document.createElement('body');
  body.innerHTML = childrenHtml;
  return body;
}

describe('applyCanvasContentWrapper', () => {
  it('does nothing when no chain is supplied', () => {
    const body = bodyWith('<p>hello</p>');
    applyCanvasContentWrapper(body, undefined);
    expect(body.innerHTML).toBe('<p>hello</p>');
  });

  it('does nothing for an empty chain', () => {
    const body = bodyWith('<p>hello</p>');
    applyCanvasContentWrapper(body, []);
    expect(body.innerHTML).toBe('<p>hello</p>');
  });

  it('wraps existing content in a single-level chain, applying its attributes', () => {
    const body = bodyWith('<p>hello</p>');
    const chain: CanvasContentWrapperNode[] = [{ tagName: 'article', attributes: { class: 'post-detail wrap' } }];
    applyCanvasContentWrapper(body, chain);

    const article = body.querySelector('article');
    expect(article).not.toBeNull();
    expect(article?.getAttribute('class')).toBe('post-detail wrap');
    expect(article?.innerHTML).toBe('<p>hello</p>');
    expect(body.children).toHaveLength(1);
  });

  it('nests a multi-level chain outermost-first, mirroring the real template ancestor order', () => {
    const body = bodyWith('<p>hello</p>');
    const chain: CanvasContentWrapperNode[] = [
      { tagName: 'main' },
      { tagName: 'article', attributes: { class: 'post-detail wrap', 'data-reveal': '' } },
    ];
    applyCanvasContentWrapper(body, chain);

    expect(body.children).toHaveLength(1);
    const main = body.firstElementChild!;
    expect(main.tagName).toBe('MAIN');
    expect(main.children).toHaveLength(1);
    const article = main.firstElementChild!;
    expect(article.tagName).toBe('ARTICLE');
    expect(article.getAttribute('class')).toBe('post-detail wrap');
    // An attribute with an empty-string value (the theme's own `data-reveal` boolean-style attribute)
    // round-trips as a present, valued attribute, not a dropped one.
    expect(article.hasAttribute('data-reveal')).toBe(true);
    expect(article.innerHTML).toBe('<p>hello</p>');
  });

  it('moves the SAME node objects rather than cloning them, preserving identity', () => {
    const body = bodyWith('<p id="x">hello</p>');
    const originalP = body.querySelector('#x');
    applyCanvasContentWrapper(body, [{ tagName: 'main' }]);

    const movedP = body.querySelector('#x');
    expect(movedP).toBe(originalP);
  });

  it('preserves the original order of multiple children inside the innermost wrapper', () => {
    const body = bodyWith('<h1>Title</h1><p>One</p><p>Two</p>');
    applyCanvasContentWrapper(body, [{ tagName: 'article' }]);

    const article = body.querySelector('article')!;
    expect(Array.from(article.children).map((el) => el.tagName)).toEqual(['H1', 'P', 'P']);
    expect(Array.from(article.children).map((el) => el.textContent)).toEqual(['Title', 'One', 'Two']);
  });

  it('wraps an empty body into an empty (but present) chain structure', () => {
    const body = bodyWith('');
    applyCanvasContentWrapper(body, [{ tagName: 'main' }, { tagName: 'article' }]);

    expect(body.querySelector('main article')).not.toBeNull();
    expect(body.querySelector('article')?.innerHTML).toBe('');
  });

  it('is idempotent: a second call against an already-wrapped body does not nest a second copy', () => {
    const body = bodyWith('<p>hello</p>');
    const chain: CanvasContentWrapperNode[] = [{ tagName: 'main' }, { tagName: 'article' }];
    applyCanvasContentWrapper(body, chain);
    applyCanvasContentWrapper(body, chain);

    expect(body.querySelectorAll('main')).toHaveLength(1);
    expect(body.querySelectorAll('article')).toHaveLength(1);
    expect(body.querySelector('article')?.innerHTML).toBe('<p>hello</p>');
  });

  it('moves non-element nodes (e.g. bare text) too, not just elements', () => {
    const body = bodyWith('<p>one</p>loose text');
    applyCanvasContentWrapper(body, [{ tagName: 'main' }]);

    const main = body.querySelector('main')!;
    expect(main.textContent).toBe('oneloose text');
    expect(body.childNodes).toHaveLength(1);
  });
});
