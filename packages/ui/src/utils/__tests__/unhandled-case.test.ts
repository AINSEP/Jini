// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { unhandledCase } from '../unhandled-case.js';

type Shape = { kind: 'circle' } | { kind: 'square' };

/** An exhaustive switch closed the way production code closes one. */
function area(shape: Shape): number {
  switch (shape.kind) {
    case 'circle':
      return 3;
    case 'square':
      return 4;
  }
  return unhandledCase({ _value: shape });
}

describe('unhandledCase', () => {
  it('yields undefined for a value outside the declared union, exactly like falling off the switch', () => {
    const fromWire: Shape = JSON.parse('{"kind":"hexagon"}');
    expect(area(fromWire)).toBeUndefined();
    expect(area({ kind: 'square' })).toBe(4);
  });
});
