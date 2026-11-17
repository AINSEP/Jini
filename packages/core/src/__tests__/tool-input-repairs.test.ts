import { describe, expect, it } from 'vitest';
import { clampDeclaredBounds, assertRepairKeywords } from '../tool-input-repairs.js';

const LIMIT = { type: 'integer', minimum: 1, maximum: 8000, clamp: true };
const schemaOf = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties });

describe('clampDeclaredBounds', () => {
  it('lowers a number above its declared maximum, with a note that never carries the caller\'s value', () => {
    const result = clampDeclaredBounds({ input: { limit: 8300 }, inputSchema: schemaOf({ limit: LIMIT }) });
    expect(result).toEqual({ input: { limit: 8000 }, notes: ['limit was lowered to its maximum, 8000'] });
    expect(result.notes.join(' ')).not.toContain('8300');
  });

  it('raises a number below its declared minimum', () => {
    expect(clampDeclaredBounds({ input: { limit: 0 }, inputSchema: schemaOf({ limit: LIMIT }) }))
      .toEqual({ input: { limit: 1 }, notes: ['limit was raised to its minimum, 1'] });
  });

  it('leaves a value inside its bounds alone, with no note', () => {
    expect(clampDeclaredBounds({ input: { limit: 50 }, inputSchema: schemaOf({ limit: LIMIT }) })).toEqual({ input: { limit: 50 }, notes: [] });
  });

  it('does not clamp unless the property opts in', () => {
    const noOptIn = { type: 'integer', minimum: 1, maximum: 8000 };
    expect(clampDeclaredBounds({ input: { limit: 8300 }, inputSchema: schemaOf({ limit: noOptIn }) })).toEqual({ input: { limit: 8300 }, notes: [] });
    expect(clampDeclaredBounds({ input: { limit: 8300 }, inputSchema: schemaOf({ limit: { ...noOptIn, clamp: false } }) })).toEqual({ input: { limit: 8300 }, notes: [] });
  });

  it('ignores clamp on a non-numeric property or one without a bound', () => {
    const schema = schemaOf({ name: { type: 'string', clamp: true, maximum: 3 }, size: { type: 'integer', clamp: true } });
    expect(clampDeclaredBounds({ input: { name: 'abcdef', size: 99 }, inputSchema: schema })).toEqual({ input: { name: 'abcdef', size: 99 }, notes: [] });
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, '8300', null])('leaves %j for an integer property untouched (refused as today, never clamped)', value => {
    const result = clampDeclaredBounds({ input: { limit: value }, inputSchema: schemaOf({ limit: LIMIT }) });
    expect(result.input).toEqual({ limit: value });
    expect(result.notes).toEqual([]);
  });

  it('clamps a number property to a fractional bound and an integer property above only a maximum', () => {
    expect(clampDeclaredBounds({ input: { ratio: 1.7 }, inputSchema: schemaOf({ ratio: { type: 'number', maximum: 1.5, clamp: true } }) }))
      .toEqual({ input: { ratio: 1.5 }, notes: ['ratio was lowered to its maximum, 1.5'] });
    expect(clampDeclaredBounds({ input: { size: 9 }, inputSchema: schemaOf({ size: { type: 'integer', maximum: 5, clamp: true } }) }))
      .toEqual({ input: { size: 5 }, notes: ['size was lowered to its maximum, 5'] });
  });

  it('reaches nested object properties by their dotted path and never mutates the caller\'s input', () => {
    const input = { page: { size: 900 }, other: 1 };
    const schema = schemaOf({ page: schemaOf({ size: { type: 'integer', maximum: 100, clamp: true } }), other: { type: 'integer' } });
    const result = clampDeclaredBounds({ input, inputSchema: schema });
    expect(result).toEqual({ input: { page: { size: 100 }, other: 1 }, notes: ['page.size was lowered to its maximum, 100'] });
    expect(input).toEqual({ page: { size: 900 }, other: 1 });
  });

  it('stops descending past six levels of nesting', () => {
    let schema: Record<string, unknown> = schemaOf({ n: { type: 'integer', maximum: 1, clamp: true } });
    let input: Record<string, unknown> = { n: 5 };
    for (let level = 0; level < 7; level++) { schema = schemaOf({ a: schema }); input = { a: input }; }
    expect(clampDeclaredBounds({ input, inputSchema: schema })).toEqual({ input, notes: [] });
  });

  it('returns a non-object input and a schema without properties unchanged', () => {
    expect(clampDeclaredBounds({ input: 'text', inputSchema: schemaOf({ limit: LIMIT }) })).toEqual({ input: 'text', notes: [] });
    expect(clampDeclaredBounds({ input: { limit: 8300 }, inputSchema: { type: 'object' } })).toEqual({ input: { limit: 8300 }, notes: [] });
  });
});

describe('assertRepairKeywords', () => {
  it('passes a schema whose clamp sits on a bounded numeric property', () => {
    expect(() => assertRepairKeywords({ inputSchema: schemaOf({ limit: LIMIT, page: schemaOf({ size: { type: 'number', minimum: 1, clamp: true } }) }) })).not.toThrow();
  });

  it('passes a schema that declares clamp: false or no clamp at all', () => {
    expect(() => assertRepairKeywords({ inputSchema: schemaOf({ id: { type: 'integer', maximum: 9, clamp: false }, name: { type: 'string' } }) })).not.toThrow();
  });

  it.each([
    ['a non-numeric property', schemaOf({ name: { type: 'string', maximum: 3, clamp: true } }), 'name'],
    ['a property without a bound', schemaOf({ size: { type: 'integer', clamp: true } }), 'size'],
    ['a nested property', schemaOf({ page: schemaOf({ size: { type: 'integer', clamp: true } }) }), 'page.size'],
    ['a clamp that is not a boolean', schemaOf({ size: { type: 'integer', maximum: 3, clamp: 'yes' } }), 'size'],
  ])('throws for clamp on %s, naming the property path', (_label, inputSchema, path) => {
    expect(() => assertRepairKeywords({ inputSchema })).toThrow(`clamp on '${path}'`);
  });
});
