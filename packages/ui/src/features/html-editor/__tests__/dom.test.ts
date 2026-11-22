import { describe, expect, it } from 'vitest';
import { hasAttributeOnAnyNodeShape } from '@jini-ai/core/primitives';
import { sourceElementAttributeView } from '../dom.js';

describe('hasAttributeOnAnyNodeShape', () => {
  it('works over the DOM-free source attribute view as well', () => {
    const view = sourceElementAttributeView({ tagName: 'section', attributes: { 'data-protected': '' } });
    expect(hasAttributeOnAnyNodeShape({ node: view, attribute: 'data-protected' })).toBe(true);
    expect(view.tagName).toBe('SECTION');
    expect(view.getAttribute('DATA-PROTECTED')).toBe('');
    expect(view.getAttribute('data-missing')).toBeNull();
  });
});
