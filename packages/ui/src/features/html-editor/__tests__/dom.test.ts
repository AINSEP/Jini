import { describe, expect, it } from 'vitest';
import { hasAttributeOnAnyNodeShape, sourceElementAttributeView } from '../dom.js';

/** GrapesJS's headless re-parse hands `isComponent` a plain parsed node with no `.hasAttribute`. */
function parsedNode(attributes?: Record<string, unknown>): Element {
  return { tagName: 'DIV', ...(attributes ? { attributes } : {}) } as unknown as Element;
}

describe('hasAttributeOnAnyNodeShape', () => {
  it('answers through a real DOM element\'s own hasAttribute', () => {
    const el = document.createElement('div');
    el.setAttribute('data-protected', '');
    expect(hasAttributeOnAnyNodeShape(el, 'data-protected')).toBe(true);
    expect(hasAttributeOnAnyNodeShape(el, 'data-other')).toBe(false);
  });

  it('reads a GrapesJS parsed node\'s plain attributes object without throwing', () => {
    const node = parsedNode({ 'data-protected': '' });
    expect(() => hasAttributeOnAnyNodeShape(node, 'data-protected')).not.toThrow();
    expect(hasAttributeOnAnyNodeShape(node, 'data-protected')).toBe(true);
    expect(hasAttributeOnAnyNodeShape(node, 'data-other')).toBe(false);
  });

  it('only counts own attribute keys, never inherited object properties', () => {
    expect(hasAttributeOnAnyNodeShape(parsedNode({}), 'toString')).toBe(false);
  });

  it('treats a parsed node with no attributes object as having none', () => {
    expect(hasAttributeOnAnyNodeShape(parsedNode(), 'data-protected')).toBe(false);
  });

  it('works over the DOM-free source attribute view as well', () => {
    const view = sourceElementAttributeView({ tagName: 'section', attributes: { 'data-protected': '' } });
    expect(hasAttributeOnAnyNodeShape(view, 'data-protected')).toBe(true);
    expect(view.tagName).toBe('SECTION');
    expect(view.getAttribute('DATA-PROTECTED')).toBe('');
    expect(view.getAttribute('data-missing')).toBeNull();
  });
});
