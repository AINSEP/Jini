import { describe, expect, it } from 'vitest';
import { hasAttributeOnAnyNodeShape } from '../node-shape.js';

/** GrapesJS's headless re-parse hands `isComponent` a plain parsed node with no `.hasAttribute`. */
function parsedNode(attributes?: Record<string, unknown>) {
  return { tagName: 'DIV', ...(attributes ? { attributes } : {}) };
}

describe('hasAttributeOnAnyNodeShape', () => {
  it('answers through the node\'s own hasAttribute when it has one', () => {
    const el = { hasAttribute: (name: string) => name === 'data-protected' };
    expect(hasAttributeOnAnyNodeShape(el, 'data-protected')).toBe(true);
    expect(hasAttributeOnAnyNodeShape(el, 'data-other')).toBe(false);
  });

  it('reads a parsed node\'s plain attributes object without throwing', () => {
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

  it('treats a null attributes value as having none', () => {
    expect(hasAttributeOnAnyNodeShape({ attributes: null }, 'data-protected')).toBe(false);
  });
});
