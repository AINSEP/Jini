import { describe, expect, it } from 'vitest';
import { hasAttributeOnAnyNodeShape } from '../node-shape.js';

/** GrapesJS's headless re-parse hands `isComponent` a plain parsed node with no `.hasAttribute`. */
function parsedNode(attributes?: Record<string, unknown>) {
  return { tagName: 'DIV', ...(attributes ? { attributes } : {}) };
}

describe('hasAttributeOnAnyNodeShape', () => {
  it('answers through the node\'s own hasAttribute when it has one', () => {
    const el = { hasAttribute: (name: string) => name === 'data-protected' };
    expect(hasAttributeOnAnyNodeShape({ node: el, attribute: 'data-protected' })).toBe(true);
    expect(hasAttributeOnAnyNodeShape({ node: el, attribute: 'data-other' })).toBe(false);
  });

  it('reads a parsed node\'s plain attributes object without throwing', () => {
    const node = parsedNode({ 'data-protected': '' });
    expect(() => hasAttributeOnAnyNodeShape({ node: node, attribute: 'data-protected' })).not.toThrow();
    expect(hasAttributeOnAnyNodeShape({ node: node, attribute: 'data-protected' })).toBe(true);
    expect(hasAttributeOnAnyNodeShape({ node: node, attribute: 'data-other' })).toBe(false);
  });

  it('only counts own attribute keys, never inherited object properties', () => {
    expect(hasAttributeOnAnyNodeShape({ node: parsedNode({}), attribute: 'toString' })).toBe(false);
  });

  it('treats a parsed node with no attributes object as having none', () => {
    expect(hasAttributeOnAnyNodeShape({ node: parsedNode(), attribute: 'data-protected' })).toBe(false);
  });

  it('treats a null attributes value as having none', () => {
    expect(hasAttributeOnAnyNodeShape({ node: { attributes: null }, attribute: 'data-protected' })).toBe(false);
  });
});
