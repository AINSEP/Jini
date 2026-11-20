// `renderMarkdown` is a scoped-down GFM Markdown -> safe HTML renderer for a
// saved memory entry's preview body, built on `micromark` with no
// `allowDangerousHtml`. These pin plain text, basic GFM constructs (bold,
// italic, list items), and the XSS-safety property the component's doc
// comment claims: raw HTML in the input is neutralized, not executed.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../react/render-markdown.js';

describe('renderMarkdown', () => {
  it('renders plain text', () => {
    const { container } = render(renderMarkdown('just plain text'));
    expect(container.textContent).toContain('just plain text');
    expect(container.querySelector('.jini-memory-markdown-body')).not.toBeNull();
  });

  it('renders bold text as a <strong> element', () => {
    const { container } = render(renderMarkdown('Hello **world**'));
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('world');
  });

  it('renders italic text as an <em> element', () => {
    const { container } = render(renderMarkdown('This is *emphasized* text'));
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe('emphasized');
  });

  it('renders a GFM list item as an <li> inside a <ul>', () => {
    const { container } = render(renderMarkdown('- first item\n- second item'));
    const items = container.querySelectorAll('ul li');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe('first item');
    expect(items[1]?.textContent).toBe('second item');
  });

  it('does not execute a raw <script> tag embedded in the markdown source', () => {
    const { container } = render(renderMarkdown('before <script>window.__pwned = true;</script> after'));
    // micromark escapes raw HTML by default (no `allowDangerousHtml`), so no
    // live <script> element is ever created from the input.
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    // The tag text shows up as inert, escaped text content instead of markup.
    expect(container.textContent).toContain('<script>');
  });

  it('does not turn a raw <img onerror=...> into a live, event-wired element', () => {
    const { container } = render(renderMarkdown('<img src="x" onerror="window.__pwned = true">'));
    const img = container.querySelector('img');
    // No live <img> element is created from raw HTML in the source, so there
    // is no element to carry a wired onerror handler.
    expect(img).toBeNull();
    expect(container.textContent).toContain('onerror');
  });
});
